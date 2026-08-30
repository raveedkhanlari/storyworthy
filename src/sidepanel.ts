import { browser } from "wxt/browser";
import type { UserProfile, InstallContextResponse, VoteRecord } from "@/utils/types";

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

init().catch((error) => {
    setStatus(profileStatus, error instanceof Error ? error.message : "Failed to initialize.", "error");
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

    renderProfile(profile);
    setStatus(profileStatus, "Profile saved.", "success");
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
    await loadInstallContext();
    await loadVoteHistory();
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
        fillProfileForm(response.data.profile);
        renderProfile(response.data.profile);
    } else {
        renderProfile(null);
    };
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

function setStatus(el: HTMLDivElement | null, text: string, kind: "default" | "success" | "error") {
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
