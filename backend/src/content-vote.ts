import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLES, ok, fail } from "./shared";

export const handler = async (event: APIGatewayProxyEventV2) => {
    const contentId = event.pathParameters?.contentId;

    if (!contentId) {
        return fail("Missing contentId");
    }

    if (!event.body) {
        return fail("Missing request body");
    }

    let payload: any;

    try {
        payload = JSON.parse(event.body);
    } catch {
        return fail("Invalid JSON");
    }

    const { installId, category } = payload;

    if (!installId || !category) {
        return fail("Missing installId or category");
    }

    // One vote per user per content: composite key overwrites any prior vote
    await ddb.send(new PutCommand({
        TableName: TABLES.votes,
        Item: {
            contentId,
            installId,
            category,
            votedAt: new Date().toISOString(),
        },
    }));

    return ok({ contentId, category});
};
