import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, fail, getAuth, askClaude, getReviewsUsed, incrementReviewsUsed, FREE_REVIEW_LIMIT } from "./shared";

const MAX_PARAGRAPH_WORDS = 80;

export const handler = async (event: APIGatewayProxyEventV2) => {
    // --- 1. Auth ---//
    const claims = getAuth(event);

    if (!claims)
        return fail("Unauthorized", 401);

    // --- 2. Parse body --- //
    if (!event.body)
        return fail("Missing request body");

    let payload: any;

    try {
        payload = JSON.parse(event.body);
    } catch {
        return fail("Invalid JSON");
    }

    const genre= typeof payload.genre==="string" ? payload.genre.trim() : "";
    const paragraph = typeof payload.paragraph==="string" ? payload.paragraph.trim() : "";
    const postTitle = typeof payload.postTitle==="string" ? payload.postTitle.trim() : "";
    const postContent = typeof payload.postContent==="string" ? payload.postContent.trim() : "";

    if (!genre || !paragraph)
        return fail("A genre and your first paragraph are required.");

    // --- 3. Enforce 80-word paragraph cap (before spending an LLM call) --- //
    const wordCount = paragraph.split(/\s+/).filter(Boolean).length;

    if (wordCount>MAX_PARAGRAPH_WORDS)
        return fail(`Your paragraph is ${wordCount} words. Please keep it under ${MAX_PARAGRAPH_WORDS} words.`);

    // --- 4. Check free-trial quota --- //
    const used = await getReviewsUsed(claims.email);

    if (used>=FREE_REVIEW_LIMIT)
        return fail("FREE_LIMIT_REACHED", 402); // 402 Payment Required - paywall signal

    // --- 5. Build prompt --- //
    const system =
        "You are a story-creaft coach inside StoryWorthy, a tool where writers turn online posts into story ideas. " +
        "A writer has tagged a post they think has story potential, chosen a genre, and written opening paragraph. " +
        "Your job is to give concise, encouraging, genre-specific craft advice. " +
        "Do TWO things: (1) briefly assess how well their paragraph connects to the source post and fits the chosen genre; " +
        "(2) give 2-4 specific, actionable craft tips for developing this into a story in that genre " +
        "(e.g., sustaining suspense for thriller, timing for comedy, emotional beats for drama). " +
        "Ground your advice in what they actually wrote and in the post. " +
        "Do NOT correct grammer or spelling. Do NOT rewrite their paragraph. Do NOT writethe story for them. " +
        "Keep it under 250 words, warm and practical."
    ;

    const userContent = 
        `SOURCE POST TITLE: ${postTitle || "(not provided)"}\n\n` +
        `SOURCE POST CONTENT:\n${postContent ? postContent.slice(0, 4000) : "(not provided)"}\n\n` +
        `CHOSED GENRE: ${genre}\n\n` +
        `WRITER'S OPENING PARAGRAPH:\n${paragraph}`
    ;

    // --- 6. Call Claude --- //
    let advice: string;

    try {
        advice = await askClaude(system, userContent, 700);
    } catch (err) {
        console.error("Bedrock call failed", err);

        return fail("Could not generate advice right now. Please try again.", 502);
    }

    if (!advice)
        return fail("No advice was generated. Please try again.", 502);

    // --- 7. Only now consume a review from quota --- //
    const newUsed = await incrementReviewsUsed(claims.email);

    return ok({
        advice, 
        reviewsUsed: newUsed,
        reviewsRemaining: Math.max(0, FREE_REVIEW_LIMIT - newUsed),
    });
};