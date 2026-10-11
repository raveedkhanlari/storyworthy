import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, fail, getAuth, getUserTurns, isInterestedInPaid, MAX_TURNS } from "./shared";

export const handler = async (event: APIGatewayProxyEventV2) => {
    const claims = getAuth(event);

    if (!claims)
        return fail("Unauthorized", 401);

    const interestedInPaid = await isInterestedInPaid(claims.email);
    const turns = await getUserTurns(claims.sub);

    if (turns.length===0)
        return ok({ story: null, interestedInPaid });

    // Freemium: user has at most one story. Group by voteId, then there should one.
    turns.sort((a, b) => a.turn - b.turn);

    const voteId = turns[0].voteId;
    const storyTurns = turns.filter(t => t.voteId===voteId);

    return ok({
        story: {
            voteId,
            turns: storyTurns.map(i => ({
                turn: i.turn,
                paragraph: i.paragraph,
                advice: i.advice,
            })),
            turnsUsed: storyTurns.length,
            turnsRemaining: Math.max(0, MAX_TURNS - storyTurns.length),
        },
        interestedInPaid,
    });
}