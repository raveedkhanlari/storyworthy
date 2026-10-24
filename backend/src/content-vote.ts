import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLES, ok, fail, getAuth, getUserTurns } from "./shared";

export const handler = async (event: APIGatewayProxyEventV2) => {
    const contentId = event.pathParameters?.contentId;

    if (!contentId)
        return fail("Missing contentId");

    if (!event.body)
        return fail("Missing request body");

    let payload: any;

    try {
        payload = JSON.parse(event.body);
    } catch {
        return fail("Invalid JSON");
    }

    const { installId, category, page, postContent } = payload;

    const claims = getAuth(event);

    if (!claims)
        return fail("SIGN_IN_REQUIRED", 401);

    if (!category)
        return fail("Missing category");

    const userId = claims.sub ?? null;
    const turns = await getUserTurns(userId);

    if (turns.some(t => t.voteId===contentId)) {
        const existing = await ddb.send(new GetCommand({
            TableName: TABLES.votes,
            Key: {
                contentId,
                userId,
            },
        }));

        return {
            statusCode: 409,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ok: false,
                error: "STORY_LOCKED",
                lockedCategory: existing.Item?.category ?? null,
            }),
        };
    }

    // One vote per user per content: composite key overwrites any prior vote
    await ddb.send(new PutCommand({
        TableName: TABLES.votes,
        Item: {
            contentId,
            userId,
            installId: installId ?? null,
            category,
            platform: page?.platform ?? null,
            title: page?.title ?? null,
            url: page?.canonicalUrl ?? page?.url ?? null,
            postContent: typeof postContent==="string" ? postContent.slice(0, 4000) : null,
            votedAt: new Date().toISOString(),
        },
    }));

    return ok({ contentId, category});
};
