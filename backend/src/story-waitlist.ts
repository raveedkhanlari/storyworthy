import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, fail, getAuth, markInterestedInPaid } from "./shared";

export const handler = async (event: APIGatewayProxyEventV2) => {
    const claims = getAuth(event);

    if (!claims)
        return fail("Unauthorized", 401);

    await markInterestedInPaid(claims.email);

    return ok({ joined: true });
};