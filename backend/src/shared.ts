import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import type { APIGatewayProxyResultV2, APIGatewayProxyEventV2 } from "aws-lambda";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "crypto";

const client = new DynamoDBClient({});
export const ddb = DynamoDBDocumentClient.from(client);

const ses = new SESClient({});

export const TABLES = {
    users: process.env.USERS_TABLE!,
    content: process.env.CONTENT_TABLE!,
    votes: process.env.VOTES_TABLE!,
    auth: process.env.AUTH_TABLE!,
};

const JWT_SECRET = process.env.JWT_SECRET!;
const SES_SENDER = process.env.SES_SENDER!;

export function ok(data: unknown): APIGatewayProxyResultV2 {
    return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true, data }),
    };
};

export function fail(message: string, statusCode = 400): APIGatewayProxyResultV2 {
    return {
        statusCode,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: false, error: message }),
    };
};

// --- base64url helpers --- //
function b64url(input: Buffer | string): string {
    return Buffer.from(input)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
};

function b64urlDecode(input: string): Buffer {
    const pad = (input.length % 4)===0
        ? ""
        : "=".repeat(4 - (input.length % 4))
    ;

    return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
};

// --- JWT (HS256) --- //
export type JwtClaims = {
    sub: string; //userId
    email: string;
    iat: number;
    exp: number;
};

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function signJwt(claims: { sub: string, email: string }): string {
    const header = {
        alg: "HS256",
        typ: "JWT",
    };
    const now = Math.floor(Date.now() / 1000);
    const body: JwtClaims = {
        sub: claims.sub,
        email: claims.email,
        iat: now,
        exp: now + TOKEN_TTL_SECONDS,
    };
    const headerPart = b64url(JSON.stringify(header));
    const bodyPart = b64url(JSON.stringify(body));
    const data = `${headerPart}.${bodyPart}`;
    const sig = b64url(createHmac("sha256", JWT_SECRET).update(data).digest());

    return `${data}.${sig}`;
};

export function verifyJwt(token: string): JwtClaims | null {
    const parts = token.split(".");

    if (parts.length!==3)
        return null;

    const [headerPart, bodyPart, sig] = parts;
    const data = `${headerPart}.${bodyPart}`;
    const expected = b64url(createHmac("sha256", JWT_SECRET).update(data).digest());
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);

    if (sigBuf.length!==expBuf.length || !timingSafeEqual(sigBuf, expBuf))
        return null;

    let claims: JwtClaims;

    try {
        claims = JSON.parse(b64urlDecode(bodyPart).toString("utf8"));
    } catch {
        return null;
    }

    if (typeof claims.exp!=="number" || claims.exp<Math.floor(Date.now() / 1000))
        return null;

    return claims;
};

// --- Pulls a bearer token from the request and returns its claims, or null. --- //
export function getAuth(event: APIGatewayProxyEventV2): JwtClaims | null {
    const header = 
        event.headers?.authorization ??
        event.headers?.Authorization ??
        ""
    ;
    const match = header.match(/^Bearer\s+(.+)$/i);

    if (!match)
        return null;

    return verifyJwt(match[1]);
};

// --- OTP helpers --- //
export function generateOtp(): string {
    // 6-digit numeric code, zero-padded
    const n = randomBytes(4).readUInt32BE(0) % 1_000_000;

    return n.toString().padStart(6, "0");
};

export function hashOtp(code: string, salt: string): string {
    // Hash OTP with a per-code salt so raw codes are never stored.
    return createHash("sha256").update(`${salt}.${code}`).digest("hex");
};

export function newSalt(): string {
    return randomBytes(16).toString("hex");
};

export function newUserId(): string {
    return randomUUID();
};

export function normalizeEmail(email: unknown): string | null {
    if (typeof email!=="string") 
        return null;

    const trimmed = email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed))
        return null;

    return trimmed;
};

export async function sendOtpEmail(toEmail: string, code: string): Promise<void> {
    await ses.send(new SendEmailCommand({
        Source: SES_SENDER,
        Destination: { ToAddresses: [toEmail] },
        Message: {
            Subject: { Data: "Your StoryWorthy sign-in code" },
            Body: {
                Text: {
                    Data: `Your StoryWorthy sign-in code is ${code}.\n\n It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
                },
                Html: {
                    Data: `<p>Your StoryWorthy sign-in code is <strong style="font-size:20px;letter-spacing:2px;">${code}</strong></p>` +
                        `<p>It expires in 10 minutes. If you didn't request this, you can ignore this email.</p>`,
                },
            },
        },
    }));
};