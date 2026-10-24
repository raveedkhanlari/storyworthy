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
    AuthState,
    AdvicePayload,
    StoryThread,
} from "@/utils/types";

const STORAGE_KEYS = {
    installId: "sw_install_id",
    profile: "sw_profile",
    auth: "sw_auth", // { token, userId, email }
} as const;

export default defineBackground(() => {
    const API_BASE = import.meta.env.WXT_API_BASE_URL || "https://api.storyworthy.app";
    type StoredAuth = { token: string, userId: string, email: string };

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
            case "SW_GET_AUTH_STATE":
                getAuthState()
                    .then(sendResponse)
                    .catch((error: Error) => sendResponse({
                        ok: false,
                        error: error.message,
                    }));
                return true;
            case "SW_AUTH_REQUEST_CODE":
                authRequestCode(message.payload.email)
                    .then(sendResponse)
                    .catch((error: Error) => sendResponse({
                        ok: false,
                        error: error.message,
                    }));
                return true;
            case "SW_AUTH_VERIFY_CODE":
                authVerifyCode(message.payload.email, message.payload.code)
                    .then(sendResponse)
                    .catch((error: Error) => sendResponse({
                        ok: false,
                        error: error.message,
                    }));
                    return true;
            case "SW_AUTH_SIGN_OUT":
                authSignOut()
                    .then(sendResponse)
                    .catch((error: Error) => sendResponse({
                        ok: false,
                        error: error.message,
                    }));
                return true;
            case "SW_GET_ADVICE":
                getAdvice(message.payload)
                    .then(sendResponse)
                    .catch((error: Error) => sendResponse({
                        ok: false,
                        error: error.message,
                    }));
                return true;
            case "SW_JOIN_WAITLIST":
                joinWaitList()
                    .then(sendResponse)
                    .catch((error: Error) => sendResponse({
                        ok: false,
                        error: error.message,
                    }));
                return true;
            case "SW_CLEAR_LOCAL_DATA":
                clearLocalData()
                    .then(sendResponse)
                    .catch((error: Error) => sendResponse({
                        ok: false,
                        error: error.message,
                    }));
                return true;
            case "SW_OPEN_LINK":
                openLink(message.payload.url)
                    .then(sendResponse)
                    .catch((error: Error) => sendResponse({
                        ok: false,
                        error:error.message,
                    }));
                return true;
            case "SW_DELETE_VOTE":
                deleteVote(message.payload.contentId)
                    .then(sendResponse)
                    .catch((error: Error) => sendResponse({
                        ok: false,
                        error: error.message
                    }));
                return true;
            case "SW_GET_SERVER_STORY":
                getServerStory()
                    .then(sendResponse)
                    .catch((error: Error) => sendResponse({
                        ok: false,
                        error: error.message,
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
        const auth = await getStoredAuth();

        if (!auth)
            return {
                ok: false,
                error: "SIGN_IN_REQUIRED",
            };

        const installId = await getInstallId();
        const response = await fetch(`${API_BASE}/api/content/${payload.contentId}/vote`, {
            method: "POST",
            headers: { 
                "content-type": "application/json",
                ...(await authHeaders()), 
            },
            body: JSON.stringify({
                installId,
                category: payload.category,
                page: payload.page,
                postContent: payload.postContent,
            }),
        });

        if (response.status===401)
            return {
                ok: false,
                error: "SIGN_IN_REQUIRED",
            };

        if (!response.ok) {
            const body = await response.json().catch(() => null);

            return {
                ok: false,
                error: body?.error || "Failed to submit vote.",
                lockedCategory: body?.lockedCategory ?? null,
            };
        }

        await browser.storage.local.set({ sw_votes_updated: Date.now() });

        return {
            ok: true,
            data: await response.json(),
        };
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
        const auth = await getStoredAuth();

        if (!auth)
            return {
                ok: true,
                data: { votes: [] },
            };

        const response = await fetch(`${API_BASE}/api/votes`, {
            method: "GET",
            headers: { ...(await authHeaders()) },
        });

        if (response.status===401)
            return {
                ok: false,
                error: "AUTH_EXPIRED",
            };

        if (!response.ok)
            return {
                ok: false,
                error: "Could not load votes.",
            };

        const json = await response.json();
        const votes: VoteRecord[] = (json?.data?.votes ?? []).map((v: any) => ({
            contentId: v.contentId,
            category: v.category,
            platform: v.platform ?? "web",
            title: v.title ?? "",
            url: v.url ?? "",
            votedAt: v.votedAt ?? "",
            postContent: v.postContent ?? undefined,
            synced: true,
        }));

        return {
            ok: true,
            data: { votes },
        };
    };

    async function getStoredAuth(): Promise<StoredAuth | null> {
        const data = await browser.storage.local.get([STORAGE_KEYS.auth]);

        return (data[STORAGE_KEYS.auth] as StoredAuth | undefined) ?? null;
    };

    async function authHeaders(): Promise<Record<string, string>> {
        const auth = await getStoredAuth();

        return auth ? { authorization: `Bearer ${auth.token}` } : {};
    };

    async function getAuthState(): Promise<ApiEnvelope<AuthState>> {
        const auth = await getStoredAuth();

        return {
            ok: true,
            data: {
                signedIn: !!auth,
                email: auth?.email ?? null,
                userId: auth?.userId ?? null,
            },
        };
    };

    async function authRequestCode(email: string): Promise<ApiEnvelope> {
        const response = await fetch(`${API_BASE}/api/auth/request-code`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email }),
        });
        const json = await response.json();

        if (!response.ok || !json.ok)
            throw new Error(json.error || "Could not send code.");

        return {
            ok: true,
            data: json.data,
        };
    };

    async function authVerifyCode(email: string, code: string): Promise<ApiEnvelope<AuthState>> {
        const installId = await getInstallId();
        const response = await fetch(`${API_BASE}/api/auth/verify-code`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ 
                email,
                code,
                installId
            }),
        });
        const json = await response.json();

        if (!response.ok || !json.ok)
            throw new Error(json.error || "Could not verify code.");

        const { token, userId, email: verifiedEmail } = json.data;

        await browser.storage.local.set({
            [STORAGE_KEYS.auth]: {
                token,
                userId,
                email: verifiedEmail,
            },
        });

        return {
            ok: true,
            data: {
                signedIn: true,
                email: verifiedEmail,
                userId,
            },
        };
    };

    async function authSignOut(): Promise<ApiEnvelope> {
        await browser.storage.local.remove(STORAGE_KEYS.auth);

        return { ok: true };
    };

    async function getAdvice(payload: AdvicePayload): Promise<ApiEnvelope> {
        const response = await fetch(`${API_BASE}/api/story/advise`, {
            method: "POST",
            headers: { "content-type": "application/json", ...(await authHeaders()) },
            body: JSON.stringify({
                voteId: payload.voteId,
                genre: payload.genre,
                postTitle: payload.postTitle,
                postContent: payload.postContent,
                paragraph: payload.paragraph,
            }),
        });

        const json = await response.json();

        // Token is expired (30-day expiry is elapsed).
        if (response.status===401)
            return {
                ok: false,
                error: "AUTH_EXPIRED",
            };

        // Paywall signal: trial exhausted.
        if (response.status===402)
            return {
                ok: false,
                error: "FREE_LIMIT_REACHED",
            };

        // Freemium one-story-limit check
        if (response.status===409)
            return {
                ok: false,
                error: "ONE_STORY_ONLY"
            };
        
        if (!response.ok || !json.ok)
            return {
                ok: false,
                error: json.error || "Could not get advice.",
            };

        return {
            ok: true,
            data: json.data,
        };
    };

    async function getServerStory(): Promise<ApiEnvelope> {
        const response = await fetch(`${API_BASE}/api/story`, {
            method: "GET",
            headers: {
                ...(await authHeaders()),
            },
        });

        if (response.status===401)
            return {
                ok: false,
                error: "AUTH_EXPIRED",
            };

        const json = await response.json();

        if (!response.ok || !json.ok)
            return {
                ok: false,
                error: "Could not load sotry.",
            };

        return {
            ok: true,
            data: json.data,
        };
    }

    async function joinWaitList(): Promise<ApiEnvelope> {
        const response = await fetch(`${API_BASE}/api/story/waitlist`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                ...(await authHeaders()),
            },
        });

        const json = await response.json();

        if (!response.ok || !json.ok)
            return {
                ok: false,
                error: json.error || "Could not join the waitlist.",
            };

        return {
            ok: true,
            data: json.data,
        };
    };

    async function clearLocalData(): Promise<ApiEnvelope> {
        return { ok: true };
    };

    async function openLink(url: string): Promise<ApiEnvelope> {
        const [activeTab] = await browser.tabs.query({
            active: true,
            currentWindow: true,
        });

        if (activeTab?.id)
            await browser.tabs.update(activeTab.id, { url });

        return { ok: true };
    };

    async function deleteVote(contentId: string): Promise<ApiEnvelope> {
        // Remove from backend (only if signed in); deletes across account.
        const auth = await getStoredAuth();

        if (!auth)
            return {
                ok: false,
                error: "AUTH_EXPIRED",
            };

        const response = await fetch(`${API_BASE}/api/votes/delete`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                ...(await authHeaders()),
            },
            body: JSON.stringify({ contentId }),
        });

        if (response.status===401)
            return {
                ok: false,
                error: "AUTH_EXPIRED"
            };
            
        if (!response.ok)
            return {
                ok: false,
                error: "Could not delete vote.",
            };

        return {
            ok: true,
            data: { contentId },
        };
    };
});
