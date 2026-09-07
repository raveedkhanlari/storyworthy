import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { GetCommand, PutCommand, DeleteCommand, UpdateCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLES, ok, fail, hashOtp, normalizeEmail, signJwt, newUserId } from "./shared";

const MAX_ATTEMPTS = 5;

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
    const code = typeof payload.code==="string" ? payload.code.trim() : "";
    const installId: string | null = typeof payload.installId==="string" ? payload.installId : null;

    if (!email || !code)
        return fail("Email and code are required");

    // 1. Load OTP challenge
    const otpRes = await ddb.send(new GetCommand({
        TableName: TABLES.auth,
        Key: {
            pk: `OTP#${email}`,
            sk: `OTP#${email}`,
        },
    }));

    const otp = otpRes.Item;
    const now = Math.floor(Date.now() / 1000);

    if (!otp || otp.expiresAt<now)
        return fail("Code expired or not found. Request a new one.");

    if ((otp.attempts ?? 0)>=MAX_ATTEMPTS)
        return fail("Too may attempts. Request a new code.", 429);

    // 2. Check code
    const matches = hashOtp(code, otp.salt)===otp.codeHash;

    if (!matches) {
        await ddb.send(new UpdateCommand({
            TableName: TABLES.auth,
            Key: {
                pk: `OTP#${email}`,
                sk: `OTP#${email}`,
            },
            UpdateExpression: "SET attempts = if_not_exists(attempts, :z) + :one",
            ExpressionAttributeValues: { ":z": 0, ":one": 1 },
        }));

        return fail("Incorrect code.", 401);
    }

    // 3. Consume OTP so it can't be reused
    await ddb.send(new DeleteCommand({
        TableName: TABLES.auth,
        Key: {
            pk: `OTP#${email}`,
            sk: `OTP#${email}`,
        },
    }));

    // 4. Resolve or create user
    const userKey = {
        pk: `USER#${email}`,
        sk: `USER#${email}`,
    };
    const userRes = await ddb.send(new GetCommand({
        TableName: TABLES.auth,
        Key: userKey,
    }));

    let userId: string;

    if (userRes.Item?.userId) {
        userId = userRes.Item.userId;
    } else {
        userId = newUserId();

        await ddb.send(new PutCommand({
            TableName: TABLES.auth,
            Item: {
                ...userKey,
                userId,
                email,
                createdAt: new Date().toISOString(),
            },
        }));
    }

    // 5. Link current install's votes to this user
    let linkedVotes = 0;

    if (installId)
        linkedVotes = await backfillInstallVotes(installId, userId);

    // 6. Issue token
    const token = signJwt({
        sub: userId,
        email,
    });

    return ok({
        token,
        userId,
        email,
        linkedVotes,
    });
};

async function backfillInstallVotes(installId: string, userId: string): Promise<number> {
    let count = 0;
    let lastKey: Record<string, any> | undefined;

    do {
        const scan = await ddb.send(new ScanCommand({
            TableName: TABLES.votes,
            FilterExpression: "installId = :iid AND attribute_not_exists(userId)",
            ExpressionAttributeValues: { ":iid": installId },
            ExclusiveStartKey: lastKey,
        }));

        for (const item of scan.Items ?? []) {
            await ddb.send(new UpdateCommand({
                TableName: TABLES.votes,
                Key: {
                    contentId: item.contentId,
                    installId: item.installId,
                },
                UpdateExpression: "SET userId = :uid",
                ExpressionAttributeValues: { ":uid": userId }
            }));

            count++;
        }

        lastKey = scan.LastEvaluatedKey;
    } while (lastKey);

    return count;
};