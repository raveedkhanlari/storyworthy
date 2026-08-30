import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyResultV2 } from "aws-lambda";

const client = new DynamoDBClient({});
export const ddb = DynamoDBDocumentClient.from(client);

export const TABLES = {
    users: process.env.USERS_TABLE!,
    content: process.env.CONTENT_TABLE!,
    votes: process.env.VOTES_TABLE!,
};

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