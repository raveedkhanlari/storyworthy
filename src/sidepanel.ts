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
const authEmailTag = document.querySelector<HTMLSpanElement>("#auth-email-tag");
const authSendBtn = document.querySelector<HTMLButtonElement>("#auth-send-btn");
const authStatus = document.querySelector<HTMLDivElement>("#auth-status");
const authCancelBtn = document.querySelector<HTMLButtonElement>("#auth-cancel");
const authSignOutBtn = document.querySelector<HTMLButtonElement>("#auth-signout");
const profileSection = document.querySelector<HTMLElement>("#profile-section");
const profilePrompt = document.querySelector<HTMLDivElement>("#profile-prompt");

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
    setStatus(authStatus, "Signed in. Your vote history is synced.", "notice");
    await loadVoteHistory();
});

authCancelBtn?.addEventListener("click", () => {
    pendingAuthEmail = null;

    if (authCodeForm)
            authCodeForm.hidden = true;

    if (authEmailForm)
            authEmailForm.hidden = false;

    if (authCodeInput)
        authCodeInput.value = "";

    setStatus(authStatus, "", "default");
});

authSignOutBtn?.addEventListener("click", async () => {
    await browser.runtime.sendMessage({ type: "SW_AUTH_SIGN_OUT" });

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

    const signedIn = state.signedIn;

    // Email field: shows the account email (read-only) when signed in.
    if (authEmailInput) {
        authEmailInput.disabled = signedIn;

        if (signedIn)
            authEmailInput.value = state.email ?? "";
    }

    // "(signed in)" tag next to the Email label.
    if (authEmailTag)
        authEmailTag.hidden = !signedIn;

    // Swap Send-code button for Sign-out when signed in.
    if (authSendBtn)
        authSendBtn.hidden = signedIn;

    if (authSignOutBtn)
        authSignOutBtn.hidden = !signedIn;

    // Code step is only shown mid-flow (never on load).
    if (authCodeForm)
        authCodeForm.hidden = true;

    updateProfileVisibility();
};

// Profile shows when signed out, or when signed in but no profile saved yet.
function updateProfileVisibility() {
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

    if (!response?.ok || !response.data?.votes?.length) {
        if (historyEmpty) {
            historyEmpty.hidden = false;
        }

        if (historyList) {
            historyList.hidden = true;
        }

        return;
    }

    if (historyEmpty) {
        historyEmpty.hidden = true;
    }

    if (historyList) {
        historyList.hidden = false;
        historyList.innerHTML = response.data.votes.map((vote: VoteRecord) => `
            <div class="meta-item">
                <div class="meta-label">${vote.platform} . ${vote.category}</div>
                <div><a href="${vote.url}" target="_blank">${escapeHtml(vote.title)}</a></div>
            </div>
        `).join("");   
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
