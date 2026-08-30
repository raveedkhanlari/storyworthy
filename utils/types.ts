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
    | { type: "SW_GET_VOTE_FOR_CONTENT"; payload: { contentId: string } };

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
