export function isSupportedUrl(url: string | undefined): boolean {
    if (!url)
        return false;

    return /^https?:\/\//.test(url);
};