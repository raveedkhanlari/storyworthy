import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLES, ok, fail, getAuth } from "./shared";

export const handler = async (event: APIGatewayProxyEventV2) => {
    const claims = getAuth(event);

    if (!claims)
        return fail("Unauthorized", 401);

    const votes: any[] = [];
    let lastKey: Record<string, any> | undefined;

    do {
        const res = await ddb.send(new QueryCommand({
            TableName: TABLES.votes,
            IndexName: "byUser",
            KeyConditionExpression: "userId = :uid",
            ExpressionAttributeValues: { ":uid": claims.sub },
            ExclusiveStartKey: lastKey,
        }));

        for (const item of res.Items ?? []) {
            votes.push({
                contentId: item.contentId,
                category: item.category,
                platform: item.platform ?? "web",
                title: item.title ?? "",
                url: item.url ?? "",
                votedAt: item.votedAt ?? "",
            });
        }

        lastKey = res.LastEvaluatedKey;
    } while (lastKey);

    votes.sort((a, b) => (b.votedAt>a.votedAt ? 1 : -1));

    return ok({ votes });
};