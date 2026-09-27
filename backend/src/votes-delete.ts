import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLES, ok, fail, getAuth } from "./shared";

export const handler = async (event: APIGatewayProxyEventV2) => {
    const claims = getAuth(event);
    let payload: any;

    if (!claims)
        return fail("Unauthorized", 401);

    if (!event.body)
        return fail("Missing request body");

    try {
        payload = JSON.parse(event.body);
    } catch {
        return fail("Invalid JSON");
    }

    const contentId = typeof payload.contentId==="string" ? payload.contentId : "";

    if (!contentId)
        return fail("Missing contentId");

    // Find all of this user's vote rows for this content (across devices) via GSI.
    const res = await ddb.send(new QueryCommand({
        TableName: TABLES.votes,
        IndexName: "byUser",
        KeyConditionExpression: "userId = :uid AND contentId = :cid",
        ExpressionAttributeValues: {
            ":uid": claims.sub,
            ":cid": contentId,
        },
    }));

    let deleted = 0;

    for (const item of res.Items ?? []) {
        // VotesTable primary key is (contentId HASH, installId RANGE).
        await ddb.send(new DeleteCommand({
            TableName: TABLES.votes,
            Key: {
                contentId: item.contentId,
                installId: item.installId,
            },
        }));

        deleted++;
    }

    return ok({
        contentId,
        deleted,
    });
};
