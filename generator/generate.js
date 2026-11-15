// Claude calls used ONCE to generate the offline content. The app itself never calls Claude.
import { client, BETAS } from "./client.js";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { PageContent, QuestionBank, ConceptReteach } from "./schemas.js";

export const MODEL = process.env.TUTOR_MODEL || "claude-opus-5-5";

const LANG_RULES = {
  en: "Speak and write in simple Indian English. The textbook may be in Tamil: teach its content in English.",
  ta:
    "Speak and write in clear, simple Tamil (தமிழ்). Write the English technical term in brackets after the Tamil term " +
    "the first time it appears, e.g. செயற்கூறு (function). Code, keywords and output always stay in English.",
  mix:
    "Speak the way a friendly Tamil Nadu teacher speaks in class: mainly Tamil sentences, keeping technical words " +
    "(function, variable, loop, return) in English. Code always stays in English.",
};

const SYSTEM = `You are "Kavi", a warm, patient robot tutor teaching Class 12 Computer Science (Tamil Nadu State Board).
You are preparing content for an OFFLINE tutoring app: a talking robot avatar and a whiteboard, one textbook page at a time.
Nothing you write can be changed later, so it must be correct and complete on its own.

Rules:
- Teach only what the textbook covers, in its order; add simple everyday analogies (Indian school life) where helpful.
- "say" is converted to voice: short sentences, no markdown, no bullet symbols, never read code character by character
  (describe what code does), no emojis.
- Whiteboard items are short. Code goes in kind="code" (body = the code, exactly as in the book). For a process, use
  kind="diagram" with a small Mermaid "flowchart TD" in body (node labels in double quotes, at most 7 nodes).
- Encouraging tone. Point out what is important for the board exam.
- Questions must be answerable from the chapter and suit Class 12 board exams. MCQ options must be clearly distinct.`;

const langRule = (lang) => `Language: ${LANG_RULES[lang] || LANG_RULES.en}`;

// Chapter text goes in its own cached block: every call for the same chapter reuses it cheaply.
function chapterBlock(chapter) {
  const fmt = (list) => list.map((p) => `--- Page ${p.page} ---\n${p.text}`).join("\n\n");
  const ex = chapter.exercises?.length ? `\n\nTEXTBOOK EXERCISES (guide for exam-style questions):\n\n${fmt(chapter.exercises)}` : "";
  return {
    type: "text",
    text: `TEXTBOOK CHAPTER: ${chapter.title}${chapter.titleTa ? ` (${chapter.titleTa})` : ""}\n\n${fmt(chapter.pages)}${ex}`,
    cache_control: { type: "ephemeral" },
  };
}

async function ask(schema, chapter, instruction, effort = "medium") {
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 32000,
    system: SYSTEM,
    betas: BETAS,
    fallbacks: "default", // a declined request is retried on a fallback model
    output_config: { effort, format: betaZodOutputFormat(schema) },
    messages: [{ role: "user", content: [chapterBlock(chapter), { type: "text", text: instruction }] }],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined this request");
  if (response.stop_reason === "max_tokens" || !response.parsed_output) throw new Error("Incomplete answer");
  return response.parsed_output;
}

export function pageContent(chapter, i, lang) {
  const p = chapter.pages[i];
  return ask(
    PageContent,
    chapter,
    `${langRule(lang)}\n\nCreate the lesson for page ${p.page} (page ${i + 1} of ${chapter.pages.length} in this chapter). ` +
      (i === 0 ? "Start by welcoming the student and introducing the chapter. " : "Start with one sentence linking to the previous page. ") +
      "Also write the simpler re-explanation, one worked example, and a check question with keywords for offline checking."
  );
}

export function questionBank(chapter, lang, count) {
  return ask(
    QuestionBank,
    chapter,
    `${langRule(lang)}\n\nList the 5-10 most important concepts of this chapter, then write a bank of ${count} quiz questions ` +
      "covering every concept at least twice: about half mcq, the rest short answers, plus 2-3 predict_output questions " +
      "if the chapter has code. Use ids q1, q2, ... Give short answers keywords for offline checking."
  );
}

export function conceptReteach(chapter, lang, concept) {
  return ask(
    ConceptReteach,
    chapter,
    `${langRule(lang)}\n\nA student answered questions on the concept "${concept}" wrongly. Write exactly 3 re-teaching ` +
      "variants for when they get it wrong once, twice and three times:\n" +
      "1) a fresh explanation with a new analogy and a worked example; 2) much simpler words, step by step, with a different " +
      "analogy and common mistakes; 3) the most basic version, building up from what they already know, with a very simple example.\n" +
      `Each variant ends with exactly 2 new practice questions on "${concept}" (ids p1, p2), different from the other variants' questions.`
  );
}
