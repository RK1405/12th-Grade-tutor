// DEMO MODE (TUTOR_DEMO=1): canned, non-AI responses so the screens and the
// teach -> quiz -> re-teach loop can be tried without an API key.
// Real teaching quality only comes from tutor.js.

const tag = "[Demo mode] ";

function sentences(text) {
  return text.replace(/\n+/g, " ").split(/(?<=[.!?])\s+/).filter((s) => s.length > 3);
}

export async function teachPage(chapter, pageIndex) {
  const page = chapter.pages[pageIndex];
  const code = (page.text.match(/(?:^|\n)((?:def |count = )[\s\S]*?)(?:\n\n|$)/) || [])[1];
  const s = sentences(page.text);
  const steps = [];
  for (let i = 0; i < Math.min(s.length, 6); i += 2) {
    steps.push({
      say: (i === 0 ? tag : "") + s.slice(i, i + 2).join(" "),
      board: [{ kind: i === 0 ? "heading" : "point", title: s[i].slice(0, 70), body: "" }],
    });
  }
  if (code) steps.push({ say: "Look at this code on the board.", board: [{ kind: "code", title: "Example", body: code.trim() }] });
  if (pageIndex === 0)
    steps.push({
      say: "Here is the idea as a picture.",
      board: [{ kind: "diagram", title: "Program split into functions", body: 'flowchart TD\n  P["Big program"] --> A["Function 1"]\n  P --> B["Function 2"]\n  P --> C["Function 3"]' }],
    });
  return {
    steps,
    checkQuestion: { question: "In one sentence, what did this page teach you?", idealAnswer: s[0], concept: "page" },
  };
}

export async function reply(chapter, pageIndex, lang, conversation, message) {
  return {
    steps: [{ say: `${tag}You said: "${message}". With a real API key I would answer your doubt here.`, board: [] }],
    verdict: message.trim().split(/\s+/).length >= 4 ? "understood" : "not_yet",
  };
}

export async function makeQuiz(chapter) {
  if (!chapter.demo) throw new Error("Demo mode only has a quiz for the sample chapter.");
  return structuredClone(chapter.demo);
}

export async function grade(chapter, lang, items) {
  // Demo grading: the answer counts as correct if it shares a key word with the model answer.
  return {
    results: items.map((it) => {
      const norm = (x) => x.toLowerCase().replace(/\s+/g, " ").trim();
      const want = it.expected.toLowerCase().match(/[a-z]{4,}/g) || [];
      const ok = norm(it.studentAnswer) === norm(it.expected) || want.some((w) => it.studentAnswer.toLowerCase().includes(w));
      return {
        id: it.id,
        correct: ok,
        feedback: ok ? "Good, that's right." : `Not quite. Expected: ${it.expected}`,
        misconception: ok ? "" : "Demo mode cannot diagnose the misconception.",
      };
    }),
  };
}

export async function reteach(chapter, lang, concept, mistakes, attempt) {
  const qs = (chapter.demo?.questions || []).filter((q) => q.concept === concept);
  return {
    steps: [
      { say: `${tag}Let's look at ${concept} again, attempt ${attempt}.`, board: [{ kind: "heading", title: concept, body: "" }] },
      ...qs.map((q) => ({ say: q.explanation, board: [{ kind: "point", title: q.explanation, body: "" }] })),
    ],
    practice: qs.slice(0, 2).map((q, i) => ({ ...q, id: "p" + (i + 1) })),
  };
}
