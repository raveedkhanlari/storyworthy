import { defineContentScript } from "wxt/utils/define-content-script";
import { browser } from "wxt/browser";
import "@/assets/content-widget.css";
import type {
    SupportedPlatform,
    DetectedPost,
    PostContext,
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
    // Prefer the article's own h1, else the first h1 on the page
    const article =document.querySelector("article");
    const h1 = article?.querySelector("h1") ?? document.querySelector("h1");

    if (!h1)
        return [];

    const title = h1.textContent?.trim().slice(0, 200) ?? document.title;
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? window.location.href;

    return [{
        element: h1,
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

function injectInlineWidget(postElement: HTMLElement, context: PostContext, large = false) {
    const autoCloseMs = large ? 7000 : 4000;
    const widget = document.createElement("div");

    widget.className = large ? "sw-inline-widget sw-inline-widget-large" : "sw-inline-widget";
    widget.setAttribute("role", "button");
    widget.setAttribute("aria-label", `Vote on: ${context.title.slice(0, 40)}`);
    widget.setAttribute("tabindex", "0");
    widget.innerHTML = `
        <span class="sw-inline-icon">SW</span>
    `;

    let panelOpen = false;
    let panelTimer: ReturnType<typeof setTimeout> | null = null;

    widget.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();

        if (panelOpen) {
            if (panelTimer) clearTimeout(panelTimer);
            removePanel(widget);

            panelOpen = false;
        } else {
            showVotePanel(widget, context, () => {
                panelTimer = setTimeout(() => {
                    removePanel(widget);
                    panelOpen = false;
                }, autoCloseMs);
            });

            panelOpen = true;
        }
    });

    postElement.style.position = "relative";
    postElement.appendChild(widget);
};

async function showVotePanel(widget: HTMLElement, context: PostContext, onVoted: () => void) {
    const panel = document.createElement("div");

    panel.className = "sw-inline-panel";
    panel.innerHTML = `
        <div class="sw-panel-title">This content is <span class="sw-brand">StoryWorthy</span> for:</div>
        <div class="sw-categories">
            <button data-category="thriller">Thriller</button>
            <button data-category="drama">Drama</button>
            <button data-category="sci-fi">Sci-Fi</button>
            <button data-category="romance">Romance</button>
            <button data-category="horror">Horror</button>
            <button data-category="comedy">Comedy</button>
            <button data-category="mystery">Mystery</button>
            <button data-category="fantasy">Fantasy</button>
        </div>
        <div class="sw-status"></div>
    `;

    const status = panel.querySelector<HTMLElement>(".sw-status")!;
    const buttons = panel.querySelectorAll<HTMLButtonElement>(".sw-categories button");

    const contentId = `local-${context.pageKey}`;

    // Highlight a previously selected category, if any
    const existing = await browser.runtime.sendMessage({
        type: "SW_GET_VOTE_FOR_CONTENT",
        payload: { contentId },
    });

    if (existing?.ok && existing.data?.category) {
        panel.querySelector<HTMLButtonElement>(
            `.sw-categories button[data-category="${existing.data.category}"]`
        )?.classList.add("sw-selected");
    }

    buttons.forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();

            const category = btn.dataset.category;

            if (!category) 
                return;

            status.textContent = "Submitting...";

            const initResponse = await browser.runtime.sendMessage({
                type: "SW_INIT_PAGE",
                payload: context,
            });

            if (!initResponse?.ok || !initResponse.data?.contentId) {
                status.textContent = "Could not register.";

                return;
            }

            const voteResponse = await browser.runtime.sendMessage({
                type: "SW_SUBMIT_VOTE",
                payload: {
                    contentId: initResponse.data.contentId,
                    category,
                    page: context,
                },
            });

            if (voteResponse?.ok) {
                buttons.forEach(b => b.classList.remove("sw-selected"));
                btn.classList.add("sw-selected");
                status.textContent = `Voted: ${category}`;
            } else {
                status.textContent = "Vote failed.";
            }
        });
    });

    widget.appendChild(panel);

    onVoted();
};

function removePanel(widget: HTMLElement) {
    const panel = widget.querySelector(".sw-inline-panel");

    if (panel)
        panel.remove();
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
    if (articlePageCache!==null) {
        return articlePageCache;
    }

    articlePageCache = computeIsArticlePage();

    return articlePageCache;
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

    // 3. Fallback: a single <article> with an <h1>
    const articles = document.querySelectorAll("article");

    if (articles.length===1 && articles[0].querySelector("h1")) {
        return true;
    }

    return false;
};
