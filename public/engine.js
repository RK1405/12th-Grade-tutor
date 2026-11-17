// Offline tutor engine: answers the same requests the old server did, but only from the
// pre-generated content in public/content/ and progress saved on this computer.
// No network, no AI, no API key.

const MAX_QUIZ = 10;
const PROGRESS_KEY = "guru-progress-v1";

const index = () => window.BOOK_INDEX || [];
const loaded = {};

// Content files are plain scripts (window.BOOK_DATA[...] = ...) so they load from disk without a server.
function loadData(id, lang) {
  const key = `${id}.${lang}`;
  if (window.BOOK_DATA?.[key]) return Promise.resolve(window.BOOK_DATA[key]);
  return (loaded[key] ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `content/${encodeURIComponent(id)}.${lang}.js`;
    s.onload = () => (window.BOOK_DATA?.[key] ? resolve(window.BOOK_DATA[key]) : reject(new Error("Chapter file is empty")));
    s.onerror = () => {
      delete loaded[key];
      reject(new Error(`Missing content file ${s.src}`));
    };
    document.head.append(s);
  }));
}

// Use the requested language if that chapter has it, else the first available one.
export function langFor(chapterId, lang) {
  const ch = index().find((c) => c.id === chapterId);
  if (!ch) throw new Error("Chapter not found");
  return ch.langs.includes(lang) ? lang : ch.langs.includes("en") ? "en" : ch.langs[0];
}
async function chapter(chapterId, lang) {
  return loadData(chapterId, langFor(chapterId, lang));
}

// ---------- progress (saved in this computer's app storage) ----------
function readProgress() {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || { chapters: {} };
  } catch {
    return { chapters: {} };
  }
}
function updateProgress(id, fn) {
  const all = readProgress();
  const ch = (all.chapters[id] ||= { pagesDone: [], quizzes: [], concepts: {} });
  fn(ch);
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch {}
  return ch;
}
function record(ch, concept, correct) {
  const c = (ch.concepts[concept] ||= { correct: 0, wrong: 0, status: "learning" });
  if (correct) c.correct++;
  else {
    c.wrong++;
    c.status = "needs_practice";
  }
}

// ---------- answer checking ----------
const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFC")
    .replace(/[“”"'`.,;:!?()\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Short answers: correct when enough key words appear (half of them, at least one).
// Keywords list English and Tamil forms separately, so we count matched "ideas" generously.
export function keywordScore(answer, keywords) {
  const a = norm(answer);
  if (!a || !keywords?.length) return { ok: false, hits: 0 };
  const hits = keywords.filter((k) => {
    const n = norm(k);
    if (!n) return false;
    // For Tamil words, accept the stem (first 4 letters) to allow different endings.
    return a.includes(n) || (/[஀-௿]/.test(n) && n.length > 5 && a.includes(n.slice(0, 4)));
  }).length;
  const hasTamil = keywords.some((k) => /[஀-௿]/.test(k));
  const hasLatin = keywords.some((k) => /[a-z]/i.test(k));
  const need = hasTamil && hasLatin ? 1 : Math.max(1, Math.ceil(keywords.length / 2));
  return { ok: hits >= need, hits };
}

function checkOne(q, given, lang) {
  const t = lang === "en" ? (a, b) => a : (a, b) => b;
  const g = String(given ?? "").trim();
  if (!g) return { correct: false, feedback: t("No answer given.", "பதில் இல்லை.") };
  let correct;
  if (q.type === "mcq") correct = g === q.answer;
  else if (q.type === "predict_output") correct = norm(g).replace(/\s/g, "") === norm(q.answer).replace(/\s/g, "");
  else correct = norm(g) === norm(q.answer) || keywordScore(g, q.keywords?.length ? q.keywords : [q.answer]).ok;
  return {
    correct,
    feedback: correct ? t("Correct! ", "சரி! ") + q.explanation : t("Not quite. ", "சரியில்லை. ") + q.explanation,
  };
}

// ---------- quiz state (kept in memory until submitted) ----------
const quizzes = new Map();
const newId = () => Math.random().toString(36).slice(2);

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// One question per concept first, then fill up randomly: every quiz covers all concepts and differs each time.
function pickQuestions(data) {
  const pool = shuffle([...data.questions]);
  const picked = [];
  for (const c of data.concepts) {
    const q = pool.find((x) => x.concept === c && !picked.includes(x));
    if (q) picked.push(q);
  }
  for (const q of pool) if (picked.length < MAX_QUIZ && !picked.includes(q)) picked.push(q);
  return picked.map((q) => (q.type === "mcq" ? { ...q, options: shuffle([...q.options]) } : q));
}

// ---------- the "API" ----------
const routes = {
  "/api/chapters": () => index().map((c) => ({ id: c.id, title: c.title, titleTa: c.titleTa, pages: c.pages, langs: c.langs, sample: !!c.sample })),
  "/api/progress": () => readProgress(),

  async "/api/lesson"({ chapterId, pageIndex = 0, lang }) {
    const data = await chapter(chapterId, lang);
    const i = Math.max(0, Math.min(pageIndex, data.pages.length - 1));
    return { ...data.pages[i], pageIndex: i, pageNumber: data.pages[i].page, totalPages: data.pages.length, lang: data.lang };
  },

  // Offline "conversation": checks the page's question; otherwise points to the help buttons.
  async "/api/reply"({ chapterId, pageIndex = 0, lang, message, checkQuestion }) {
    const data = await chapter(chapterId, lang);
    const page = data.pages[pageIndex];
    const t = data.lang === "en" ? (a) => a : (a, b) => b;
    if (checkQuestion) {
      const { ok } = keywordScore(message, checkQuestion.keywords?.length ? checkQuestion.keywords : [checkQuestion.idealAnswer]);
      if (ok)
        return {
          verdict: "understood",
          steps: [{ say: t(`Well done, that's right! ${checkQuestion.idealAnswer} Press Next page when you're ready.`, `அருமை, சரியான பதில்! ${checkQuestion.idealAnswer} தயாரானதும் அடுத்த பக்கம் அழுத்துங்கள்.`), board: [{ kind: "point", title: "✔ " + checkQuestion.idealAnswer, body: "" }] }],
        };
      return {
        verdict: "not_yet",
        steps: [
          { say: t(`Not quite. The answer is: ${checkQuestion.idealAnswer} Let me explain it again.`, `சரியாக இல்லை. சரியான பதில்: ${checkQuestion.idealAnswer} மீண்டும் விளக்குகிறேன்.`), board: [{ kind: "warning", title: checkQuestion.idealAnswer, body: "" }] },
          ...page.explainAgain,
        ],
      };
    }
    return {
      verdict: "not_applicable",
      steps: [{ say: t("I can't answer new questions offline yet. Tap Explain again or Example, and I'll help you with this page.", "இப்போது புதிய கேள்விகளுக்கு என்னால் பதில் சொல்ல முடியாது. மீண்டும் விளக்கு அல்லது எடுத்துக்காட்டு அழுத்துங்கள், இந்தப் பக்கத்தை விளக்குகிறேன்."), board: [] }],
    };
  },

  "/api/page-done"({ chapterId, pageIndex }) {
    return updateProgress(chapterId, (p) => {
      if (!p.pagesDone.includes(pageIndex)) p.pagesDone.push(pageIndex);
    });
  },

  async "/api/quiz"({ chapterId, lang }) {
    const data = await chapter(chapterId, lang);
    const questions = pickQuestions(data);
    const quizId = newId();
    quizzes.set(quizId, { kind: "chapter", chapterId, lang: data.lang, questions });
    updateProgress(chapterId, (p) => {
      for (const c of data.concepts) p.concepts[c] ||= { correct: 0, wrong: 0, status: "learning" };
    });
    return { quizId, concepts: data.concepts, questions };
  },

  async "/api/reteach"({ chapterId, lang, concept, attempt = 1 }) {
    const data = await chapter(chapterId, lang);
    const variants = data.reteach[concept] || [];
    if (!variants.length) {
      // No re-teaching prepared for this concept: fall back to related bank questions.
      const qs = data.questions.filter((q) => q.concept === concept).slice(0, 2);
      const quizId = newId();
      quizzes.set(quizId, { kind: "practice", chapterId, lang: data.lang, concept, questions: qs });
      return { steps: qs.map((q) => ({ say: q.explanation, board: [{ kind: "point", title: q.explanation, body: "" }] })), quizId, questions: qs };
    }
    const v = variants[(attempt - 1) % variants.length];
    const questions = v.practice.map((q) => (q.type === "mcq" ? { ...q, options: shuffle([...q.options]) } : q));
    const quizId = newId();
    quizzes.set(quizId, { kind: "practice", chapterId, lang: data.lang, concept, questions });
    return { steps: v.steps, quizId, questions };
  },

  "/api/submit"({ quizId, answers = {} }) {
    const quiz = quizzes.get(quizId);
    if (!quiz) throw new Error("This quiz has expired. Please start it again.");
    const results = quiz.questions.map((q) => ({
      id: q.id,
      concept: q.concept,
      question: q.question,
      given: answers[q.id] ?? "",
      answer: q.answer,
      explanation: q.explanation,
      misconception: "",
      ...checkOne(q, answers[q.id], quiz.lang),
    }));
    const score = results.filter((r) => r.correct).length;
    const weak = {};
    for (const r of results.filter((r) => !r.correct)) (weak[r.concept] ||= []).push({ question: r.question, studentAnswer: r.given, correctAnswer: r.answer });
    updateProgress(quiz.chapterId, (p) => {
      for (const r of results) record(p, r.concept, r.correct);
      if (quiz.kind === "chapter") {
        p.quizzes.push({ date: new Date().toISOString(), score, total: results.length });
        for (const r of results) if (!weak[r.concept] && p.concepts[r.concept]) p.concepts[r.concept].status = "mastered";
      } else if (score === results.length && p.concepts[quiz.concept]) p.concepts[quiz.concept].status = "mastered";
    });
    quizzes.delete(quizId);
    return { kind: quiz.kind, score, total: results.length, results, weakConcepts: Object.entries(weak).map(([concept, mistakes]) => ({ concept, mistakes })) };
  },
};

export async function api(path, body = {}) {
  const fn = routes[path];
  if (!fn) throw new Error("Unknown request " + path);
  return fn(body);
}

export function resetProgress() {
  try {
    localStorage.removeItem(PROGRESS_KEY);
  } catch {}
}
