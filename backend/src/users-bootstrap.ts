import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLES, ok, fail, getAuth } from "./shared";

export const handler = async (event: APIGatewayProxyEventV2) => {
    if (!event.body)
        return fail("Missing request body");

    let payload: any;

    try {
        payload = JSON.parse(event.body);
    } catch {
        return fail("Invalid JSON");
    }

    const { installId, country, region, email, emailOptIn } = payload;

    if (!installId || !country)
        return fail("Missing installId or country");

    const claims = getAuth(event);

    await ddb.send(new PutCommand({
        TableName: TABLES.users,
        Item: {
            installId,
            userId: claims?.sub ?? null,
            country,
            region: region ?? null,
            email: email ?? claims?.email ?? null,
            emailOptIn: emailOptIn===true,
            updatedAt: new Date().toISOString(),
        },
    }));

    return ok({ installId });
};