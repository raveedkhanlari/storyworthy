import { browser } from "wxt/browser";
import type { UserProfile, InstallContextResponse, VoteRecord, AuthState, StoryThread } from "@/utils/types";

const profileForm = document.querySelector<HTMLFormElement>("#profile-form");
const profileStatus = document.querySelector<HTMLDivElement>("#profile-status");
const countryInput = document.querySelector<HTMLInputElement>("#country");
const regionInput = document.querySelector<HTMLInputElement>("#region");
const emailInput = document.querySelector<HTMLInputElement>("#email");
const emailOptInInput = document.querySelector<HTMLInputElement>("#emailOptIn");
const profileSummary = document.querySelector<HTMLDivElement>("#profile-summary");
const historyEmpty = document.querySelector<HTMLDivElement>("#history-empty");
const historyList = document.querySelector<HTMLDivElement>("#history-list");
const offlineBanner = document.querySelector<HTMLDivElement>("#offline-banner");
const authEmailForm = document.querySelector<HTMLFormElement>("#auth-email-form");
const authCodeForm = document.querySelector<HTMLFormElement>("#auth-code-form");
const authEmailInput = document.querySelector<HTMLInputElement>("#auth-email");
const authCodeInput = document.querySelector<HTMLInputElement>("#auth-code");
const authEmailField = document.querySelector<HTMLDivElement>("#auth-email-field");
const authSignedInField = document.querySelector<HTMLDivElement>("#auth-signedin-field");
const authEmailDisplay = document.querySelector<HTMLDivElement>("#auth-email-display");
const authSendBtn = document.querySelector<HTMLButtonElement>("#auth-send-btn");
const authStatus = document.querySelector<HTMLDivElement>("#auth-status");
const authSignOutRow = document.querySelector<HTMLDivElement>("#auth-signout-row");
const authSignOutBtn = document.querySelector<HTMLButtonElement>("#auth-signout");
const profileSection = document.querySelector<HTMLElement>("#profile-section");
const profilePrompt = document.querySelector<HTMLDivElement>("#profile-prompt");
const adviceModal = document.querySelector<HTMLDivElement>("#advice-modal");
const adviceClose = document.querySelector<HTMLButtonElement>("#advice-close");
const adviceContext = document.querySelector<HTMLDivElement>("#advice-context");
const adviceParagraph = document.querySelector<HTMLTextAreaElement>("#advice-paragraph");
const adviceWordcount = document.querySelector<HTMLDivElement>("#advice-wordcount");
const adviceSubmit = document.querySelector<HTMLButtonElement>("#advice-submit");
const adviceStatus = document.querySelector<HTMLDivElement>("#advice-status");
const adviceResult = document.querySelector<HTMLDivElement>("#advice-result");
const advicePaywall = document.querySelector<HTMLDivElement>("#advice-paywall");
const adviceWaitlistBtn = document.querySelector<HTMLButtonElement>("#advice-waitlist");
const adviceWaitlistStatus = document.querySelector<HTMLDivElement>("#advice-waitlist-status");
const historyToggle = document.querySelector<HTMLButtonElement>("#history-toggle");
const historyBody = document.querySelector<HTMLDivElement>("#history-body");
const historySection = document.querySelector<HTMLElement>("#history-section");
const adviceConfirm = document.querySelector<HTMLDivElement>("#advice-confirm");
const adviceConfirmText = document.querySelector<HTMLParagraphElement>("#advice-confirm-text");
const adviceConfirmStart = document.querySelector<HTMLButtonElement>("#advice-confirm-start");
const adviceConfirmCancel = document.querySelector<HTMLButtonElement>("#advice-confirm-cancel");
const adviceInputArea = document.querySelector<HTMLDivElement>("#advice-input-area");
const adviceParagraphLabel = document.querySelector<HTMLLabelElement>("#advice-paragraph-label");
const authResendBtn = document.querySelector<HTMLButtonElement>("#auth-resend")


const PROFILE_ENABLED = false; // Profile is deferred to paid tier. Keep code but hide it in freemium tier.
const MAX_ADVICE_WORDS = 80;
const MAX_TURNS = 3;
const INACTIVITY_MS = 60 * 60 * 1000;
const LAST_ACTIVE_KEY = "sw_last_active";
let inactivityTimer: ReturnType<typeof setInterval> | null = null;
let activeAdviceVote: VoteRecord | null = null;
let pendingAuthEmail: string | null = null;
let currentAuth: AuthState = { signedIn: false, email: null, userId: null };
let hasProfile = false;
let pendingStoryVote: VoteRecord | null = null;
let activeStory: StoryThread | null = null; // Story current open in modal
let currentStory: StoryThread | null = null; // User's single saved story
let interestedInPaid = false;
let resendTimer: ReturnType<typeof setInterval> | null = null;

init().catch((error) => {
    setStatus(profileStatus, error instanceof Error ? error.message : "Failed to initialize.", "error");
});

authEmailForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    // Already signed in — the button is a Sign out, not a submit.
    if (currentAuth.signedIn)
        return;

    const email = authEmailInput?.value.trim() || "";

    if (!email) {
        setStatus(authStatus, "Enter your email.", "error");

        return;
    }

    setStatus(authStatus, "Sending code...", "notice");

    const response = await browser.runtime.sendMessage({
        type: "SW_AUTH_REQUEST_CODE",
        payload: { email },
    });

    if (!response?.ok) {
        setStatus(authStatus, response?.error || "Could not send code.", "error");

        return;
    }

    pendingAuthEmail = email;

    if (authEmailForm)
        authEmailForm.hidden = true;

    if (authCodeForm) {
        authCodeForm.hidden = false;

        startResendCountdown(60);
    }

    authCodeInput?.focus();
    setStatus(authStatus, `We emailed a 6-digit code to ${email}. Check your inbox (and spam).`, "notice");
});

authCodeForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const code = authCodeInput?.value.trim() || "";

    if (!pendingAuthEmail || code.length!==6) {
        setStatus(authStatus, "Enter the 6-digit code.", "error");

        return;
    }

    setStatus(authStatus, "Verifying...", "notice");

    const response = await browser.runtime.sendMessage({
        type: "SW_AUTH_VERIFY_CODE",
        payload: {
            email: pendingAuthEmail,
            code,
        },
    });

    if (!response?.ok) {
        setStatus(authStatus, response?.error || "Could not verify code.", "error");

        return;
    }

    pendingAuthEmail = null;

    if (authCodeInput)
            authCodeInput.value = "";

    renderAuth(response.data as AuthState);
    await markActive();
    await loadVoteHistory();
    await loadStory();
    await loadVoteHistory();
});

authSignOutBtn?.addEventListener("click", async () => {
    await browser.runtime.sendMessage({ type: "SW_AUTH_SIGN_OUT" });
    await browser.runtime.sendMessage({ type: "SW_CLEAR_LOCAL_DATA" });
    await browser.storage.local.remove(LAST_ACTIVE_KEY);

    closeAdviceModal();

    if (authEmailInput)
        authEmailInput.value = "";

    renderAuth({
        signedIn: false,
        email: null,
        userId: null,
    });
    setStatus(authStatus, "Signed out.", "notice");
});

authResendBtn?.addEventListener("click", async () => {
    if (!pendingAuthEmail)
        return;

    setStatus(authStatus, "Resending code...", "notice");

    const response = await browser.runtime.sendMessage({
        type: "SW_AUTH_REQUEST_CODE",
        payload: { email: pendingAuthEmail },
    });

    if (!response?.ok) {
        setStatus(authStatus, response?.error || "Could not resend code.", "error");

        return;
    }

    setStatus(authStatus, "A new code was sent. Check your inbox (and spam).", "notice");
    startResendCountdown(60);
});

profileForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const profile = readProfileForm();

    if (!profile.country) {
        setStatus(profileStatus, "Country is required.", "error");

        return;
    };

    setStatus(profileStatus, "Saving profile...", "default");

    const response = await browser.runtime.sendMessage({
        type: "SW_SAVE_PROFILE",
        payload: profile,
    });

    if (!response.ok) {
        setStatus(profileStatus, response?.error || "Could not save profile.", "error");

        return;
    };

    hasProfile = !!profile.country;
    renderProfile(profile);
    setStatus(profileStatus, "Profile saved.", "success");
    updateProfileVisibility();
});

adviceParagraph?.addEventListener("input", updateWordCount);
adviceSubmit?.addEventListener("click", submitAdvice);
adviceClose?.addEventListener("click", closeAdviceModal);
adviceWaitlistBtn?.addEventListener("click", joinWaitlist);

// Click outise box closes modal
adviceModal?.addEventListener("click", (event) => {
    if (event.target===adviceModal)
        closeAdviceModal();
});

historyToggle?.addEventListener("click", () => {
    const expanded = historyToggle.getAttribute("aria-expanded")!=="false";
    const next = !expanded;

    historyToggle.setAttribute("aria-expanded", String(next));

    if (historyBody)
        historyBody.hidden = !next;
});

adviceConfirmStart?.addEventListener("click", () => {
    if (!pendingStoryVote)
        return;

    activeStory = {
        contentId: pendingStoryVote.contentId,
        genre: pendingStoryVote.category,
        postTitle: pendingStoryVote.title,
        postContent: pendingStoryVote.postContent ?? "",
        summary: "",
        ownerUserId: currentAuth.userId ?? "",
        turns: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    pendingStoryVote = null;

    showAdviceInput();
    renderAdviceModal();

    adviceParagraph?.focus();
});

adviceConfirmCancel?.addEventListener("click", () => {
    pendingStoryVote = null;

    closeAdviceModal();
});

window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        loadVoteHistory();
    }
});

// Refresh vote history when storage changes (e.g., vote from inline widget)
browser.storage.onChanged.addListener((changes) => {
    if (changes.sw_votes_updated) {
        loadVoteHistory();
    }
});

// Any interaction in panel counts as activity.
["click", "keydown", "input"].forEach((evt) => {
    document.addEventListener(evt, () => resetInactivityTimer(), { passive: true });
});

async function init() {
    await loadAuthState();
    await enforceSessionFreshness();
    await loadInstallContext();
    await loadVoteHistory(); // This call loads votes into local storage
    await loadStory();
    await loadVoteHistory(); // This call refreshes votes based on coaching usage
};

async function loadAuthState() {
    const response = await browser.runtime.sendMessage({ type: "SW_GET_AUTH_STATE" });

    if (response?.ok && response.data)
        renderAuth(response.data as AuthState);
};

async function enforceSessionFreshness() {
    if (!currentAuth.signedIn)
        return;

    const last = await getLastActive();

    if (last && (Date.now() - last)>=INACTIVITY_MS) {
        await forceSignOut("Signed out after inactivity. Please sign in again.");
    } else {
        resetInactivityTimer();
    }
};

function renderAuth(state: AuthState) {
    currentAuth = state;

    // Start/stop inactivity timer based on session state.
    resetInactivityTimer(false);

    const signedIn = state.signedIn;

    if (authEmailForm)
        authEmailForm.hidden = signedIn;

    // Signed-out: show email input + Send button.Signed-in: hide them.
    if (authEmailField)
        authEmailField.hidden = signedIn;
    if (authSendBtn)
        authSendBtn.hidden = signedIn;

    // Signed-in: show read-only email line + Sign out.
    if (authSignedInField)
        authSignedInField.hidden = true;
    if (authSignOutRow)
        authSignOutRow.hidden = !signedIn;
    if (signedIn && authEmailDisplay)
        authEmailDisplay.textContent = state.email ?? "";

    // Status line under Account header reflects session.
    if (signedIn) {
        setStatus(authStatus, `Signed in as "${state.email ?? ''}". Your vote history is synced.`, "notice");
    } else {
        setStatus(authStatus, "", "default");
    }

    // Code-entry form only appears mid sign-in flow, never in a resting state.
    if (authCodeForm)
        authCodeForm.hidden = true;

    // Vote history is private—only show it when signed in.
    if (historySection)
        historySection.hidden = !signedIn;

    updateProfileVisibility();
};

function updateProfileVisibility() {
    if (!PROFILE_ENABLED) {
        if (profileSection)
            profileSection.hidden = true;

        if (profilePrompt) {
            profilePrompt.hidden = true;
            profilePrompt.textContent = "";
        }

        return;
    }

    const show = !currentAuth.signedIn || !hasProfile;

    if (profileSection)
        profileSection.hidden = !show;

    if (profilePrompt) {
        if (currentAuth.signedIn && !hasProfile) {
            profilePrompt.textContent = "Finish setting up your profile to personalize StoryWorthy.";
            profilePrompt.hidden = false;
        } else {
            profilePrompt.textContent = "";
            profilePrompt.hidden = true;
        }
    }
};

async function loadInstallContext() {
    const response = (await browser.runtime.sendMessage({
        type: "SW_GET_INSTALL_CONTEXT",
    })) as InstallContextResponse;

    if (!response?.ok || !response.data) {
        setStatus(profileStatus, response?.error || "Could not load install context.", "error");

        return;
    };

    if (response.data.profile) {
        hasProfile = !!response.data.profile.country;
        fillProfileForm(response.data.profile);
        renderProfile(response.data.profile);
    } else {
        hasProfile = false;
        renderProfile(null);
    };

    updateProfileVisibility();
};

function readProfileForm(): UserProfile {
    return {
        country: countryInput?.value.trim() || "",
        region: regionInput?.value.trim() || "",
        email: emailInput?.value.trim() || "",
        emailOptIn: !!emailOptInInput?.checked,
    };
};

async function markActive() {
    await browser.storage.local.set({ [LAST_ACTIVE_KEY]: Date.now() });
};

async function getLastActive(): Promise<number> {
    const data = await browser.storage.local.get([LAST_ACTIVE_KEY]);
    const v = data[LAST_ACTIVE_KEY];

    return typeof v==="number" ? v : 0;
};

function fillProfileForm(profile: UserProfile) {
    if (countryInput) {
        countryInput.value = profile.country;
    };

    if (regionInput) {
        regionInput.value = profile.region || "";
    };

    if (emailInput) {
        emailInput.value = profile.email || "";
    };

    if (emailOptInInput) {
        emailOptInInput.checked = profile.emailOptIn === true;
    };
};

function renderProfile(profile: UserProfile | null) {
    if (!profile) {
        if (profileSummary) {
            profileSummary.textContent = "Not saved yet.";
        };

        return;
    };

    const parts = [profile.country, profile.region].filter(Boolean);
    const locationText = parts.length ? parts.join(", ") : "Location not specified";
    const emailText = profile.email ? ` . ${profile.email}` : "";

    if (profileSummary) {
        profileSummary.textContent =  `${locationText}${emailText}`;
    };
};

function setStatus(el: HTMLDivElement | null, text: string, kind: "default" | "success" | "error" | "notice" | "loading") {
    if (!el) {
        return;
    };

    el.className = "status";

    if (kind==="loading") {
        el.classList.add("loading");
        el.innerHTML = `${text}<span class="dots"><span>.</span><span>.</span><span>.</span></span>`;

        return;
    };

    el.textContent = text;

    if (kind==="success") {
        el.classList.add("success");
    };

    if (kind==="error") {
        el.classList.add("error");
    };

    if (kind==="notice") {
        el.classList.add("notice");
    };
};

function startResendCountdown(seconds: number) {
    if (!authResendBtn)
        return;

    if (resendTimer)
        clearInterval(resendTimer);

    let remaining = seconds;

    authResendBtn.disabled = true;
    authResendBtn.textContent = `Resend Code (${remaining}s)`;

    resendTimer = setInterval(() => {
        remaining -= 1;

        if (remaining<=0) {
            clearInterval(resendTimer!);

            resendTimer = null;
            authResendBtn.disabled = false;
            authResendBtn.textContent = "Resend Code";

            return;
        }

        authResendBtn.textContent = `Resend Code (${remaining}s)`;
    }, 1000);
}

async function loadVoteHistory() {
    const response = await browser.runtime.sendMessage({
        type: "SW_GET_VOTE_HISTORY",
    });

    // Empty-error state: show empty message, hide list.
    if (!response?.ok || !response.data?.votes?.length) {
        if (historyEmpty) {
            historyEmpty.hidden = false;
        }

        if (historyList) {
            historyList.hidden = true;
            historyList.innerHTML = "";
        }

        return;
    }

    // Wire each Get Advice button (only when signed in).
    const votes = response.data.votes as VoteRecord[];

    if (historyEmpty)
        historyEmpty.hidden = true;

    if (historyList) {
        historyList.hidden = false;
        historyList.innerHTML = votes.map((vote: VoteRecord, i: number) => `
            <div class="meta-item">
                <div class="meta-label">
                    ${vote.platform} . ${vote.category}
                </div>
                <div>
                    <a href="#" class="sw-post-link" data-vote-index="${i}">
                        ${escapeHtml(vote.title)}
                    </a>
                </div>
                <div class="sw-vote-actions">
                    <button 
                        class="sw-advice-btn" 
                        data-vote-index="${i}"${currentStory && currentStory.contentId!==vote.contentId ? " disabled" : ""}
                    >
                        ${currentStory && currentStory.contentId===vote.contentId ? "Review Story" : "Get Advice"}
                    </button>
                    <button
                        class="sw-delete-btn"
                        data-vote-index="${i}"${currentStory && currentStory.contentId===vote.contentId ? " disabled title=\"This vote has a story and can't be deleted\"" : ""}
                    >
                        Delete Vote
                    </button>
                </div>
            </div>
        `).join("");

        // Get Advice button -> Open coaching modal
        historyList?.querySelectorAll<HTMLButtonElement>(".sw-advice-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                if (btn.disabled)
                    return;

                const idx = Number(btn.dataset.voteIndex);
                const vote = votes[idx];

                if (vote)
                    openAdviceModal(vote);
            });
        });

        // Delete Vote button -> Confirm and delete from backend + local, then re-render.
        historyList?.querySelectorAll<HTMLButtonElement>(".sw-delete-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
                const idx = Number(btn.dataset.voteIndex);
                const vote = votes[idx];

                if (btn.disabled)
                    return;

                if (!vote)
                    return;

                const actions = btn.closest<HTMLDivElement>(".sw-vote-actions");

                if (!actions)
                    return;

                actions.innerHTML = `
                    <span class="sw-confirm-text">Delete?</span>
                    <button class="sw-confirm-yes">Yes</button>
                    <button class="sw-confirm-no">Cancel</button>
                `;

                // Cancel -> just -rerender list (restore original buttons and listeners).
                actions.querySelector<HTMLButtonElement>(".sw-confirm-no")?.addEventListener("click", () => { loadVoteHistory(); }); 
                
                // Yes -> show "Deleting..." animation, then re-render.
                actions.querySelector<HTMLButtonElement>(".sw-confirm-yes")?.addEventListener("click", async () => {
                    actions.innerHTML = `
                        <span class="sw-deleting">Deleting<span class="sw-dots"><span>.</span><span>.</span><span>.</span></span></span>
                    `;
                    
                    const response = await browser.runtime.sendMessage({
                        type: "SW_DELETE_VOTE",
                        payload: { contentId: vote.contentId },
                    });

                    if (response?.ok) {
                        // Re-render without deleted vote
                        await loadVoteHistory();
                    } else if (response?.error=="AUTH_EXPIRED") {
                        await forceSignOut("Your session has expired. Please sign in again.");
                    } else {
                        btn.disabled = false;
                    }
                });
            });
        });

        historyList?.querySelectorAll<HTMLAnchorElement>(".sw-post-link").forEach(link => {
            link.addEventListener("click", (e) => {
                e.preventDefault();

                const idx = Number(link.dataset.voteIndex);
                const vote = votes[idx];

                if (vote?.url)
                    browser.runtime.sendMessage({
                        type: "SW_OPEN_LINK",
                        payload: { url: vote.url },
                    });
            });
        });
    }
};

async function loadStory() {
    currentStory = null;

    if (!currentAuth.signedIn)
        return;

    const serverResp = await browser.runtime.sendMessage({
        type: "SW_GET_SERVER_STORY",
    });

    if (serverResp?.error==="AUTH_EXPIRED") {
        await forceSignOut("Your session expired. Please sign in again.");

        return;
    }

    if (!serverResp?.ok) {
        currentStory = null;

        return;
    }

    interestedInPaid = serverResp.data?.interestedInPaid===true;

    if (!serverResp.data?.story) {
        currentStory = null;

        return;
    }

    const s = serverResp.data.story;
    const vote = await findVoteByContentId(s.voteId);

    currentStory = {
        contentId: s.voteId,
        genre: vote?.category ?? "",
        postTitle: vote?.title ?? "",
        postContent: vote?.postContent ?? "",
        summary: s.summary ?? "",
        ownerUserId: currentAuth.userId ?? "",
        turns: s.turns.map((t: any) => ({
            paragraph: t.paragraph,
            advice: t.advice,
        })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}

async function findVoteByContentId(contentId: string): Promise<VoteRecord | null> {
    const resp = await browser.runtime.sendMessage({
        type: "SW_GET_VOTE_HISTORY",
    });
    const votes = (resp?.ok ? resp.data?.votes : []) as VoteRecord[] | undefined;

    return votes?.find(v => v.contentId===contentId) ?? null;
}

function renderMarkdown(md: string): string {
    // 1. Escape everything so model ouput can't inject HTML.
    const esc = escapeHtml(md);
    // 2. Inline bold: **text** -> <strong>text</strong>
    const PILLARS = /^(persona|scene|tone|narration|time)$/i;
    let html = esc.replace(/\*\*([^*]+)\*\*/g, (_m, inner: string) => 
        PILLARS.test(inner.trim())
            ? `<strong class="sw-pillar">${inner}</strong>`
            : `<strong>${inner}</strong>`
    );
    // 3. Inline italics: *text* -> <em> (safety net; model is told to avoid these)
    html = html.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    // 4. Build lines; group consecutive bullet lines (- or *) into <ul>.
    const lines = html.split(/\r?\n/);
    const out: string[] = [];
    let inList = false;

    const closeList = () => {
        if (inList) {
            out.push("</ul>");

            inList = false;
        }
    };

    for (const raw of lines) {
        const line = raw.trim();

        if (!line)
            continue;

        const heading = line.match(/^#{2,3}\s+(.*)$/);

        if (heading) {
            closeList();
            out.push(`<div class="sw-advice-heading">${heading[1]}</div>`);
            continue;
        }

        const bullet = line.match(/^[-*]\s+(.*)$/);

        if (bullet) {
            if (!inList) {
                out.push("<ul>");
                inList = true;
            }

            out.push(`<li>${bullet[1]}</li>`);
        } else {
            closeList();
            out.push(`<p>${line}</p>`);
        }
    }

    closeList();

    return out.join("");
};

function escapeHtml(text: string): string {
    const div = document.createElement("div");

    div.textContent = text;

    return div.innerHTML;
};

function updateOnlineStatus() {
    if (offlineBanner) {
        offlineBanner.style.display = navigator.onLine ? "none" : "block";
    }
};

function openAdviceModal(vote: VoteRecord) {
    // Advice is a signed-in feature.
    if (!currentAuth.signedIn) {
        setStatus(authStatus, "Sign in to get story coaching.", "error");

        return;
    }

    if (adviceModal)
        adviceModal.hidden = false;

    // If a story exists for this vote, resume it.
    if (currentStory && currentStory.contentId===vote.contentId) {
        activeStory = currentStory;

        showAdviceInput();
        renderAdviceModal();

        return;
    }

    // New story -> show inline confirmation first.
    pendingStoryVote = vote;

    if (adviceContext)
        adviceContext.hidden = true;

    if (adviceConfirmText)
        adviceConfirmText.innerHTML = `Develop your free story from "<span class="sw-title">${escapeHtml(vote.title)}</span>"? You get 3 coaching rounds. On the free plan, you can develop only one story, and the post can't be changed once you begin.`;

    if (adviceConfirm)
        adviceConfirm.hidden = false;

    if (adviceInputArea)
        adviceInputArea.hidden = true;

    if (adviceResult)
        adviceResult.hidden = true;

    setStatus(adviceStatus, "", "default");
}

function showAdviceInput() {
    if (adviceConfirm)
        adviceConfirm.hidden = true;

    if (adviceInputArea)
        adviceInputArea.hidden = false;

    if (adviceContext)
        adviceContext.hidden = false;
}

function renderAdviceModal() {
    if (!activeStory)
        return;

    showAdviceInput();

    const usedTurns = activeStory.turns.length;
    const atLimit = usedTurns>=MAX_TURNS;

    if (adviceParagraphLabel)
        adviceParagraphLabel.textContent = usedTurns===0
            ? "Your opening paragraph (max 80 words)"
            : `Paragraph ${usedTurns + 1} of 3 (max 80 words)`
        ;

    if (adviceParagraph)
        adviceParagraph.placeholder = usedTurns===0
            ? "Write your opening paragraph here..."
            : "Continue your story here..."
        ;

    if (adviceContext)
        adviceContext.innerHTML = `
            <div class="sw-ctx-row">
                <span class="sw-ctx-label">Post/Article</span>
                <span class="sw-ctx-value">${escapeHtml(activeStory.postTitle)}</span>
            </div>
            ${activeStory.summary ? `
            <div class="sw-ctx-row">
                <span class="sw-ctx-label">Summary</span>
                <span class="sw-ctx-value">${escapeHtml(activeStory.summary)}</span>
            </div>` : ""}
            <div class="sw-ctx-row">
                <span class="sw-ctx-label">Genre</span>
                <span class="sw-ctx-value">${escapeHtml(activeStory.genre)}</span>
            </div>
        `;

    // Render conversation so far (paragraph + advice).
    if (adviceResult) {
        if (usedTurns>0) {
            adviceResult.innerHTML = activeStory.turns.map((t, i) => `
                <div class="sw-turn">
                    <div class="sw-turn-label">Your paragraph ${i + 1}</div>
                    <div class="sw-turn-para">${escapeHtml(t.paragraph)}</div>
                    <div class="sw-turn-advice">${renderMarkdown(t.advice)}</div>
                </div>
            `).join("");
            adviceResult.hidden = false;
        } else {
            adviceResult.hidden = true;
            adviceResult.innerHTML = "";
        }
    }

    // Input + submit vs. paywall.
    if (atLimit) {
        if (adviceInputArea)
            adviceInputArea.hidden = true;

        if (advicePaywall)
            advicePaywall.hidden = false;

        if (interestedInPaid) {
            if (adviceWaitlistBtn)
                adviceWaitlistBtn.hidden = true;

            setStatus(adviceWaitlistStatus, "You 're on the list - we'll email you at launch.", "success");
        } else {
            if (adviceWaitlistBtn)
                adviceWaitlistBtn.hidden = false;

            setStatus(adviceWaitlistStatus, "", "default");
        }

        setStatus(adviceStatus, "You've used all your free coaching rounds for this story.", "notice");
    } else {
        if (adviceInputArea)
            adviceInputArea.hidden = false;

        if (adviceSubmit) {
            adviceSubmit.hidden = false;
            adviceSubmit.disabled = false;
            adviceSubmit.textContent = usedTurns===0 ? "Get Advice" : "Continue Story";
        }

        if (advicePaywall)
            advicePaywall.hidden = true;

        if (adviceParagraph)
            adviceParagraph.value = "";

        updateWordCount();
        setStatus(adviceStatus, usedTurns===0 ? "Write your opening paragraph (max 80 words)." : `Round ${usedTurns + 1} of 3 - continue your story (max 80 words).`, "notice");
    }
};

function closeAdviceModal() {
    if (adviceModal)
        adviceModal.hidden = true;

    if (adviceConfirm)
        adviceConfirm.hidden = true;

    if (adviceInputArea)
        adviceInputArea.hidden = false;

    activeStory = null;
    pendingStoryVote = null;
};

function countWords(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
};

function updateWordCount() {
    const n = adviceParagraph ? countWords(adviceParagraph.value) : 0;

    if (adviceWordcount) {
        adviceWordcount.textContent = `${n} / ${MAX_ADVICE_WORDS} words`;
        adviceWordcount.style.color = (n>MAX_ADVICE_WORDS) ? "var(--danger)" : "var(--muted)";
    }
};

async function submitAdvice() {
    if (!activeStory || !adviceParagraph)
        return;

    const paragraph = adviceParagraph.value.trim();

    if (!paragraph) {
        setStatus(adviceStatus, "Write your paragraph first.", "error");

        return;
    }

    if (countWords(paragraph)>MAX_ADVICE_WORDS) {
        setStatus(adviceStatus, `Please keepit under ${MAX_ADVICE_WORDS} words.`, "error");

        return;
    }

    if (adviceSubmit)
        adviceSubmit.disabled = true;

    setStatus(adviceStatus, "Getting advice", "loading");

    const response = await browser.runtime.sendMessage({
        type: "SW_GET_ADVICE",
        payload: {
            voteId: activeStory.contentId,
            genre: activeStory.genre,
            postTitle: activeStory.postTitle,
            postContent: activeStory.postContent,
            paragraph,
        },
    });

    if (adviceSubmit)
        adviceSubmit.disabled = false;

    if (!response?.ok && response?.error==="FREE_LIMIT_REACHED") {
        if (adviceSubmit)
            adviceSubmit.hidden = true;

        if (advicePaywall)
            advicePaywall.hidden = false;

        return;
    }

    if (!response?.ok && response?.error==="AUTH_EXPIRED") {
        await forceSignOut("Your session expired. Please sign in again.");

        return;
    }

    if (!response?.ok) {
        setStatus(adviceStatus, response?.error || "Could not get advice.", "error");

        return;
    }

    // Append turn, persist, re-render.
    if (response.data.summary && !activeStory.summary)
        activeStory.summary = response.data.summary;

    activeStory.turns.push({
        paragraph,
        advice: response.data.advice,
    });
    activeStory.updatedAt = new Date().toISOString();
    currentStory = activeStory;

    renderAdviceModal();
    loadVoteHistory();
};

async function joinWaitlist() {
    setStatus(adviceWaitlistStatus, "Adding you...", "notice");

    const response = await browser.runtime.sendMessage({ type: "SW_JOIN_WAITLIST" });

    if (!response?.ok) {
        setStatus(adviceWaitlistStatus, response?.error || "Could not add you.", "error");

        return;
    }

    interestedInPaid = true;

    if (adviceWaitlistBtn)
        adviceWaitlistBtn.hidden = true;

    setStatus(adviceWaitlistStatus, "You're on the list - we'll email you at launch.", "success");

    if (adviceWaitlistBtn)
        adviceWaitlistBtn.disabled = true;
};

async function forceSignOut(reason: string) {
    await browser.runtime.sendMessage({ type: "SW_AUTH_SIGN_OUT" });
    await browser.runtime.sendMessage({ type: "SW_CLEAR_LOCAL_DATA" });
    await browser.storage.local.remove(LAST_ACTIVE_KEY);

    clearInactivityTimer();
    closeAdviceModal();
    renderAuth({
        signedIn: false,
        email: null,
        userId: null,
    });
    setStatus(authStatus, reason, "notice");
};

function clearInactivityTimer() {
    if (inactivityTimer) {
        clearInterval(inactivityTimer);

        inactivityTimer = null;
    }
};

function resetInactivityTimer(stamp = true) {
    // Only track inactivity while signed in.
    if (!currentAuth.signedIn) {
        clearInactivityTimer();

        return;
    }

    if (stamp)
        markActive();

    if (!inactivityTimer) {
        // Poll every minute: if an hour has passed since last activity, sign out.
        inactivityTimer = setInterval(async () => {
            const last = await getLastActive();

            if ((Date.now() - last)>=INACTIVITY_MS)
                forceSignOut("Signed out after 1 hour of inactivity. Sign in to resume your story.");
        }, 60 * 1000);
    }
};
