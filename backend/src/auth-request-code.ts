import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLES, ok, fail, generateOtp, hashOtp, newSalt, normalizeEmail, sendOtpEmail } from "./shared";

const OTP_TTL_SECONDS = 60 * 10; // 10 minutes

export const handler = async (event: APIGatewayProxyEventV2) => {
    if (!event.body)
        return fail("Missing request body");

    let payload: any;

    try {
        payload = JSON.parse(event.body);
    } catch {
        return fail("Invalid JSON");
    }

    const email = normalizeEmail(payload.email);

    if (!email)
        return fail("A valid email is required");

    const code = generateOtp();
    const salt = newSalt();
    const now = Math.floor(Date.now() / 1000);

    await ddb.send(new PutCommand({
        TableName: TABLES.auth,
        Item: {
            pk: `OTP#${email}`,
            sk: `OTP#${email}`,
            salt,
            codeHash: hashOtp(code, salt),
            attempts: 0,
            expiresAt: now + OTP_TTL_SECONDS,
            ttl: now + OTP_TTL_SECONDS,
            createdAt: new Date().toISOString(),
        },
    }));

    try {
        await sendOtpEmail(email, code);
    } catch(err) {
        console.error("Failed to send OTP email", err);

        return fail("Could not send the code. Please try again.", 502);
    }

    return ok({ sent: true });
};