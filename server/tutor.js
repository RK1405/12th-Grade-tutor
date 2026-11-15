// All Claude calls live here. Each function returns plain JSON for the frontend.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { PageLesson, TutorReply, Quiz, Grades, Remediation } from "./schemas.js";

const MODEL = process.env.TUTOR_MODEL || "claude-opus-5-5";
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

const LANG_RULES = {
  en: "Speak and write in simple Indian English.",
  ta:
    "Speak and write in clear, simple Tamil (தமிழ்). Write the English technical term in brackets after the Tamil term " +
    "the first time it appears, e.g. செயற்கூறு (function). Code, keywords and output always stay in English.",
  mix:
    "Speak the way a friendly Tamil Nadu teacher speaks in class: mainly Tamil sentences, keeping technical words " +
    "(function, variable, loop, return) in English. Code always stays in English.",
};

const SYSTEM = `You are "Kavi", a warm, patient Computer Science tutor for a Class 12 Tamil Nadu State Board student.
You teach through a talking avatar and a whiteboard, one textbook page at a time.

Teaching rules:
- Teach only what the given textbook page covers, in the textbook's order; you may add a simple everyday analogy or example.
- Speech ("say") is converted to voice: short sentences, no markdown, no bullet symbols, never read code character by character
  (describe what code does instead), no emojis.
- Whiteboard items are short. Put code in kind="code" (body = the code). For a process or flow, use kind="diagram" with a
  small Mermaid "flowchart TD" in body (node labels in double quotes, at most 7 nodes).
- Be encouraging. Never shame the student for a wrong answer. Board-exam focus: point out what is important for exams.
- Questions must be answerable from the chapter content and suit Class 12 board exams.`;

function langRule(lang) {
  return `Language: ${LANG_RULES[lang] || LANG_RULES.en}`;
}

// Chapter text goes in its own cached block so repeated calls on the same chapter are cheaper.
function chapterBlock(chapter) {
  const pages = chapter.pages.map((p) => `--- Page ${p.page} ---\n${p.text}`).join("\n\n");
  const exercises = (chapter.exercises || []).map((p) => `--- Page ${p.page} ---\n${p.text}`).join("\n\n");
  return {
    type: "text",
    text:
      `TEXTBOOK CHAPTER: ${chapter.title}${chapter.titleTa ? ` (${chapter.titleTa})` : ""}\n\n${pages}` +
      (exercises ? `\n\nTEXTBOOK EXERCISES FOR THIS CHAPTER (use them as a guide for exam-style quiz questions):\n\n${exercises}` : ""),
    cache_control: { type: "ephemeral" },
  };
}

async function ask(schema, userContent, { effort = "medium", maxTokens = 16000, history = [] } = {}) {
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: maxTokens,
    system: SYSTEM,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // if a request is declined, the API retries it on a fallback model
    output_config: { effort, format: betaZodOutputFormat(schema) },
    messages: [...history, { role: "user", content: userContent }],
  });
  if (response.stop_reason === "refusal") {
    throw new Error("The tutor could not answer that request. Please rephrase it.");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new Error("The tutor's answer was incomplete. Please try again.");
  }
  return response.parsed_output;
}

export async function teachPage(chapter, pageIndex, lang) {
  const page = chapter.pages[pageIndex];
  return ask(PageLesson, [
    chapterBlock(chapter),
    {
      type: "text",
      text:
        `${langRule(lang)}\n\nTeach page ${page.page} (page ${pageIndex + 1} of ${chapter.pages.length} in this chapter). ` +
        (pageIndex === 0 ? "Start by welcoming the student and introducing the chapter. " : "Briefly link to the previous page first. ") +
        "End with one quick check question about this page.",
    },
  ]);
}

// Free conversation on the current page: doubts, "explain again", or answering the check question.
export async function reply(chapter, pageIndex, lang, conversation, message, checkQuestion) {
  const page = chapter.pages[pageIndex];
  const convo = conversation
    .slice(-12)
    .map((t) => `${t.role === "student" ? "Student" : "Tutor"}: ${t.text}`)
    .join("\n");
  return ask(
    TutorReply,
    [
      chapterBlock(chapter),
      {
        type: "text",
        text:
          `${langRule(lang)}\n\nWe are on page ${page.page}.\n` +
          (checkQuestion
            ? `The check question you asked was: "${checkQuestion.question}" (ideal answer: ${checkQuestion.idealAnswer}). ` +
              "If the student is answering it, judge it kindly; if it is wrong or incomplete, explain the idea again in a different way.\n"
            : "") +
          `Recent conversation:\n${convo || "(none)"}\n\nStudent says: "${message}"\n\nRespond as the tutor.`,
      },
    ],
    { effort: "low" }
  );
}

export async function makeQuiz(chapter, lang, count = 8) {
  const quiz = await ask(Quiz, [
    chapterBlock(chapter),
    {
      type: "text",
      text:
        `${langRule(lang)}\n\nThe student has finished this chapter. First list the 5-10 most important concepts. ` +
        `Then write ${count} quiz questions that together cover every important concept: about half mcq, ` +
        `some short-answer, and 1-2 predict_output questions if the chapter has code. Use ids q1, q2, ...`,
    },
  ]);
  return normalizeQuestions(quiz);
}

export async function grade(chapter, lang, items) {
  // items: [{id, question, code, expected, studentAnswer}]
  if (items.length === 0) return { results: [] };
  return ask(
    Grades,
    [
      chapterBlock(chapter),
      {
        type: "text",
        text:
          `${langRule(lang)}\n\nGrade these answers from a Class 12 student. Accept answers that show the right idea even ` +
          "if the wording differs or has small spelling mistakes; for predict_output, the output must match. " +
          "Feedback is addressed to the student.\n\n" +
          JSON.stringify(items, null, 1),
      },
    ],
    { effort: "low" }
  );
}

export async function reteach(chapter, lang, concept, mistakes, attempt) {
  const r = await ask(Remediation, [
    chapterBlock(chapter),
    {
      type: "text",
      text:
        `${langRule(lang)}\n\nThe student got questions wrong on the concept "${concept}".\n` +
        `Their mistakes:\n${JSON.stringify(mistakes, null, 1)}\n\n` +
        `This is re-teaching attempt ${attempt}. Address the misconception directly. Explain the concept again in a ` +
        (attempt > 1
          ? "completely different way from before: simpler words, a new everyday analogy and a step-by-step worked example. "
          : "fresh way with a new analogy and a worked example. ") +
        `Then give exactly 2 new practice questions on "${concept}" (ids p1, p2), different from the ones they got wrong.`,
    },
  ]);
  return { steps: r.steps, practice: normalizeQuestions({ questions: r.practice }).questions };
}

// Make MCQ answers match an option exactly so they can be graded without a model call.
function normalizeQuestions(quiz) {
  for (const q of quiz.questions) {
    if (q.type === "mcq" && q.options.length && !q.options.includes(q.answer)) {
      const hit = q.options.find((o) => o.trim().toLowerCase() === q.answer.trim().toLowerCase());
      if (hit) q.answer = hit;
      else q.type = "short"; // fall back to model grading
    }
  }
  return quiz;
}
