import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLES, ok, fail, getAuth } from "./shared";

export const handler = async (event: APIGatewayProxyEventV2) => {
    const claims = getAuth(event);

    if (!claims)
        return fail("Unauthorized", 401);

    const userId = claims.sub ?? null;

    if (!event.body)
        return fail("Missing request body");

    let payload: any;

    try {
        payload = JSON.parse(event.body);
    } catch {
        return fail("Invalid JSON");
    }

    const contentId = typeof payload.contentId==="string" ? payload.contentId : "";

    if (!contentId)
        return fail("Missing contentId");

    await ddb.send(new DeleteCommand({
        TableName: TABLES.votes,
        Key: {
            contentId: contentId,
            userId: userId,
        },
    }));

    return ok({
        contentId,
        deleted: 1,
    });
};
