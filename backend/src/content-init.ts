import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { createHash } from "crypto";
import { ddb, TABLES, ok, fail } from "./shared";

export const handler = async (event: APIGatewayProxyEventV2) => {
    if (!event.body) {
        return fail("Missing request body");
    }

    let payload: any;

    try {
        payload = JSON.parse(event.body);
    } catch {
        return fail("Invalid JSON");
    }

    const { page } = payload;

    if (!page?.platform || !page?.pageKey) {
        return fail("Missing page platform or pageKey");
    }

    // Deterministic contentId from platform + pageKey
    const contentId = createHash("sha256")
        .update(`${page.platform}:${page.pageKey}`)
        .digest("hex")
        .slice(0, 24);
    
    await ddb.send(new PutCommand({
        TableName: TABLES.content,
        Item: {
            contentId,
            platform: page.platform,
            url: page.url ?? null,
            canonicalUrl: page.canonicalUrl ?? null,
            title: page.title ?? null,
            authorHandle: page.authorHandle ?? null,
            updatedAt: new Date().toISOString(),
        },
    }));

    return ok({ contentId });
};