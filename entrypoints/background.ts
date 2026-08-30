import { defineBackground } from "wxt/utils/define-background";
import { browser, type Browser } from "wxt/browser";
import { isSupportedUrl } from "@/utils/platform";
import type {
    InitPagePayload,
    SubmitVotePayload,
    UserProfile,
    ExtensionMessage,
    ApiEnvelope,
    VoteRecord,
} from "@/utils/types";

const STORAGE_KEYS = {
    installId: "sw_install_id",
    profile: "sw_profile",
    votes: "sw_votes",
} as const;

export default defineBackground(() => {
    const API_BASE = import.meta.env.WXT_API_BASE_URL || "https://api.storyworthy.app";

    browser.runtime.onInstalled.addListener(async (details: Browser.runtime.InstalledDetails) => {
        await getInstallId();

        if (details.reason==="install") {
            console.log("Storyworthy installed");
        };
    });

    browser.runtime.onMessage.addListener((message: ExtensionMessage, sender: Browser.runtime.MessageSender, sendResponse: (response: ApiEnvelope) => void) => {
        switch(message.type) {
            case "SW_GET_INSTALL_CONTEXT":
                getInstallContext()
                    .then(sendResponse)
                    .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
                return true;
            case "SW_INIT_PAGE":
                initPage(message.payload)
                    .then(sendResponse)
                    .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
                return true;
            case "SW_SUBMIT_VOTE":
                submitVote(message.payload)
                    .then(sendResponse)
                    .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
                return true;
            case "SW_SAVE_PROFILE":
                saveProfile(message.payload)
                    .then(sendResponse)
                    .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
                return true;
            case "SW_OPEN_SIDEPANEL":
                openSidePanel(sender.tab?.id)
                    .then(() => sendResponse({ ok: true }))
                    .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
                return true;
            case "SW_GET_VOTE_HISTORY":
                getVoteHistory()
                    .then(sendResponse)
                    .catch((error: Error) => sendResponse({
                        ok: false, error: error.message
                    }));
                return true;
            case "SW_GET_VOTE_FOR_CONTENT":
                getVoteForContent(message.payload.contentId)
                    .then(sendResponse)
                    .catch((error: Error) => sendResponse({
                        ok: false, error: error.message
                    }));
                return true;
            default:
                return false;
        };        
    });

    // Open side panel when toolbar icon is clicked
    browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

    // Disable side panel globally by default
    browser.sidePanel.setOptions({ enabled: false });

    // Enable side panel only on supported pages
    browser.tabs.onUpdated.addListener(async (tabId, _changeInfo, tab) => {
        if (!tab.url) return;

        const isSupported = isSupportedUrl(tab.url);

        await browser.sidePanel.setOptions({
            tabId,
            path: "sidepanel.html",
            enabled: isSupported,
        });

        if (isSupported) {
            await browser.action.setIcon({
                tabId,
                path: {
                    "16": "icons/icon-16.png",
                    "48": "icons/icon-48.png",
                    "128": "icons/icon-128.png",
                },
            });
            await browser.action.setTitle({ tabId, title: "Open StoryWorthy" });
        } else {
            await browser.action.setIcon({
                tabId,
                path: {
                    "16": "icons/icon-16-grey.png",
                    "48": "icons/icon-48-grey.png",
                    "128": "icons/icon-128-grey.png",
                },
            });
            await browser.action.setTitle({ tabId, title: "StoryWorthy is not available on this page" });
        }
    });

    // Also check when switching tabs
    browser.tabs.onActivated.addListener(async ({ tabId }) => {
        const tab = await browser.tabs.get(tabId);

        if (!tab.url) {
            await browser.sidePanel.setOptions({ tabId, enabled: false });
            await browser.action.setIcon({
                tabId,
                path: {
                    "16": "icons/icon-16-grey.png",
                    "48": "icons/icon-48-grey.png",
                    "128": "icons/icon-128-grey.png",
                },
            });
            await browser.action.setTitle({ tabId, title: "StoryWorthy is not available on this page" });
            return;
        }

        const isSupported = isSupportedUrl(tab.url);

        await browser.sidePanel.setOptions({
            tabId,
            path: "sidepanel.html",
            enabled: isSupported,
        });

        if (isSupported) {
            await browser.action.setIcon({
                tabId,
                path: {
                    "16": "icons/icon-16.png",
                    "48": "icons/icon-48.png",
                    "128": "icons/icon-128.png",
                },
            });
            await browser.action.setTitle({ tabId, title: "Open StoryWorthy" });
        } else {
            await browser.action.setIcon({
                tabId,
                path: {
                    "16": "icons/icon-16-grey.png",
                    "48": "icons/icon-48-grey.png",
                    "128": "icons/icon-128-grey.png",
                },
            });
            await browser.action.setTitle({ tabId, title: "StoryWorthy is not available on this page" });
        }
    });

    syncPendingVotes();
    setInterval(syncPendingVotes, 5 * 60 * 1000);
    
    async function getInstallId(): Promise<string> {
        const data = await browser.storage.local.get([STORAGE_KEYS.installId]);
        const existing = data[STORAGE_KEYS.installId];

        if (typeof existing==="string" && existing.length>0) {
            return existing;
        };

        const installId = crypto.randomUUID();

        await browser.storage.local.set({ [STORAGE_KEYS.installId]: installId });

        return installId;
    };

    async function getInstallContext(): Promise<ApiEnvelope<{ installId: string; profile: UserProfile | null }>> {
        const installId = await getInstallId();
        const data = await browser.storage.local.get([STORAGE_KEYS.profile]);

        return {
            ok: true,
            data: {
                installId,
                profile: (data[STORAGE_KEYS.profile] as UserProfile | undefined) ?? null,
            },
        };
    };

    async function initPage(page: InitPagePayload) {
        const installId = await getInstallId();
        const data = await browser.storage.local.get([STORAGE_KEYS.profile]);
        const profile = data[STORAGE_KEYS.profile] || null;
        const response = await fetch(`${API_BASE}/api/content/init`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ installId, profile, page }),
        });

        if (!response.ok) {
            throw new Error("Failed to initialize page");
        }

        return await response.json();
    };

    async function submitVote(payload: SubmitVotePayload) {
        const vote: VoteRecord = {
            contentId: payload.contentId,
            category: payload.category,
            platform: payload.page.platform,
            title: payload.page.title,
            url: payload.page.canonicalUrl,
            votedAt: new Date().toISOString(),
            synced: false,
        };

        // Always save locally first
        await saveVoteLocally(vote);

        try {
            const installId = await getInstallId();
            const response = await fetch(`${API_BASE}/api/content/${payload.contentId}/vote`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ 
                    installId,
                    category: payload.category,
                    page: payload.page,
                }),
            });

            if (!response.ok) {
                throw new Error("API returned non-OK status");
            }

            await markVoteSynced(vote.votedAt);

            return {
                ok: true,
                data: await response.json(),
            };
        } catch {
            // Saved locally, will sync later
            return {
                ok: true,
                data: { queued: true }
            };
        }
    };

    async function saveProfile(profile: UserProfile) {
        await browser.storage.local.set({ [STORAGE_KEYS.profile]: profile });

        const installId = await getInstallId();
        const response = await fetch(`${API_BASE}/api/users/bootstrap`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                installId,
                ...profile,
            }),
        });

        if (!response.ok) {
            throw new Error("Failed to save profile");
        };

        return {
            ok: true,
            data: await response.json(),
        };
    };

    async function openSidePanel(tabId?: number) {
        if (!tabId)
            return;

        await browser.sidePanel.open({ tabId });
    };

    async function getVoteHistory(): Promise<ApiEnvelope<{ votes: VoteRecord[] }>> {
        const data = await browser.storage.local.get([STORAGE_KEYS.votes]);
        const votes = (data[STORAGE_KEYS.votes] as VoteRecord[] | undefined) ?? [];

        return {
            ok: true,
            data: { votes },
        };
    };

    async function saveVoteLocally(vote: VoteRecord) {
        const data = await browser.storage.local.get([STORAGE_KEYS.votes]);
        let votes = (data[STORAGE_KEYS.votes] as VoteRecord[] | undefined) ?? [];

        // Only one vote per content: remove any existing vote for this contentId
        votes = votes.filter(v => v.contentId !== vote.contentId);

        votes.unshift(vote);

        if (votes.length>50) {
            votes.length = 50;
        }

        await browser.storage.local.set({
            [STORAGE_KEYS.votes]: votes
        });
    };

    async function getVoteForContent(contentId: string): Promise<ApiEnvelope<{ category: string | null }>> {
        const data = await browser.storage.local.get([STORAGE_KEYS.votes]);
        const votes = (data[STORAGE_KEYS.votes] as VoteRecord[] | undefined) ?? [];
        const vote = votes.find(v => v.contentId === contentId);

        return {
            ok: true,
            data: { category: vote?.category ?? null },
        };
    };

    async function markVoteSynced(votedAt: string) {
        const data = await browser.storage.local.get([STORAGE_KEYS.votes]);
        const votes = (data[STORAGE_KEYS.votes] as VoteRecord[] | undefined) ?? [];
        const vote = votes.find(v => v.votedAt===votedAt);

        if (vote) {
            vote.synced = true;
            await browser.storage.local.set({ [STORAGE_KEYS.votes]: votes });
        }
    };

    async function syncPendingVotes() {
        const data = await browser.storage.local.get([STORAGE_KEYS.votes]);
        const votes = (data[STORAGE_KEYS.votes] as VoteRecord[] | undefined) ?? [];
        const pending = votes.filter(v => !v.synced);

        if (!pending.length) 
            return;

        const installId = await getInstallId();

        for (const vote of pending) {
            try {
                const response = await fetch(`${API_BASE}/api/content/${vote.contentId}/vote`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        installId,
                        category: vote.category,
                        page: {
                            platform: vote.platform,
                            url: vote.url,
                            canonicalUrl: vote.url,
                            pageKey: vote.contentId,
                            title: vote.title,
                            authorHandle: null,
                            contentType: "post",
                        },
                    }),
                });

                if (response.ok) {
                    await markVoteSynced(vote.votedAt);
                }
            } catch {
                // Still offline - stop trying the rest
                break;
            }
        }
    };
});
