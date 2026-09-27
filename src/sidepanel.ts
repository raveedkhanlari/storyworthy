import { browser } from "wxt/browser";
import type { UserProfile, InstallContextResponse, VoteRecord, AuthState } from "@/utils/types";

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

const PROFILE_ENABLED = false; // Profile is deferred to paid tier. Keep code but hide it in freemium tier.
const MAX_ADVICE_WORDS = 80;
const INACTIVITY_MS = 60 * 60 * 1000;
let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
let activeAdviceVote: VoteRecord | null = null;
let pendingAuthEmail: string | null = null;
let currentAuth: AuthState = { signedIn: false, email: null, userId: null };
let hasProfile = false;

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

    if (authCodeForm)
            authCodeForm.hidden = false;

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
    await loadVoteHistory();
});

authSignOutBtn?.addEventListener("click", async () => {
    await browser.runtime.sendMessage({ type: "SW_AUTH_SIGN_OUT" });
    await browser.runtime.sendMessage({ type: "SW_CLEAR_LOCAL_DATA" });

    if (authEmailInput)
        authEmailInput.value = "";

    renderAuth({
        signedIn: false,
        email: null,
        userId: null,
    });
    setStatus(authStatus, "Signed out.", "notice");
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
    if (changes.sw_votes) {
        loadVoteHistory();
    }
});

// Any interaction in panel counts as activity.
["click", "keydown", "input", "mousemove"].forEach((evt) => {
    document.addEventListener(evt, resetInactivityTimer, { passive: true });
});

async function init() {
    await loadAuthState();
    await loadInstallContext();
    await loadVoteHistory();
};

async function loadAuthState() {
    const response = await browser.runtime.sendMessage({ type: "SW_GET_AUTH_STATE" });

    if (response?.ok && response.data)
        renderAuth(response.data as AuthState);
};

function renderAuth(state: AuthState) {
    currentAuth = state;

    // Start/stop inactivity timer based on session state.
    resetInactivityTimer();

    const signedIn = state.signedIn;

    // Signed-out: show email input + Send button.Signed-in: hide them.
    if (authEmailField)
        authEmailField.hidden = signedIn;
    if (authSendBtn)
        authSendBtn.hidden = signedIn;

    // Signed-in: show read-only email line + Sign out.
    if (authSignedInField)
        authSignedInField.hidden = !signedIn;
    if (authSignOutBtn)
        authSignOutBtn.hidden = !signedIn;
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

function setStatus(el: HTMLDivElement | null, text: string, kind: "default" | "success" | "error" | "notice") {
    if (!el) {
        return;
    };

    el.textContent = text;
    el.className = "status";

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
                        data-vote-index="${i}"
                    >
                        Get Advice
                    </button>
                    <button
                        class="sw-delete-btn"
                        data-vote-index="${i}"
                    >
                        Delete Vote
                    </button>
                </div>
            </div>
        `).join("");

        // Get Advice button -> Open coaching modal
        historyList?.querySelectorAll<HTMLButtonElement>(".sw-advice-btn").forEach(btn => {
            btn.addEventListener("click", () => {
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
    //--- Advice is a signed-in feature ---//
    if (!currentAuth.signedIn) {
        setStatus(authStatus, "Sign in to get story coaching.", "error");

        return;
    }

    activeAdviceVote = vote;

    if (adviceContext)
        adviceContext.textContent = `${vote.platform} . ${vote.category} - ${vote.title}`;

    if (adviceParagraph)
        adviceParagraph.value = "";

    updateWordCount();
    setStatus(adviceStatus, "", "default");

    if (adviceResult) {
        adviceResult.hidden = true;
        adviceResult.textContent = "";
    }

    if (advicePaywall)
        advicePaywall.hidden = true;

    if (adviceSubmit) {
        adviceSubmit.hidden = false;
        adviceSubmit.disabled = false;
    }

    if (adviceModal)
        adviceModal.hidden = false;

    adviceParagraph?.focus();
};

function closeAdviceModal() {
    if (adviceModal)
        adviceModal.hidden = true;

    activeAdviceVote = null;
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
    if (!activeAdviceVote || !adviceParagraph)
        return;

    const paragraph = adviceParagraph.value.trim();

    if (!paragraph) {
        setStatus(adviceStatus, "Write your opening paragraph first.", "error");

        return;
    }

    if (countWords(paragraph)>MAX_ADVICE_WORDS) {
        setStatus(adviceStatus, `Please keepit under ${MAX_ADVICE_WORDS} words.`, "error");

        return;
    }

    if (adviceSubmit)
        adviceSubmit.disabled = true;

    setStatus(adviceStatus, "Getting advice...", "notice");

    if (adviceResult)
        adviceResult.hidden = true;

    const response = await browser.runtime.sendMessage({
        type: "SW_GET_ADVICE",
        payload: {
            contentId: activeAdviceVote.contentId,
            genre: activeAdviceVote.category,
            paragraph,
            postTitle: activeAdviceVote.title,
            postContent: activeAdviceVote.postContent ?? "",
        },
    });

    if (adviceSubmit)
        adviceSubmit.disabled = false;

    if (!response?.ok && response?.error==="AUTH_EXPIRED") {
        await forceSignOut("Your session expired. Please sign in again.");

        return;
    }

    // Free trial exhausted -> show paywall
    if (!response?.ok && response?.error==="FREE_LIMIT_REACHED") {
        setStatus(adviceStatus, "", "default");

        if (adviceSubmit)
            adviceSubmit.hidden = true;

        if (advicePaywall)
            advicePaywall.hidden = false;

        return;
    }

    if (!response?.ok) {
        setStatus(adviceStatus, response?.error || "Could not get advice.", "error");

        return;
    }

    setStatus(adviceStatus, `Advice ready. ${response.data.reviewsRemaining} free reviews left.`, "notice");

    if (adviceResult) {
        adviceResult.textContent = response.data.advice;
        adviceResult.hidden = false;
    }
};

async function joinWaitlist() {
    setStatus(adviceWaitlistStatus, "Adding you...", "notice");

    const response = await browser.runtime.sendMessage({ type: "SW_JOIN_WAITLIST" });

    if (!response?.ok) {
        setStatus(adviceWaitlistStatus, response?.error || "Could not add you.", "error");

        return;
    }

    setStatus(adviceWaitlistStatus, "You're on the list - we'll email you at launch.", "success");

    if (adviceWaitlistBtn)
        adviceWaitlistBtn.disabled = true;
};

async function forceSignOut(reason: string) {
    await browser.runtime.sendMessage({ type: "SW_AUTH_SIGN_OUT" });
    await browser.runtime.sendMessage({ type: "SW_CLEAR_LOCAL_DATA" });

    clearInactivityTimer();
    renderAuth({
        signedIn: false,
        email: null,
        userId: null,
    });
    setStatus(authStatus, reason, "notice");
};

function clearInactivityTimer() {
    if (inactivityTimer) {
        clearTimeout(inactivityTimer);

        inactivityTimer = null;
    }
};

function resetInactivityTimer() {
    // Only track inactivity while signed in.
    if (!currentAuth.signedIn) {
        clearInactivityTimer();

        return;
    }

    clearInactivityTimer();

    inactivityTimer = setTimeout(() => {
        forceSignOut("Signed out after 1 hour of inactivity. Sign in to resume your story.");
    }, INACTIVITY_MS);
};