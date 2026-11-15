// Tiny JSON-file storage: chapters, lesson cache and the student's progress.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.env.TUTOR_ROOT || ".");
const CHAPTER_DIRS = [path.join(ROOT, "content/chapters"), path.join(ROOT, "content/sample")];
const DATA = path.join(ROOT, "data");
const CACHE = path.join(DATA, "cache");
const PROGRESS = path.join(DATA, "progress.json");
fs.mkdirSync(CACHE, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(file, value) {
  fs.writeFileSync(file + ".tmp", JSON.stringify(value, null, 2));
  fs.renameSync(file + ".tmp", file);
}

// Real chapters (content/chapters) win over the bundled sample.
export function listChapters() {
  for (const dir of CHAPTER_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    const chapters = files.map((f) => readJson(path.join(dir, f))).filter((c) => c && c.pages?.length);
    if (chapters.length) return chapters;
  }
  return [];
}
export function getChapter(id) {
  return listChapters().find((c) => c.id === id);
}

const safe = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "_");
export function cacheGet(key) {
  return readJson(path.join(CACHE, safe(key) + ".json"), null);
}
export function cacheSet(key, value) {
  writeJson(path.join(CACHE, safe(key) + ".json"), value);
}

export function getProgress() {
  return readJson(PROGRESS, { chapters: {} });
}
export function updateProgress(chapterId, fn) {
  const all = getProgress();
  const ch = (all.chapters[chapterId] ||= { pagesDone: [], quizzes: [], concepts: {} });
  fn(ch);
  writeJson(PROGRESS, all);
  return ch;
}

// Record one graded answer against its concept.
export function recordAnswer(ch, concept, correct) {
  const c = (ch.concepts[concept] ||= { correct: 0, wrong: 0, status: "learning" });
  if (correct) c.correct++;
  else c.wrong++;
  if (!correct) c.status = "needs_practice";
}
