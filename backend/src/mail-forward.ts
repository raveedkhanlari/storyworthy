import type { S3Event } from "aws-lambda";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { SESClient, SendRawEmailCommand } from "@aws-sdk/client-ses";

const s3 = new S3Client({});
const ses = new SESClient({});

const FORWARD_TO = process.env.FORWARD_TO!;
const FORWARD_FROM = process.env.FORWARD_FROM!;

export const handler = async (event: S3Event): Promise<void> => {
    for (const record of event.Records) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

        // SES writes a setup-notification object on first use; skip non-email keys.
        if (key.endsWith("AMAZON_SES_SETUP_NOTIFICATION"))
            continue;

        const obj = await s3.send(new GetObjectCommand({ 
            Bucket: bucket,
            Key: key,
        }));
        const raw = await obj.Body!.transformToString("utf-8");
        const rewritten = rewriteHeaders(raw);

        const res = await ses.send(new SendRawEmailCommand({
            RawMessage: { Data: new TextEncoder().encode(rewritten) },
            Destinations: [FORWARD_TO],
            Source: FORWARD_FROM,
        }));

        console.log("forwarded", { key, messageId: res.MessageId });
    }
};

// Replace From/Return-Path with our verified domain, preserve original sender as Reply-To, and force recipient to our forward address.
function rewriteHeaders(raw: string): string {
    const splitIdx = raw.indexOf("\r\n\r\n")>=0 ? raw.indexOf("\r\n\r\n") : raw.indexOf("\n\n");
    const sep = raw.indexOf("\r\n\r\n")>=0 ? "\r\n" : "\n";

    let headers = raw.slice(0, splitIdx);

    const body = raw.slice(splitIdx);
    const originalFrom = matchHeader(headers, "From") ?? "unknown sender";

    // Drop headers we must not keep.
    const dropItems = ["From", "Return-Path", "Reply-To", "To", "DKIM-Signature", "Sender"];
    for (let dItem of dropItems) {
        headers = stripHeader(headers, dItem);
    }

    const added = [
        `From: StoryWorthy Privacy <${FORWARD_FROM}>`,
        `Reply-To: ${originalFrom}`,
        `To: ${FORWARD_TO}`,
    ].join(sep);

    return `${added}${sep}${headers}${body}`;
}

function matchHeader(headers: string, name: string): string | null {
    const re = new RegExp(`^${name}:\\s*(.*)$`, "im");
    const m = headers.match(re);

    return m ? m[1].trim() : null;
}

function stripHeader(headers: string, name: string): string {
    // Remove header line and any folded continuation lines.
    const re = new RegExp(`^${name}:.*(?:\\r?\\n[ \\t].*)*\\r?\\n?`, "im");

    return headers.replace(re, "");
}