import { defineContentScript } from "wxt/utils/define-content-script";
import { browser } from "wxt/browser";
import { Readability } from "@mozilla/readability";
import "@/assets/content-widget.css";
import type {
    SupportedPlatform,
    DetectedPost,
    PostContext,
    PanelController,
} from "@/utils/types";

let articlePageCache: boolean | null = null;

export default defineContentScript({
    matches: [
        "<all_urls>",
        // "https://www.reddit.com/*",
        // "https://reddit.com/*",
        // "https://x.com/*",
    ],
    runAt: "document_idle",
    main() {
        scanAndInjectWidgets();

        let debounceTimer: ReturnType<typeof setTimeout> | null = null;

        const observer = new MutationObserver(() => {
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }

            debounceTimer = setTimeout(() => {
                scanAndInjectWidgets();
            }, 300);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    },
});

function scanAndInjectWidgets() {
    const platform = detectPlatform();

    if (!platform)
        return;

    // const posts = platform==="x" ? findXPosts() : findRedditPosts();
    let posts: DetectedPost[];

    if (platform==="x") {
        posts = findXPosts();
    } else if (platform==="reddit") {
        posts = findRedditPosts();
    } else {
        posts = findWebArticle();
    }

    for (const post of posts) {
        if (post.element.querySelector(".sw-inline-widget")) 
            continue;

        injectInlineWidget(post.element, post.context, platform==="web");
    }

};

function findXPosts(): DetectedPost[] {
    const articles = document.querySelectorAll<HTMLElement>("article");
    const results: DetectedPost[] = [];

    for (const article of articles) {
        const permalink = article.querySelector<HTMLAnchorElement>("a[href*='/status/'] time")?.closest<HTMLAnchorElement>("a");

        if (!permalink)
            continue;

        const statusMatch = permalink.pathname.match(/^\/([^/]+)\/status\/(\d+)/);

        if (!statusMatch)
            continue;

        const tweetText = article.querySelector<HTMLElement>("[data-testid='tweetText']");
        const title = tweetText?.textContent?.trim().slice(0, 120) ?? "";

        results.push({
            element: article,
            context: {
                platform: "x",
                url: `https://x.com${permalink.pathname}`,
                canonicalUrl: `https://x.com/${statusMatch[1]}/status/${statusMatch[2]}`,
                pageKey: statusMatch[2],
                title,
                authorHandle: statusMatch[1],
                contentType: "post",
            },
        });
    }

    return results;
};

function findRedditPosts(): DetectedPost[] {
    const posts = document.querySelectorAll<HTMLElement>("shreddit-post");
    const results: DetectedPost[] = [];

    for (const post of posts) {
        const title = post.getAttribute("post-title") ?? "";
        const author = post.getAttribute("author") ?? null;
        const permalink = post.getAttribute("permalink") ?? "";
        const idMatch = permalink.match(/\/comments\/(\w+)/);

        if (!idMatch)
            continue;

        results.push({
            element: post,
            context: {
                platform: "reddit",
                url: `https://www.reddit.com${permalink}`,
                canonicalUrl: `https://www.reddit.com${permalink}`,
                pageKey: idMatch[1],
                title,
                authorHandle: author,
                contentType: "post",
            },
        });
    }

    return results;
};

function findWebArticle(): DetectedPost[] {
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? window.location.href;
    const ogTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content;

    // 1. Light-DOM heading (metro, CBC, most sites).
    const article = document.querySelector("article");

    let heading: HTMLElement | null = article?.querySelector("h1") ?? document.querySelector("h1");

    // 2. Shadow-DOM sites (e.g. MSN): find title heading across nested shadow roots.
    if (!heading)
        heading = findHeadingInShadow(ogTitle || document.title || "");

    if (!heading)
        return [];

    const title = (heading.textContent?.trim() || ogTitle || document.title || "").slice(0, 200);

    return [{
        element: heading,
        context: {
            platform: "web",
            url: window.location.href,
            canonicalUrl: canonical,
            pageKey: canonical,
            title,
            authorHandle: null,
            contentType: "article",
        },
    }];
};

// Pierce nested shadow roots to find article's title heading element.
function findHeadingInShadow(titleText: string): HTMLElement | null {
    const needle = titleText.trim().slice(0, 20);

    if (!needle)
        return null;

    let found: HTMLElement | null = null;

    const walk = (root: Document | ShadowRoot) => {
        const els = root.querySelectorAll<HTMLElement>("*");

        for (const el of els) {
            if (found)
                return;

            const sr = el.shadowRoot;

            if (sr)
                walk(sr);

            if (found)
                return;

            if (/^H[1-3]$/.test(el.tagName)) {
                const txt = (el.textContent ?? "").trim();

                if (txt.startsWith(needle)) {
                    found = el;

                    return;
                }
            }
        }
    };

    walk(document);

    return found;
};

function extractPostText(element: HTMLElement, platform: SupportedPlatform): string {
    // X / Reddit: post element itself holds text
    if (platform!=="web")
        return (element.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 4000);

    // Web articles try Readability (light DOM) first. Parse a clone so live page isn't mutated.
    try {
        const docClone = document.cloneNode(true) as Document;
        const article = new Readability(docClone).parse();
        const text = (article?.textContent ?? "").replace(/\s+/g, " ").trim();

        if (text.length>200)
            return text.slice(0, 4000);
    } catch {
        // Fall through to shodow-DOM fallback.
    }

    // Shadow-DOM sites (e.g. MSN): Readability can't see into shadow roots. Prefer an article-like shadow host, else deep-walk whole document.
    const artcileHost = 
        document.querySelector("cp-article") ??
        document.querySelector('[itemprop="articleBody"]') ??
        document.querySelector("article") ??
        document.querySelector("main")
    ;
    const deep = deepText((artcileHost as Element) ?? document.body).replace(/\s+/g, " ").trim();

    if (deep.length>200)
        return deep.slice(0, 4000);

    // Last resort: light-DOM innerText.
    const fallback = (document.querySelector("main") ?? document.body);

    return (fallback?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 4000);
};

function deepText(root: Element | ShadowRoot | Document): string {
    let text = "";

    root.querySelectorAll("*").forEach((el) => {
        const sr = (el as HTMLElement).shadowRoot;

        if (sr)
            text += " " + deepText(sr);
    });

    text += " " + ((root as HTMLElement).textContent ?? "");

    return text;
};

function injectInlineWidget(postElement: HTMLElement, context: PostContext, large = false) {
    const widget = document.createElement("div");

    widget.className = large ? "sw-inline-widget sw-inline-widget-large sw-inline-widget-web" : "sw-inline-widget";
    widget.setAttribute("role", "button");
    widget.setAttribute("aria-label", `Vote on: ${context.title.slice(0, 40)}`);
    widget.setAttribute("tabindex", "0");
    widget.innerHTML = `
        <span class="sw-inline-icon">SW</span>
    `;

    let panelOpen = false;
    let panelTimer: ReturnType<typeof setTimeout> | null = null;

    const clearPanelTimer = () => {
        if (panelTimer) {
            clearTimeout(panelTimer);

            panelTimer = null;
        }
    };

    const closePanel = () => {
        clearPanelTimer();
        removePanel(widget);

        panelOpen = false;
    };

    const onOutsideClick = (ev: MouseEvent) => {
        const panel = (widget as any)._swPanel as HTMLElement | undefined;
        const target = ev.target as Node;

        if (widget.contains(target) || panel?.contains(target))
            return;

        closePanel();
    };

    const closeWithCleanup = () => {
        document.removeEventListener("click", onOutsideClick, true);
        closePanel();
    };

    widget.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();

        if (panelOpen) {
            closeWithCleanup();
        } else {
            panelOpen = true;

            const postContent = extractPostText(postElement, context.platform);

            showVotePanel(widget, context, postContent, {
                startIdleTimer: () => {},
                cancelIdleTimer: () => {},
                closeAfterResponse: () => {
                    clearPanelTimer();
                    panelTimer = setTimeout(closeWithCleanup, 1000);
                },
            });

            setTimeout(() => document.addEventListener("click", onOutsideClick, true), 0);
        }
    });

    const isFloating = postElement===document.body;

    if (isFloating) {
        // No DOM anchor (shadow-DOM site): pin to top-left of view-port.
        widget.classList.add("sw-inline-widget-floating");
        document.body.appendChild(widget);
    } else if (large) {
        // Web article: sit inline at start of heading. Apply critical styles inline so widget renders correctly even inside a styled-isolated shadow root.
        Object.assign(widget.style, {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "28px",
            height: "28px",
            borderRadius: "8px",
            background: "#f5c518",
            cursor: "pointer",
            verticalAlign: "middle",
            marginRight: "8px",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
            flex: "0 0 auto",
            boxSizing: "border-box",
        } as Partial<CSSStyleDeclaration>);

        const icon = widget.querySelector<HTMLElement>(".sw-inline-icon");

        if (icon) {
            Object.assign(icon.style, {
                fontSize: "14px",
                fontWeight: "800",
                color: "#0d9668",
                fontFamily: "Inter, Segoe UI, sans-serif",
                PointerEvents: "none",
                lineHeight: "1",
            } as Partial<CSSStyleDeclaration>);
        }

        postElement.insertBefore(widget, postElement.firstChild);
    } else {
        postElement.style.position = "relative";
        postElement.appendChild(widget);
    }
};

async function showVotePanel(widget: HTMLElement, context: PostContext, postContent: string, controller: PanelController) {
    const panel = document.createElement("div");
    (widget as any)._swPanel = panel;

    panel.className = "sw-inline-panel";
    panel.innerHTML = `
        <div class="sw-panel-title">This content is <span class="sw-brand">StoryWorthy</span> for:</div>
        <div class="sw-categories">
            <button data-category="comedy">Comedy</button>
            <button data-category="drama">Drama</button>
            <button data-category="fantasy">Fantasy</button>
            <button data-category="horror">Horror</button>
            <button data-category="mystery">Mystery</button>
            <button data-category="romance">Romance</button>
            <button data-category="sci-fi">Sci-Fi</button>
            <button data-category="thriller">Thriller</button>
            <button data-category="__other__">Other</button>
        </div>
        <div class="sw-status"></div>
    `;

    const buttons = panel.querySelectorAll<HTMLButtonElement>(".sw-categories button");

    async function submitVote(category: string) {
        controller.cancelIdleTimer();

        const liveStatus = panel.querySelector<HTMLElement>(".sw-status");

        if (liveStatus)
            liveStatus.textContent = "Submitting...";

        const initResponse = await browser.runtime.sendMessage({
            type: "SW_INIT_PAGE",
            payload: context,
        });

        if (!initResponse?.ok || !initResponse.data?.contentId) {
            if (liveStatus)
                liveStatus.textContent = "Could not register.";

            controller.closeAfterResponse();

            return;
        }

        const voteResponse = await browser.runtime.sendMessage({
            type: "SW_SUBMIT_VOTE",
            payload: {
                contentId: initResponse.data.contentId,
                category,
                page: context,
                postContent,
            },
        });

        if (voteResponse?.ok) {
            if (liveStatus)
                liveStatus.textContent = `Voted: ${category}`;

            browser.runtime.sendMessage({ type: "SW_OPEN_SIDEPANEL" });
            controller.closeAfterResponse();
        } else if (voteResponse?.error==="SIGN_IN_REQUIRED") {
            controller.cancelIdleTimer();

            panel.innerHTML = `
                <div class="sw-panel-title">You picked <span class="sw-brand">${category}</span></div>
                <div class="sw-signin-msg">Sign in to save your vote.</div>
                <button class="sw-signin-btn" type="button">Sign In</button>
            `;

            panel.querySelector<HTMLButtonElement>(".sw-signin-btn")?.addEventListener("click", (ev) => {
                ev.stopPropagation();
                browser.runtime.sendMessage({ type: "SW_OPEN_SIDEPANEL" });
                controller.closeAfterResponse();
            });
        } else if (voteResponse?.error==="STORY_LOCKED") {
            if (voteResponse.lockedCategory===category) { // Same genre -> Open side.
                browser.runtime.sendMessage({ type: "SW_OPEN_SIDEPANEL" });
                controller.closeAfterResponse();
            } else { // Different genre -> Keep widget open, explain the lock.
                controller.cancelIdleTimer();

                if (liveStatus)
                    liveStatus.textContent = "This post already has a story. Its genre is locked.";
            }
        } else {
            if (liveStatus)
                liveStatus.textContent = "Vote failed.";

            controller.closeAfterResponse();
        }
    }

    function showOtherInput() {
        controller.cancelIdleTimer();

        panel.innerHTML = `
            <div class="sw-panel-title">Enter a <span class="sw-brand">genre</span></div>
            <div class="sw-other-row">
                <input class="sw-other-input" type="text" maxlength="30" placeholder="e.g. Satire" />
                <button class="sw-other-submit" type="button">Vote</button>
            </div>
            <div class="sw-status"></div>
        `;

        const input = panel.querySelector<HTMLInputElement>(".sw-other-input")!;
        const otherStatus = panel.querySelector<HTMLElement>(".sw-status")!;
        const submitBtn = panel.querySelector<HTMLButtonElement>(".sw-other-submit")!;

        input.focus();

        const submit = () => {
            const value = input.value.trim().toLowerCase();

            if (!value) {
                otherStatus.textContent = "Type a genre first.";

                return;
            }

            submitVote(value);
        };

        submitBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            submit();
        });

        input.addEventListener("keydown", (e) => {
            if (e.key==="Enter") {
                e.preventDefault();
                submit();
            }
        });
    }

    buttons.forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();

            const category = btn.dataset.category;

            if (!category)
                return;

            if (category==="__other__") {
                showOtherInput();

                return;
            }

            buttons.forEach(b => b.classList.remove("sw-selected"));
            btn.classList.add("sw-selected");
            submitVote(category);
        });
    });

    // Append widget to <body> with fixed positioning so no ancestor overflow/shadow clipt it.
    panel.style.position = "fixed";
    panel.style.zIndex = "2147483647"; // max, above site UI
    
    document.body.appendChild(panel);
    positionPanel(widget, panel);

    // Keep panel anchored to widget while it's open.
    const reposition = () => positionPanel(widget, panel);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);

    // Store cleanup on panel so removePanel can detach listeners.
    (panel as any)._swReposition = reposition;

    controller.startIdleTimer();
};

function positionPanel(widget: HTMLElement, panel: HTMLElement) {
    const r = widget.getBoundingClientRect();
    const panelWidth = 220;
    const margin = 6;

    // Prefer aligning panels right edge to widget's right edge.
    let left = r.right - panelWidth;

    if (left<8)
        left =8; // Don't run off left edge

    let top = r.bottom + margin;

    // If it would overflow bottom, place it above widget instead.
    const panelHeight = panel.offsetHeight || 200;

    if ((top + panelHeight)>(window.innerHeight - 8)) {
        top = r.top - panelHeight - margin;

        if (top<8)
            top =8;
    }

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
};

function removePanel(widget: HTMLElement) {
    // Panel now lives on document.body; find one anchored to this widget. 
    const panel = (widget as any)._swPanel as HTMLElement | undefined;

    if (panel) {
        const reposition = (panel as any)._swReposition;

        if (reposition) {
            window.removeEventListener("scroll", reposition, true);
            window.removeEventListener("resize", reposition);
        }

                panel.remove();
                (widget as any)._swPanel = undefined;
    }
};

function detectPlatform(): SupportedPlatform | null {
    const host = window.location.hostname;

    if (host.includes("reddit.com")) {
        return "reddit";
    };
    if (host==="x.com") {
        return "x";
    };
    if (isArticlePage()) {
        return "web";
    };

    return null;
};

function isArticlePage(): boolean {
    // Only cache a positive verdict. While it's not an article (e.g. a JS-rendered page that hasn't injected its metadata), keep -rechecking on later scans.
    if (articlePageCache===true)
        return true;

    const result = computeIsArticlePage();

    if (result)
        articlePageCache = true;

    return result;
};

function computeIsArticlePage(): boolean {
    // 1. Open Graph
    const ogType = document.querySelector<HTMLMetaElement>('meta[property="og:type"]')?.content;

    if (ogType==="article")
        return true;

    // 2. JSON-LD schema
    const ldScripts = document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]');

    for (const script of ldScripts) {
        try {
            const data = JSON.parse(script.textContent || "");
            const types = Array.isArray(data) ? data.map(d => d["@type"]) : [data["@type"]];

            if (types.some(t => ["Article", "NewsArticle", "BlogPosting"].includes(t))) {
                return true;
            }
        } catch {
            // ignore malformed JSON-LD
        }
    }

    // No explicit article metadata found - don't treat it as an article then
    // Modern web apps (GitHub, dashboards) use <article> for UI components,
    // so a loose <article>+<h1> fallback causes false positives.
    return false;
};
