// Generate the offline lessons, quizzes and re-teaching for every chapter (needs the API key ONCE).
//
//   npm run build-content                     all chapters, languages from CONTENT_LANGS (default en,ta,mix)
//   npm run build-content -- --only ch01      one chapter (comma-separate for more)
//   npm run build-content -- --langs ta,en    choose languages
//   npm run build-content -- --assemble       no API calls: just rebuild public/content from what is generated
//
// Every generated piece is saved in content/generated/ immediately, so the script can be stopped
// and re-run: finished pieces are skipped. The app reads public/content/ (written at the end).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] || "" : "");
const ONLY = opt("--only").split(",").filter(Boolean);
const LANGS = (opt("--langs") || process.env.CONTENT_LANGS || "en,ta,mix").split(",").filter(Boolean);
const ASSEMBLE_ONLY = args.includes("--assemble");
const BANK_SIZE = Number(process.env.QUIZ_BANK_SIZE) || 16;
const CONCURRENCY = Number(process.env.CONTENT_CONCURRENCY) || 4;
const GEN = "content/generated";
const OUT = "public/content";

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const writeJson = (f, v) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v, null, 1));
};
const slug = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);

const chapterDir = "content/chapters";
const chapters = (fs.existsSync(chapterDir) ? fs.readdirSync(chapterDir) : [])
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => readJson(path.join(chapterDir, f)))
  .filter((c) => c.pages?.length && (!ONLY.length || ONLY.includes(c.id)));

// ---------- generate ----------
if (!ASSEMBLE_ONLY) {
  if (!chapters.length) {
    console.log("No chapters in content/chapters. Run `npm run ingest` first (it reads the textbook PDFs).");
    process.exit(1);
  }
  const gen = await import("../generator/generate.js");
  const { Anthropic } = await import("../generator/client.js");
  console.log(`Generating with ${gen.MODEL}: ${chapters.length} chapter(s) x ${LANGS.join(", ")}`);

  let done = 0, failed = 0;
  async function runAll(tasks) {
    const queue = tasks.filter((t) => !fs.existsSync(t.file));
    async function worker() {
      while (queue.length) {
        const t = queue.shift();
        for (let attempt = 1; ; attempt++) {
          try {
            writeJson(t.file, await t.run());
            done++;
            process.stdout.write(`\r  generated ${done} piece(s)${failed ? `, ${failed} failed` : ""}   `);
            break;
          } catch (err) {
            if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message)) {
              console.error("\nYour Anthropic credit balance is too low. Add credit at console.anthropic.com -> Billing, then run this again: finished work is kept.");
              process.exit(3);
            }
            if (err instanceof Anthropic.AuthenticationError) {
              console.error("\nThe API key was rejected. Run `npm run check-key`.");
              process.exit(1);
            }
            const retryable = err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError ||
              err instanceof Anthropic.APIConnectionError || /Incomplete/.test(err.message);
            if (retryable && attempt < 4) {
              await new Promise((r) => setTimeout(r, 8000 * attempt));
              continue;
            }
            failed++;
            console.error(`\n  ${t.label} failed: ${err.message}`);
            break;
          }
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }

  // Phase 1: page lessons and question banks. Phase 2: re-teaching per concept (needs the bank's concept list).
  const phase1 = [];
  for (const ch of chapters)
    for (const lang of LANGS) {
      const dir = path.join(GEN, ch.id, lang);
      ch.pages.forEach((_, i) =>
        phase1.push({ file: path.join(dir, `page-${String(i).padStart(3, "0")}.json`), label: `${ch.id} ${lang} page ${i + 1}`, run: () => gen.pageContent(ch, i, lang) })
      );
      phase1.push({ file: path.join(dir, "bank.json"), label: `${ch.id} ${lang} quiz bank`, run: () => gen.questionBank(ch, lang, BANK_SIZE) });
    }
  await runAll(phase1);

  const phase2 = [];
  for (const ch of chapters)
    for (const lang of LANGS) {
      const bankFile = path.join(GEN, ch.id, lang, "bank.json");
      if (!fs.existsSync(bankFile)) continue;
      for (const concept of readJson(bankFile).concepts)
        phase2.push({ file: path.join(GEN, ch.id, lang, "reteach", `${slug(concept)}.json`), label: `${ch.id} ${lang} re-teach "${concept}"`, run: async () => ({ concept, ...(await gen.conceptReteach(ch, lang, concept)) }) });
    }
  await runAll(phase2);
  console.log(failed ? `\n${failed} piece(s) failed. Run the same command again to retry them.` : "\nGeneration finished.");
}

// ---------- assemble public/content ----------
// MCQ answers must match an option exactly to be checked offline; otherwise treat as short answer.
function fixQuestion(q) {
  if (q.type === "mcq" && !q.options.includes(q.answer)) {
    const hit = q.options.find((o) => o.trim().toLowerCase() === q.answer.trim().toLowerCase());
    if (hit) q.answer = hit;
    else {
      q.type = "short";
      if (!q.keywords?.length) q.keywords = [q.answer];
    }
  }
  return q;
}

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith(".js")) fs.rmSync(path.join(OUT, f));

const index = [];
const allChapters = fs.existsSync(chapterDir)
  ? fs.readdirSync(chapterDir).filter((f) => f.endsWith(".json")).sort().map((f) => readJson(path.join(chapterDir, f)))
  : [];
for (const ch of allChapters) {
  const langs = [];
  for (const lang of ["en", "ta", "mix"]) {
    const dir = path.join(GEN, ch.id, lang);
    if (!fs.existsSync(path.join(dir, "bank.json"))) continue;
    const pages = [];
    let complete = true;
    ch.pages.forEach((p, i) => {
      const f = path.join(dir, `page-${String(i).padStart(3, "0")}.json`);
      if (fs.existsSync(f)) pages.push({ page: p.page, ...readJson(f) });
      else complete = false;
    });
    if (!complete) {
      console.log(`  ${ch.id} ${lang}: some pages missing, skipped (run build-content again)`);
      continue;
    }
    const bank = readJson(path.join(dir, "bank.json"));
    const reteach = {};
    const rdir = path.join(dir, "reteach");
    if (fs.existsSync(rdir))
      for (const f of fs.readdirSync(rdir)) {
        const r = readJson(path.join(rdir, f));
        reteach[r.concept] = r.variants.map((v) => ({ steps: v.steps, practice: v.practice.map(fixQuestion) }));
      }
    const data = { id: ch.id, lang, title: ch.title, titleTa: ch.titleTa || "", pages, concepts: bank.concepts, questions: bank.questions.map(fixQuestion), reteach };
    fs.writeFileSync(path.join(OUT, `${ch.id}.${lang}.js`), `window.BOOK_DATA=window.BOOK_DATA||{};BOOK_DATA[${JSON.stringify(ch.id + "." + lang)}]=${JSON.stringify(data)};\n`);
    langs.push(lang);
  }
  if (langs.length) index.push({ id: ch.id, title: ch.title, titleTa: ch.titleTa || "", pages: ch.pages.length, langs });
}

// Until real chapters are generated, the app ships the hand-written sample chapter.
if (!index.length) {
  const sample = readJson("content/sample/ch00-sample.offline.json");
  for (const [lang, d] of Object.entries(sample.langs)) {
    const data = { id: sample.id, lang, title: sample.title, titleTa: sample.titleTa, ...d, questions: d.questions.map(fixQuestion) };
    fs.writeFileSync(path.join(OUT, `${sample.id}.${lang}.js`), `window.BOOK_DATA=window.BOOK_DATA||{};BOOK_DATA[${JSON.stringify(sample.id + "." + lang)}]=${JSON.stringify(data)};\n`);
  }
  index.push({ id: sample.id, title: sample.title, titleTa: sample.titleTa, pages: sample.langs.en.pages.length, langs: Object.keys(sample.langs), sample: true });
  console.log("No generated chapters yet: the app will show the sample chapter.");
}
fs.writeFileSync(path.join(OUT, "index.js"), `window.BOOK_INDEX=${JSON.stringify(index)};\n`);
console.log(`Wrote ${OUT}/ for ${index.length} chapter(s). Run \`npm start\` to try it, then \`npm run dist\` to build the .exe.`);
