import { speak, stopSpeaking, listen, stopListening, canListen, hasTamilVoice } from "./speech.js";

const $ = (id) => document.getElementById(id);
const els = {
  chapter: $("chapterSelect"), lang: $("langSelect"), voice: $("voiceToggle"), progressBtn: $("progressBtn"),
  avatarWrap: $("avatarWrap"), avStatus: $("avStatus"), mouth: $("mouth"), caption: $("caption"),
  start: $("startBtn"), repeat: $("repeatBtn"), next: $("nextBtn"), mic: $("micBtn"),
  form: $("chatForm"), input: $("chatInput"), log: $("log"), board: $("board"),
  boardTitle: $("boardTitle"), pageInfo: $("pageInfo"), dialog: $("progressDialog"), progressBody: $("progressBody"),
};

const MAX_RETEACH = 3; // re-teaching attempts per concept before moving on

const state = {
  chapters: [], chapter: null, pageIndex: 0, lesson: null,
  conversation: [], checkQuestion: null,
  mode: "idle", // idle | lesson | quiz | results | reteach
  quiz: null, answers: {}, qIndex: 0,
  queue: [], current: null, // re-teaching queue of {concept, mistakes, attempt}
  voiceOn: localGet("voiceOn", "1") === "1",
  busy: false,
};

function localGet(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const lang = () => els.lang.value;
const T = (en, ta) => (lang() === "en" ? en : ta);

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- avatar + voice ----------
function setAvatar(st, label) {
  els.avatarWrap.dataset.state = st;
  els.avStatus.textContent = label ?? { idle: "Ready", thinking: "Thinking…", speaking: "Speaking…", listening: "Listening…" }[st];
}
let mouthTimer = null;
function mouthMove(on) {
  clearInterval(mouthTimer);
  if (!on) return els.mouth.setAttribute("ry", "3");
  mouthTimer = setInterval(() => els.mouth.setAttribute("ry", String(2 + Math.random() * 8)), 110);
}

async function say(text) {
  els.caption.textContent = text;
  addLog("tutor", text);
  if (!state.voiceOn) {
    // Give the student time to read when the voice is off.
    await new Promise((r) => setTimeout(r, Math.min(6000, 600 + text.length * 25)));
    return;
  }
  setAvatar("speaking");
  await speak(text, lang(), { onStart: () => mouthMove(true), onEnd: () => mouthMove(false) });
  mouthMove(false);
  setAvatar("idle");
}

function stopTalking() {
  stopSpeaking();
  mouthMove(false);
  setAvatar("idle");
}

function addLog(role, text) {
  const d = document.createElement("div");
  d.className = "t " + role;
  d.textContent = (role === "student" ? "You: " : "Kavi: ") + text;
  els.log.append(d);
  els.log.scrollTop = els.log.scrollHeight;
  state.conversation.push({ role, text });
  if (state.conversation.length > 40) state.conversation.shift();
}

async function thinking(fn) {
  state.busy = true;
  setAvatar("thinking");
  try {
    return await fn();
  } catch (e) {
    els.caption.textContent = "⚠ " + e.message;
    throw e;
  } finally {
    state.busy = false;
    if (els.avatarWrap.dataset.state === "thinking") setAvatar("idle");
  }
}

// ---------- whiteboard ----------
function clearBoard(title) {
  els.board.innerHTML = "";
  els.boardTitle.textContent = title || "Whiteboard";
}

let mermaidLib = null;
async function renderMermaid(el, src) {
  try {
    mermaidLib ||= (await import("https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.esm.min.mjs")).default;
    mermaidLib.initialize({ startOnLoad: false, theme: "default", securityLevel: "strict" });
    const { svg } = await mermaidLib.render("m" + Math.random().toString(36).slice(2), src);
    el.innerHTML = svg;
  } catch {
    el.innerHTML = `<pre>${esc(src)}</pre>`;
  }
}

function drawItem(item) {
  const d = document.createElement("div");
  d.className = "bi " + item.kind;
  const title = esc(item.title);
  const body = esc(item.body);
  switch (item.kind) {
    case "keyterm": d.innerHTML = `<b>${title}</b>${body ? " – " + body : ""}`; break;
    case "code": d.innerHTML = `${title ? `<div class="label">${title}</div>` : ""}<pre>${body}</pre>`; break;
    case "diagram": d.innerHTML = `<div class="label">${title}</div><div class="mmd"></div>`; renderMermaid(d.querySelector(".mmd"), item.body); break;
    case "example": d.innerHTML = `<b>${title}</b>${body ? `<div>${body}</div>` : ""}`; break;
    default: d.innerHTML = title + (body ? `<div class="label">${body}</div>` : "");
  }
  els.board.append(d);
  d.scrollIntoView({ behavior: "smooth", block: "end" });
}

// Each playback gets a token; interrupt() makes any running playback stop at the next step.
let playToken = 0;
function interrupt() {
  playToken++;
  stopTalking();
}
async function playSteps(steps) {
  const mine = ++playToken;
  for (const step of steps) {
    if (mine !== playToken) return false;
    for (const item of step.board || []) drawItem(item);
    await say(step.say);
  }
  return mine === playToken;
}

// ---------- lesson flow ----------
async function loadPage(i) {
  interrupt();
  state.mode = "lesson";
  state.pageIndex = i;
  state.checkQuestion = null;
  const ch = state.chapter;
  clearBoard(lang() === "en" || !ch.titleTa ? ch.title : `${ch.titleTa} (${ch.title})`);
  els.pageInfo.textContent = `Page ${i + 1} / ${ch.pages}`;
  els.caption.textContent = T("Preparing the page…", "பக்கத்தைத் தயார் செய்கிறேன்…");
  updateButtons();
  const lesson = await thinking(() => api("/api/lesson", { chapterId: ch.id, pageIndex: i, lang: lang() }));
  state.lesson = lesson;
  updateButtons();
  if (await playSteps(lesson.steps)) await askCheck();
}

async function askCheck() {
  const cq = state.lesson?.checkQuestion;
  if (!cq || state.mode !== "lesson") return;
  state.checkQuestion = cq;
  drawItem({ kind: "point", title: "❓ " + cq.question, body: "" });
  els.board.lastChild.classList.add("check");
  await say(cq.question);
  els.mic.classList.add("pulse");
  els.input.placeholder = T("Type or speak your answer…", "உங்கள் பதிலைச் சொல்லுங்கள் அல்லது தட்டச்சு செய்யுங்கள்…");
  updateButtons();
}

async function nextPage() {
  const ch = state.chapter;
  api("/api/page-done", { chapterId: ch.id, pageIndex: state.pageIndex }).catch(() => {});
  if (state.pageIndex + 1 < ch.pages) return loadPage(state.pageIndex + 1);
  return startQuiz();
}

// Handle anything the student says or types.
async function handleStudent(text) {
  text = text.trim();
  if (!text || state.busy) return;
  interrupt();
  els.mic.classList.remove("pulse");

  // Simple voice commands, no AI call needed.
  const t = text.toLowerCase();
  if (state.mode === "lesson" && /^(next( page)?|அடுத்த(து)?( பக்கம்)?|அடுத்த பக்கம்)[.!]?$/.test(t)) return nextPage();
  if (state.mode === "lesson" && /^(repeat|again|மீண்டும்|திரும்ப)[.!]?$/.test(t)) return repeatPage();
  if (state.mode === "quiz") return quizVoiceAnswer(text);

  if (!state.chapter) return;
  addLog("student", text);
  const r = await thinking(() =>
    api("/api/reply", {
      chapterId: state.chapter.id, pageIndex: state.pageIndex, lang: lang(),
      conversation: state.conversation.slice(-12), message: text, checkQuestion: state.checkQuestion,
    })
  );
  if (r.verdict === "understood") state.checkQuestion = null;
  await playSteps(r.steps);
  if (r.verdict === "understood") els.next.classList.add("pulse");
  else if (r.verdict === "not_yet") els.mic.classList.add("pulse");
}

async function repeatPage() {
  if (!state.lesson) return;
  interrupt();
  clearBoard(els.boardTitle.textContent);
  if (await playSteps(state.lesson.steps)) await askCheck();
}

// ---------- quiz ----------
async function startQuiz() {
  stopTalking();
  state.mode = "quiz";
  clearBoard(T("Chapter quiz", "பாடத் தேர்வு"));
  els.pageInfo.textContent = "";
  updateButtons();
  await say(T("Well done! You finished the chapter. Now let's take a short quiz on the important topics.", "அருமை! இந்தப் பாடத்தை முடித்துவிட்டீர்கள். இப்போது முக்கியமான தலைப்புகளில் ஒரு சிறிய தேர்வு எழுதுவோம்."));
  const quiz = await thinking(() => api("/api/quiz", { chapterId: state.chapter.id, lang: lang() }));
  beginQuestions(quiz, "chapter");
}

function beginQuestions(quiz, kind) {
  state.mode = "quiz";
  state.quiz = { ...quiz, kind };
  state.answers = {};
  state.qIndex = 0;
  updateButtons();
  showQuestion();
}

function readQuestion(q) {
  let s = q.question;
  if (q.code) s += T(" Look at the code on the board.", " பலகையில் உள்ள நிரலைப் பாருங்கள்.");
  if (q.type === "mcq") s += " " + q.options.map((o, i) => `${T("Option", "விடை")} ${"ABCD"[i]}: ${o}.`).join(" ");
  return s;
}

function showQuestion() {
  const { questions, kind } = state.quiz;
  const q = questions[state.qIndex];
  const total = questions.length;
  const given = state.answers[q.id] ?? "";
  const heading = kind === "chapter" ? T("Chapter quiz", "பாடத் தேர்வு") : T("Practice: ", "பயிற்சி: ") + state.current.concept;
  els.board.innerHTML = `
    <div class="quiz">
      <h3>${esc(heading)}</h3>
      <div class="dots">${questions.map((x, i) => `<button class="dot ${state.answers[x.id] ? "done" : ""} ${i === state.qIndex ? "cur" : ""}" data-i="${i}">${i + 1}</button>`).join("")}</div>
      <div class="q-meta">${T("Question", "கேள்வி")} ${state.qIndex + 1} / ${total} · ${esc(q.concept)}</div>
      <div class="q-text">${esc(q.question)}</div>
      ${q.code ? `<div class="bi code"><pre>${esc(q.code)}</pre></div>` : ""}
      ${q.type === "mcq"
        ? `<div class="opts">${q.options.map((o, i) => `<button class="opt ${given === o ? "sel" : ""}" data-o="${i}"><b>${"ABCD"[i]}.</b> ${esc(o)}</button>`).join("")}</div>`
        : `<textarea id="ansBox" placeholder="${T("Type your answer, or tap 🎤 and speak", "உங்கள் பதிலை எழுதுங்கள் அல்லது 🎤 அழுத்திப் பேசுங்கள்")}">${esc(given)}</textarea>`}
      <div class="q-nav">
        <button id="qPrev" ${state.qIndex === 0 ? "disabled" : ""}>← ${T("Back", "முந்தைய")}</button>
        <button id="qRead">🔊 ${T("Read again", "மீண்டும் படி")}</button>
        ${state.qIndex < total - 1
          ? `<button id="qNext" class="primary">${T("Next", "அடுத்து")} →</button>`
          : `<button id="qSubmit" class="primary">✔ ${T("Submit answers", "பதில்களைச் சமர்ப்பி")}</button>`}
      </div>
    </div>`;
  const box = $("ansBox");
  box?.addEventListener("input", () => (state.answers[q.id] = box.value));
  els.board.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => { state.answers[q.id] = q.options[+b.dataset.o]; showQuestion(); }));
  els.board.querySelectorAll(".dot").forEach((b) => b.addEventListener("click", () => { state.qIndex = +b.dataset.i; showQuestion(); }));
  $("qPrev").onclick = () => { state.qIndex--; showQuestion(); };
  $("qRead").onclick = () => { stopTalking(); say(readQuestion(q)); };
  if ($("qNext")) $("qNext").onclick = () => { state.qIndex++; showQuestion(); };
  if ($("qSubmit")) $("qSubmit").onclick = submitQuiz;
  stopTalking();
  say(readQuestion(q));
}

// Spoken answers during a quiz: "A"/"option B" picks an option; anything else fills the text answer.
function quizVoiceAnswer(text) {
  const q = state.quiz.questions[state.qIndex];
  if (q.type === "mcq") {
    const m = text.trim().match(/^(?:option|விடை)?\s*([abcd])\b/i);
    const idx = m ? "abcd".indexOf(m[1].toLowerCase()) : q.options.findIndex((o) => o.toLowerCase().includes(text.toLowerCase()) || text.toLowerCase().includes(o.toLowerCase()));
    if (idx >= 0 && idx < q.options.length) state.answers[q.id] = q.options[idx];
    else return say(T("Please say A, B, C or D.", "A, B, C அல்லது D என்று சொல்லுங்கள்."));
  } else state.answers[q.id] = text;
  showQuestion();
}

async function submitQuiz() {
  const unanswered = state.quiz.questions.filter((q) => !String(state.answers[q.id] ?? "").trim()).length;
  if (unanswered && !confirm(T(`${unanswered} question(s) not answered. Submit anyway?`, `${unanswered} கேள்விகளுக்கு பதில் இல்லை. சமர்ப்பிக்கலாமா?`))) return;
  stopTalking();
  const res = await thinking(() => api("/api/submit", { quizId: state.quiz.quizId, answers: state.answers }));
  if (state.quiz.kind === "chapter") return showResults(res);
  return afterPractice(res);
}

async function showResults(res) {
  state.mode = "results";
  updateButtons();
  els.board.innerHTML = `<div class="quiz">
      <h3>${T("Your result", "உங்கள் மதிப்பெண்")}</h3>
      <div class="score">${res.score} / ${res.total}</div>
      ${res.results.map((r) => `
        <div class="result ${r.correct ? "ok" : "no"}">
          <div><b>${r.correct ? "✔" : "✘"}</b> ${esc(r.question)}</div>
          <small>${T("Your answer", "உங்கள் பதில்")}: ${esc(r.given || "—")}</small><br/>
          ${r.correct ? "" : `<small>${T("Correct answer", "சரியான பதில்")}: ${esc(r.answer)}</small><br/>`}
          <small>${esc(r.feedback)}</small>
        </div>`).join("")}
    </div>`;
  els.board.scrollTop = 0;
  const weak = res.weakConcepts;
  if (!weak.length) {
    await say(T(`Excellent! You scored ${res.score} out of ${res.total}. You have mastered this chapter!`, `அருமை! ${res.total}-க்கு ${res.score} மதிப்பெண். இந்தப் பாடத்தை முழுமையாகக் கற்றுவிட்டீர்கள்!`));
    return chapterDone();
  }
  await say(T(
    `You scored ${res.score} out of ${res.total}. Good effort! Let's go over ${weak.length === 1 ? "one topic" : weak.length + " topics"} again: ${weak.map((w) => w.concept).join(", ")}.`,
    `${res.total}-க்கு ${res.score} மதிப்பெண். நல்ல முயற்சி! இந்தத் தலைப்புகளை மீண்டும் படிப்போம்: ${weak.map((w) => w.concept).join(", ")}.`
  ));
  state.queue = weak.map((w) => ({ ...w, attempt: 1 }));
  nextReteach();
}

// ---------- re-teaching loop ----------
async function nextReteach() {
  state.current = state.queue.shift();
  if (!state.current) return chapterDone();
  const { concept, mistakes, attempt } = state.current;
  state.mode = "reteach";
  updateButtons();
  clearBoard(T("Let's revise: ", "மீண்டும் படிப்போம்: ") + concept);
  els.pageInfo.textContent = attempt > 1 ? T(`Attempt ${attempt}`, `முயற்சி ${attempt}`) : "";
  const r = await thinking(() => api("/api/reteach", { chapterId: state.chapter.id, lang: lang(), concept, mistakes, attempt }));
  if (!(await playSteps(r.steps))) return;
  await say(T("Now try these two questions.", "இப்போது இந்த இரண்டு கேள்விகளுக்கு பதில் சொல்லுங்கள்."));
  beginQuestions({ quizId: r.quizId, questions: r.questions }, "practice");
}

async function afterPractice(res) {
  const cur = state.current;
  if (res.score === res.total) {
    clearBoard(cur.concept);
    drawItem({ kind: "heading", title: "✔ " + cur.concept, body: "" });
    await say(T(`Perfect! You've got ${cur.concept} now.`, `சூப்பர்! ${cur.concept} இப்போது புரிந்துவிட்டது.`));
  } else if (cur.attempt >= MAX_RETEACH) {
    await say(T(`${cur.concept} needs a bit more time. I've marked it for revision, and we'll come back to it.`, `${cur.concept} இன்னும் கொஞ்சம் பயிற்சி வேண்டும். மீண்டும் படிக்கக் குறித்து வைத்துள்ளேன்.`));
  } else {
    const wrong = res.results.filter((r) => !r.correct);
    await say(wrong.map((r) => r.feedback).join(" ") + " " + T("Let me explain it another way.", "வேறு விதமாக விளக்குகிறேன்."));
    state.queue.unshift({
      concept: cur.concept,
      attempt: cur.attempt + 1,
      mistakes: [...cur.mistakes, ...wrong.map((r) => ({ question: r.question, studentAnswer: r.given, correctAnswer: r.answer, misconception: r.misconception }))],
    });
  }
  nextReteach();
}

async function chapterDone() {
  state.mode = "idle";
  state.current = null;
  updateButtons();
  drawItem({ kind: "heading", title: "🎉 " + T("Chapter complete!", "பாடம் முடிந்தது!"), body: "" });
  const idx = state.chapters.findIndex((c) => c.id === state.chapter.id);
  const nextCh = state.chapters[idx + 1];
  await say(nextCh
    ? T(`Great work today. When you are ready, choose the next chapter: ${nextCh.title}.`, `இன்று நன்றாகப் படித்தீர்கள். தயாரானதும் அடுத்த பாடம் ${nextCh.titleTa || nextCh.title} தேர்வு செய்யுங்கள்.`)
    : T("Great work today!", "இன்று நன்றாகப் படித்தீர்கள்!"));
  if (nextCh) els.chapter.value = nextCh.id, selectChapter();
}

// ---------- progress ----------
async function showProgress() {
  const p = await api("/api/progress");
  els.progressBody.innerHTML = state.chapters.map((c) => {
    const cp = p.chapters[c.id];
    if (!cp) return `<h3>${esc(c.title)}</h3><p class="label">${T("Not started", "தொடங்கவில்லை")}</p>`;
    const last = cp.quizzes.at(-1);
    const concepts = Object.entries(cp.concepts);
    return `<h3>${esc(c.title)}</h3>
      <div>${T("Pages studied", "படித்த பக்கங்கள்")}: ${cp.pagesDone.length} / ${c.pages}</div>
      <div class="bar"><i style="width:${(100 * cp.pagesDone.length) / c.pages}%"></i></div>
      ${last ? `<div>${T("Last quiz", "கடைசி தேர்வு")}: ${last.score} / ${last.total} (${new Date(last.date).toLocaleDateString()})</div>` : ""}
      <div class="concepts">${concepts.map(([n, s]) => `<span class="concept ${s.status}" title="✔ ${s.correct} ✘ ${s.wrong}">${esc(n)}</span>`).join("")}</div>`;
  }).join("") || "<p>No chapters loaded.</p>";
  els.dialog.showModal();
}

// ---------- wiring ----------
function updateButtons() {
  const lessonOn = state.mode === "lesson" && !!state.lesson;
  els.repeat.disabled = !lessonOn;
  els.next.disabled = !lessonOn;
  els.next.classList.remove("pulse");
  if (state.chapter && lessonOn) {
    els.next.textContent = state.pageIndex + 1 < state.chapter.pages ? T("Next page →", "அடுத்த பக்கம் →") : T("Start quiz →", "தேர்வு தொடங்கு →");
  }
  els.start.textContent = state.mode === "idle" ? T("▶ Start lesson", "▶ பாடம் தொடங்கு") : T("↻ Restart chapter", "↻ மீண்டும் தொடங்கு");
}

function selectChapter() {
  interrupt();
  state.chapter = state.chapters.find((c) => c.id === els.chapter.value) || null;
  state.mode = "idle";
  state.lesson = null;
  localSet("chapter", els.chapter.value);
  clearBoard(state.chapter?.title);
  els.board.innerHTML = `<div class="board-empty">${state.chapter ? `${esc(state.chapter.title)} · ${state.chapter.pages} ${T("pages", "பக்கங்கள்")}<br/>${T("Press Start lesson.", "பாடம் தொடங்கு அழுத்துங்கள்.")}` : ""}</div>`;
  els.pageInfo.textContent = "";
  updateButtons();
}

async function onMic() {
  if (els.mic.classList.contains("listening")) return stopListening();
  stopTalking();
  els.mic.classList.add("listening");
  els.mic.classList.remove("pulse");
  setAvatar("listening");
  try {
    const text = await listen(lang(), { onInterim: (t) => (els.input.value = t) });
    els.input.value = "";
    if (text) await handleStudent(text);
  } catch (e) {
    els.caption.textContent = "⚠ " + e.message;
  } finally {
    els.mic.classList.remove("listening");
    if (els.avatarWrap.dataset.state === "listening") setAvatar("idle");
  }
}

function setVoiceLabel() {
  els.voice.textContent = state.voiceOn ? "🔊 Voice on" : "🔇 Voice off";
}

async function init() {
  const [cfg, chapters] = await Promise.all([api("/api/config"), api("/api/chapters")]);
  $("demoBanner").hidden = !cfg.demo;
  state.chapters = chapters;
  els.chapter.innerHTML = chapters.map((c, i) => `<option value="${esc(c.id)}">${i + 1}. ${esc(c.title)}${c.titleTa ? " · " + esc(c.titleTa) : ""}</option>`).join("");
  const saved = localGet("chapter", "");
  if (chapters.some((c) => c.id === saved)) els.chapter.value = saved;
  els.lang.value = localGet("lang", "en");
  setVoiceLabel();
  selectChapter();
  if (!canListen) els.mic.title = "Voice input needs Chrome or Edge. You can type instead.";

  els.chapter.onchange = selectChapter;
  els.lang.onchange = () => {
    localSet("lang", lang());
    updateButtons();
    if (lang() !== "en" && !hasTamilVoice()) els.caption.textContent = "ℹ This browser has no Tamil voice. Tamil text will still show; for Tamil speech use Microsoft Edge or Chrome on Android.";
  };
  els.voice.onclick = () => { state.voiceOn = !state.voiceOn; localSet("voiceOn", state.voiceOn ? "1" : "0"); if (!state.voiceOn) stopTalking(); setVoiceLabel(); };
  els.start.onclick = () => state.chapter && loadPage(0).catch(() => {});
  els.repeat.onclick = () => repeatPage().catch(() => {});
  els.next.onclick = () => nextPage().catch(() => {});
  els.mic.onclick = onMic;
  els.avatarWrap.onclick = () => stopTalking(); // skip the current sentence
  els.form.onsubmit = (e) => { e.preventDefault(); const t = els.input.value; els.input.value = ""; handleStudent(t).catch(() => {}); };
  els.progressBtn.onclick = () => showProgress().catch((e) => alert(e.message));
  $("closeProgress").onclick = () => els.dialog.close();
}

init().catch((e) => (els.caption.textContent = "⚠ Could not start: " + e.message));
