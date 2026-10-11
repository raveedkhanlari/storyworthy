import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { ok, fail, getAuth, askClaude, ClaudeMessage, getUserTurns, saveStoryTurn, MAX_TURNS, StoryTurnRow } from "./shared";

const MAX_PARAGRAPH_WORDS = 80;
const PILLARS =
    "The five craft pillars are:\n" +
    "1. PERSONA - the character(s): who they are, their voice, and how to develop them for the genre (e.g. sharper wit for comedy, moral ambiguity for crime/thriller).\n" +
    "2. SCENE - the setting/situation depicted. Correlate it with the source POST: does a scene in the post inform or clash with what the writer wrote? Advise on developing the scene for the genre.\n" +
    "3. TONE - the mood for the chosen genre (e.g. obscure/withhold for mystery, dread for horror, levity for comedy). Assess whether the writer's tone fits the genre and the post's theme.\n" +
    "4. NARRATION - the point of view (first person, third person, etc.) Assess whether the chosen POV is effective and common for this genre. Check if writer has sustained the tone.\n" +
    "5. TIME - the temporal framing (past recollection, present unfolding, etc.). Assess whether it suits the genre and story."
;
const FIRST_TURN_SYSTEM =
    "You are an ethusisatic, encouraging creative-writing partner in StoryWorthy - NOT a critic or grader. A writer spotted story potential in an online post, chose a genre, and wrote their opening paragraph. Your job is to make them EXCITED to keep writing, grounded in the POST (use the post TITLE and the post CONTENT if given) and the GENRE.\n\n" +
    "Open by genuinely reaching to what's exciting about their premise and their specific choices - be warm and specific, like a mentor who loves this idea.  Then give craft guidance woven through the five pillars below. Do NOT write it as a dry checklist; make it fell like an inspired conversation. Celebrate what's working before gently suggesting what could grow.\n\n" +
    PILLARS +
    "\n\n" +
    "GUIDANCE:\n" +
    "- Cover all five pillars, each introduced with its **bold** keyword, but keep the voice vivid and motivating, not clinical.\n" +
    "- Phrase growth suggestions as exciting possibilities ('imagine if..', 'you could...'), never as deficiencies.\n" +
    "- Reference the post TITLE; if post CONTENT is empty (e.g. a video), note there was no post text and work from the title\n" +
    "- End with with a vivid, specific hook question that makes them want to write the next paragraph immediately.\n" +
    "- Use ONLY **double-asterisk bold**. No *italics* or other markdown. Do NOT correct grammar or rewrite their words.\n" +
    "Use markdown bullets. Keep it under 320 words, energetic and encouraging."
;
const CONTINUATION_SYSTEM =
    "You are a story-craft coach in StoryWorthy, continuing a coaching conversation about the writer's developing story, grounded in the POST and the GENRE.\n\n" +
    PILLARS +
    "This is a CONTINUATION. The five pillars remain the framework, but FOCUS your advice on whichever pillar(s) the writer's NEW paragraph most engages, and evaluate them strictly against the genre and the post. For example, if they've deepened the SCENE but it clashes with the chosen genre (e.g. a very dark scene under a comedy genre), focus on that tension: is it workable given the post's theme, and how? Reference how this paragraph builds on what came before. Bold any pillar keywords you address. Do NOT correct grammar. Do NOT rewrite or write the story for them. Use markdown. Keep it under 260 words."
;

export const handler = async (event: APIGatewayProxyEventV2) => {
    // 1. Auth
    const claims = getAuth(event);

    if (!claims)
        return fail("Unauthorized", 401);

    // 2. Parse body
    if (!event.body)
        return fail("Missing request body");

    let payload: any;

    try {
        payload = JSON.parse(event.body);
    } catch {
        return fail("Invalid JSON");
    }

    const voteId = typeof payload.voteId==="string" ? payload.voteId.trim() : "";
    const genre= typeof payload.genre==="string" ? payload.genre.trim() : "";
    const paragraph = typeof payload.paragraph==="string" ? payload.paragraph.trim() : "";
    const postTitle = typeof payload.postTitle==="string" ? payload.postTitle.trim() : "";
    const postContent = typeof payload.postContent==="string" ? payload.postContent.trim() : "";

    if (!voteId || !genre || !paragraph)
        return fail("voteId, genre, and paragraph are required.");

    // 3. Enforce 80-word paragraph cap (before spending an LLM call).
    const wordCount = paragraph.split(/\s+/).filter(Boolean).length;

    if (wordCount>MAX_PARAGRAPH_WORDS)
        return fail(`Your paragraph is ${wordCount} words. Please keep it under ${MAX_PARAGRAPH_WORDS} words.`);

    // 4. Fetch all turns user has developed on selected vote
    const allTurns = await getUserTurns(claims.sub);

    // 5. Vote-lock: if user already has a story on a different vote, block.
    const existingVoteIds = new Set(allTurns.map(t => t.voteId));

    if (existingVoteIds.size>0 && !existingVoteIds.has(voteId))
        return fail("ONE_STORY_ONLY", 409);

    // 6. Fetch turns for this vote
    const storyTurns = allTurns.filter(t => t.voteId===voteId).sort((a, b) => a.turn - b.turn);

    if (storyTurns.length>=MAX_TURNS)
        return fail("FREE_LIMIT_REACHED", 402);

    const turnNumber = storyTurns.length + 1;
    const isFirstTurn = turnNumber===1;

    // 7. Build system prompt, current and history of messages
    const system = isFirstTurn ? FIRST_TURN_SYSTEM : CONTINUATION_SYSTEM;
    const context = 
        `SOURCE POST TITLE: ${postTitle || "(not provided)"}\n\n` +
        `SOURCE POST CONTENT:\n${postContent ? postContent.slice(0, 4000) : "(not provided)"}\n\n` +
        `CHOSEN GENRE: ${genre}`;
    const messages: ClaudeMessage[] = [];

    storyTurns.forEach((t, i) => {
        messages.push({
            role: "user",
            text: i===0 ? `${context}\n\nMY OPENING PARAGRAPH:\n${t.paragraph}` : `MY NEXT PARAGRAPH:\n${t.paragraph}`,
        });
        messages.push({
            role: "assistant",
            text: t.advice,
        });
    });
    messages.push({
        role: "user",
        text: storyTurns.length===0 ? `${context}\n\nMY OPENING PARAGRAPH:\n${paragraph}` : `MY NEXT PARAGRAPH:\n${paragraph}`,
    });

    // 8. Get advice
    let advice: string;

    try {
        advice = await askClaude(system, messages, isFirstTurn ? 900 : 700);
    }  catch(err) {
        console.error("Bedrock failed", err);

        return fail("Could not generate advice. Please try again.", 502);
    }

    if (!advice)
        return fail("No advice was generated. Please try again.", 502);

    // 9. Save new turn
    const row: StoryTurnRow = {
        userId: claims.sub,
        voteTurn: `${voteId}#${turnNumber}`,
        voteId,
        turn: turnNumber,
        paragraph,
        advice,
        createdAt: new Date().toISOString(),
    };

    await saveStoryTurn(row);

    return ok({
        turn: turnNumber,
        advice,
        turnsRemaining: Math.max(0, MAX_TURNS - turnNumber),
        thread: [...storyTurns, row].map(t => ({ 
            turn: t.turn,
            paragraph: t.paragraph,
            advice: t.advice,
        })),
    });
};