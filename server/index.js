import express from "express";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as store from "./store.js";

const DEMO = process.env.TUTOR_DEMO === "1";
const tutor = DEMO ? await import("./demo.js") : await import("./tutor.js");
if (!DEMO && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.warn("No key: put ANTHROPIC_API_KEY=... in .env (run `npm run check-key` to test it), or run `npm run demo` to try the app without AI.");
}

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(here, "../public")));

// Quizzes in progress; answers stay on the server until the student submits.
const quizzes = new Map();

const route = (fn) => async (req, res) => {
  try {
    res.json(await fn(req.body || {}, req));
  } catch (err) {
    console.error(err);
    const message =
      err.status === 401 ? "The AI key is missing or invalid. Run `npm run check-key` in the project folder to see why." :
      err.status === 429 ? "The tutor is busy right now. Please wait a moment and try again." :
      err.message || "Something went wrong";
    res.status(err.status === 404 ? 404 : 500).json({ error: message });
  }
};
function chapterOr404(id) {
  const ch = store.getChapter(id);
  if (!ch) throw Object.assign(new Error("Chapter not found"), { status: 404 });
  return ch;
}
const lang = (l) => (["en", "ta", "mix"].includes(l) ? l : "en");
const hideAnswers = (qs) => qs.map(({ answer, explanation, ...q }) => q);

app.get("/api/config", route(async () => ({ demo: DEMO })));

app.get(
  "/api/chapters",
  route(async () =>
    store.listChapters().map((c) => ({ id: c.id, title: c.title, titleTa: c.titleTa || "", pages: c.pages.length, source: c.source || "" }))
  )
);

app.get("/api/progress", route(async () => store.getProgress()));

app.post(
  "/api/lesson",
  route(async ({ chapterId, pageIndex = 0, lang: l }) => {
    const ch = chapterOr404(chapterId);
    const i = Math.max(0, Math.min(Number(pageIndex) || 0, ch.pages.length - 1));
    const key = `${DEMO ? "demo" : "lesson"}-${ch.id}-${i}-${lang(l)}`;
    let lesson = store.cacheGet(key);
    if (!lesson) {
      lesson = await tutor.teachPage(ch, i, lang(l));
      store.cacheSet(key, lesson);
    }
    return { ...lesson, pageIndex: i, pageNumber: ch.pages[i].page, totalPages: ch.pages.length };
  })
);

app.post(
  "/api/reply",
  route(async ({ chapterId, pageIndex = 0, lang: l, conversation = [], message = "", checkQuestion = null }) => {
    const ch = chapterOr404(chapterId);
    if (!String(message).trim()) throw new Error("Empty message");
    return tutor.reply(ch, Number(pageIndex) || 0, lang(l), conversation, String(message).slice(0, 2000), checkQuestion);
  })
);

app.post(
  "/api/page-done",
  route(async ({ chapterId, pageIndex }) => {
    chapterOr404(chapterId);
    return store.updateProgress(chapterId, (p) => {
      if (!p.pagesDone.includes(pageIndex)) p.pagesDone.push(pageIndex);
    });
  })
);

app.post(
  "/api/quiz",
  route(async ({ chapterId, lang: l }) => {
    const ch = chapterOr404(chapterId);
    const quiz = await tutor.makeQuiz(ch, lang(l));
    const quizId = crypto.randomUUID();
    quizzes.set(quizId, { kind: "chapter", chapterId: ch.id, lang: lang(l), questions: quiz.questions });
    store.updateProgress(ch.id, (p) => {
      for (const c of quiz.concepts) p.concepts[c] ||= { correct: 0, wrong: 0, status: "learning" };
    });
    return { quizId, concepts: quiz.concepts, questions: hideAnswers(quiz.questions) };
  })
);

app.post(
  "/api/reteach",
  route(async ({ chapterId, lang: l, concept, mistakes = [], attempt = 1 }) => {
    const ch = chapterOr404(chapterId);
    const r = await tutor.reteach(ch, lang(l), String(concept), mistakes, Number(attempt) || 1);
    const quizId = crypto.randomUUID();
    quizzes.set(quizId, { kind: "practice", chapterId: ch.id, lang: lang(l), concept, questions: r.practice });
    return { steps: r.steps, quizId, questions: hideAnswers(r.practice) };
  })
);

app.post(
  "/api/submit",
  route(async ({ quizId, answers = {} }) => {
    const quiz = quizzes.get(quizId);
    if (!quiz) throw Object.assign(new Error("Quiz expired. Please start it again."), { status: 404 });
    const ch = chapterOr404(quiz.chapterId);

    // MCQs are checked locally; written answers are graded by the tutor in one call.
    const results = {};
    const toGrade = [];
    for (const q of quiz.questions) {
      const given = String(answers[q.id] ?? "").trim();
      if (q.type === "mcq") {
        const ok = given === q.answer;
        results[q.id] = { correct: ok, feedback: ok ? "Correct!" : `The right answer is: ${q.answer}`, misconception: "" };
      } else if (!given) {
        results[q.id] = { correct: false, feedback: "No answer given.", misconception: "Did not attempt" };
      } else {
        toGrade.push({ id: q.id, type: q.type, question: q.question, code: q.code, expected: q.answer, studentAnswer: given });
      }
    }
    const graded = await tutor.grade(ch, quiz.lang, toGrade);
    for (const g of graded.results) results[g.id] = g;

    const out = quiz.questions.map((q) => ({
      id: q.id,
      concept: q.concept,
      question: q.question,
      given: answers[q.id] ?? "",
      answer: q.answer,
      explanation: q.explanation,
      ...(results[q.id] || { correct: false, feedback: "Could not grade this answer.", misconception: "" }),
    }));
    const score = out.filter((r) => r.correct).length;

    // Group wrong answers by concept: these drive the re-teaching loop.
    const weak = {};
    for (const r of out.filter((r) => !r.correct)) {
      (weak[r.concept] ||= []).push({ question: r.question, studentAnswer: r.given, correctAnswer: r.answer, misconception: r.misconception });
    }

    store.updateProgress(ch.id, (p) => {
      for (const r of out) store.recordAnswer(p, r.concept, r.correct);
      if (quiz.kind === "chapter") {
        p.quizzes.push({ date: new Date().toISOString(), score, total: out.length });
        for (const r of out) if (!weak[r.concept] && p.concepts[r.concept]) p.concepts[r.concept].status = "mastered";
      } else if (score === out.length && p.concepts[quiz.concept]) {
        p.concepts[quiz.concept].status = "mastered";
      }
    });
    quizzes.delete(quizId);
    return { kind: quiz.kind, score, total: out.length, results: out, weakConcepts: Object.entries(weak).map(([concept, mistakes]) => ({ concept, mistakes })) };
  })
);

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`CS Tutor running at http://localhost:${PORT}${DEMO ? "  (DEMO MODE: no AI)" : ""}`));
