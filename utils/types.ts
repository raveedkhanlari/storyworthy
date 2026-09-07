export type SupportedPlatform = "reddit" | "x" | "web";

export type InitPagePayload = {
    platform: SupportedPlatform;
    url: string;
    canonicalUrl: string;
    pageKey: string;
    title: string;
    authorHandle: string | null;
    contentType: "post" | "page";
};

export type SubmitVotePayload = {
    contentId: string;
    category: string;
    page: InitPagePayload;
};

export type UserProfile = {
    country: string;
    region?: string;
    email?: string;
    emailOptIn?: boolean;
};

export type ExtensionMessage =
    | { type: "SW_GET_INSTALL_CONTEXT" }
    | { type: "SW_INIT_PAGE"; payload: InitPagePayload }
    | { type: "SW_SUBMIT_VOTE"; payload: SubmitVotePayload }
    | { type: "SW_SAVE_PROFILE"; payload: UserProfile }
    | { type: "SW_OPEN_SIDEPANEL" }
    | { type: "SW_GET_VOTE_HISTORY" }
    | { type: "SW_GET_VOTE_FOR_CONTENT"; payload: { contentId: string } }
    | { type: "SW_GET_AUTH_STATE" }
    | { type: "SW_AUTH_REQUEST_CODE"; payload: { email: string } }
    | { type: "SW_AUTH_VERIFY_CODE"; payload: { email: string; code: string }}
    | { type: "SW_AUTH_SIGN_OUT" };

export type VoteRecord = {
    contentId: string;
    category: string;
    platform: SupportedPlatform;
    title: string;
    url: string;
    votedAt: string;
    synced: boolean;
};

export type ApiEnvelope<T = unknown> = {
    ok: boolean;
    data?: T;
    error?: string;
};

export type InstallContextResponse = ApiEnvelope<{
    installId: string;
    profile: UserProfile | null;
}>;

export type PostContext = {
    platform: SupportedPlatform;
    url: string;
    canonicalUrl: string;
    pageKey: string;
    title: string;
    authorHandle: string | null;
    contentType: "post" | "article";
};

export type DetectedPost = {
    element: HTMLElement;
    context: PostContext;
};

export type PanelController = {
    startIdleTimer: () => void;
    cancelIdleTimer: () => void;
    closeAfterResponse: () => void;
};

export type AuthState = {
    signedIn: boolean;
    email: string | null;
    userId: string | null;
};
