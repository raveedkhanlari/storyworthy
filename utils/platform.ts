const hostNames = [
    "localhost",
    "::1" // IPv6 loopback (URL parser wraps IPv6 in brackets, which it strips from hostname).
];
const internalSuffixes = [
    ".localhost",
    ".local",
    ".internal",
    ".home",
    ".lan"
];
const localIpPatterns = [
    /^127\./, // IPv4 loopback: 127.0.0.0/8
    // Private IPv4 ranges (RFC 1918): 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./ // Link-local IPv4: 169.254.0.0/16
];
const adultDomains = [
    "pornhub", "xvideos", "xnxx", "xhamster", "redtube", "youporn", "youjizz", "spankbang", "brazzers", "onlyfans", "chaturbate", "livejasmin", "stripchat", "bongacams", "cam4", "myfreecams", "fansly", "rule34", "nhentai", "hentai", "fapello", "motherless", "tnaflix", "eporner", "porntrex", "hclips", "txxx"
];
const adultTlds = [
    ".xxx", ".adult", ".porn", ".sex", ".sexy", ".cam", ".tube"
];

export function isSupportedUrl(url: string | undefined): boolean {
    if (!url)
        return false;

    let parsed: URL;

    try {
        parsed = new URL(url);
    } catch {
        return false;
    }

    if (parsed.protocol!=="http:" && parsed.protocol!=="https:")
        return false;

    if (!parsed.hostname)
        return false;

    const hostname = parsed.hostname.toLowerCase();

    if (isLocalOrInternalHost(hostname))
        return false;

    if (isAdultHost(hostname))
        return false;

    return true;
}

function isLocalOrInternalHost(hostname: string): boolean {
    switch (true) {
        case hostNames.some(x => hostname===x):
            return true;
        case internalSuffixes.some(x => hostname.endsWith(x)):
            return true;
        case localIpPatterns.some(x => x.test(hostname)):
            return true;
        default:
            return false;
    }
}

function isAdultHost(hostname: string): boolean {
    if (adultTlds.some(tld => hostname.endsWith(tld)))
        return true;

    const labels = hostname.split(".");

    return adultDomains.some(name => labels.includes(name));
}
