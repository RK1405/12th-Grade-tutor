// Build the tutor's chapters from the textbook PDF(s) listed in content/book.config.json.
//
//   npm run ingest                 read every chapter page with Claude (handles Tamil fonts properly)
//   npm run ingest -- --only ch01  just one chapter (comma-separate for more)
//   npm run ingest -- --text       use the PDF's own text layer instead (fine for English PDFs, no API cost)
//
// Each page is saved to content/transcripts/pNNN.json as soon as it is read, so the
// script can be stopped and re-run: finished pages are skipped. Chapters are then
// written to content/chapters/chNN.json. Restart the server afterwards.
import fs from "node:fs";
import path from "node:path";
import { Anthropic, client as apiClient, BETAS } from "../server/client.js";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const args = process.argv.slice(2);
const TEXT_MODE = args.includes("--text");
const ONLY = (args[args.indexOf("--only") + 1] || "").split(",").filter((s) => args.includes("--only") && s);
const MODEL = process.env.TUTOR_INGEST_MODEL || process.env.TUTOR_MODEL || "claude-opus-5-5";
const CONCURRENCY = Number(process.env.INGEST_CONCURRENCY) || 4;
const TRANSCRIPTS = "content/transcripts";
const CHAPTERS = "content/chapters";

const config = JSON.parse(fs.readFileSync("content/book.config.json", "utf8"));
fs.mkdirSync(TRANSCRIPTS, { recursive: true });
fs.mkdirSync(CHAPTERS, { recursive: true });

// Global page n (1-based across all parts) -> { part, index }
const parts = [];
for (const file of config.parts) {
  const bytes = fs.readFileSync(file);
  parts.push({ file, bytes, lib: await PDFDocument.load(bytes), js: null });
}
function locate(n) {
  for (const p of parts) {
    const count = p.lib.getPageCount();
    if (n <= count) return { part: p, index: n - 1 };
    n -= count;
  }
  throw new Error("Page out of range");
}

const PageSchema = z.object({
  kind: z
    .enum(["lesson", "exercises", "other"])
    .describe("lesson = teaching content; exercises = evaluation questions/activities; other = blank, cover, index, practical list"),
  text: z.string().describe("Faithful transcription of the page in clean Unicode"),
});

const client = TEXT_MODE ? null : apiClient;
const PROMPT = `This is one page of a Class 12 Computer Science textbook (Tamil Nadu State Board, ${config.book.includes("Tamil") ? "Tamil medium" : "English medium"}).
Transcribe it faithfully into clean Unicode text:
- Keep the original language and wording. Fix nothing except obvious print artefacts. Do not translate or summarise.
- Keep English technical terms, code, SQL and program output exactly as printed. Put code on its own lines with its indentation.
- Keep headings and section numbers (e.g. "7.2.1 ...") on their own lines. Render tables as simple "a | b | c" rows.
- For each figure or diagram write one line: [படம்/Figure: short description of what it shows].
- Leave out the running header/footer, page number and file names (e.g. ".indd", "www.tntextbooks.in").`;

async function readPage(n) {
  const { part, index } = locate(n);
  if (TEXT_MODE) {
    part.js ||= await getDocument({ data: new Uint8Array(part.bytes), verbosity: 0 }).promise;
    const items = (await (await part.js.getPage(index + 1)).getTextContent()).items;
    const text = items.map((i) => i.str + (i.hasEOL ? "\n" : " ")).join("").replace(/[ \t]+/g, " ").trim();
    return { kind: text.length < 80 ? "other" : "lesson", text };
  }
  const single = await PDFDocument.create();
  const [copy] = await single.copyPages(part.lib, [index]);
  single.addPage(copy);
  const data = Buffer.from(await single.save()).toString("base64");

  for (let attempt = 1; ; attempt++) {
    try {
      const res = await client.beta.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        betas: BETAS,
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(PageSchema) },
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data } },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      });
      if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error(`no transcription (stop_reason ${res.stop_reason})`);
      return res.parsed_output;
    } catch (err) {
      const retryable = err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError || /no transcription/.test(err.message);
      if (!retryable || attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
}

const chapters = config.chapters.filter((c) => !ONLY.length || ONLY.includes(c.id));
const todo = [];
for (const ch of chapters)
  for (let n = ch.startPage; n <= ch.endPage; n++) {
    const file = path.join(TRANSCRIPTS, `p${String(n).padStart(3, "0")}.json`);
    const existing = fs.existsSync(file) && JSON.parse(fs.readFileSync(file, "utf8"));
    if (!existing || (existing.mode === "text" && !TEXT_MODE)) todo.push({ n, file });
  }

console.log(`${chapters.length} chapter(s), ${todo.length} page(s) to read${TEXT_MODE ? " (text layer)" : ` with ${MODEL}`}.`);
let done = 0;
let failed = 0;
async function worker() {
  while (todo.length) {
    const { n, file } = todo.shift();
    try {
      const page = await readPage(n);
      fs.writeFileSync(file, JSON.stringify({ pdfPage: n, mode: TEXT_MODE ? "text" : "vision", ...page }, null, 1));
      done++;
      process.stdout.write(`\r  read ${done} page(s)${failed ? `, ${failed} failed` : ""}   `);
    } catch (err) {
      failed++;
      console.error(`\n  page ${n} failed: ${err.message}`);
      if (err instanceof Anthropic.AuthenticationError) process.exit(1);
    }
  }
}
await Promise.all(Array.from({ length: TEXT_MODE ? 1 : CONCURRENCY }, worker));
if (done) console.log();

// Assemble chapter files from whatever transcripts exist.
for (const ch of chapters) {
  const pages = [];
  const exercises = [];
  for (let n = ch.startPage; n <= ch.endPage; n++) {
    const file = path.join(TRANSCRIPTS, `p${String(n).padStart(3, "0")}.json`);
    if (!fs.existsSync(file)) continue;
    const t = JSON.parse(fs.readFileSync(file, "utf8"));
    const entry = { page: n - (config.pageOffset || 0), text: t.text };
    if (t.kind === "lesson") pages.push(entry);
    else if (t.kind === "exercises") exercises.push(entry);
  }
  const missing = ch.endPage - ch.startPage + 1 - pages.length - exercises.length;
  const out = { id: ch.id, title: ch.title, titleTa: ch.titleTa || "", source: config.book, pages, exercises };
  fs.writeFileSync(path.join(CHAPTERS, `${ch.id}.json`), JSON.stringify(out, null, 2));
  console.log(`${ch.id} ${ch.title}: ${pages.length} lesson page(s), ${exercises.length} exercise page(s)${missing ? `, ${missing} skipped/unread` : ""}`);
}
if (failed) console.log(`${failed} page(s) failed. Run the same command again to retry them.`);
console.log("Restart the server (npm start) to use the chapters.");
