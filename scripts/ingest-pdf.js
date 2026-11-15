// Turn the textbook PDF into chapter files the tutor teaches from, one PDF page at a time.
//
//   1) npm run ingest -- path/to/textbook.pdf
//      Writes content/pdf-pages.txt (first lines of every page) so you can find where chapters start.
//   2) Fill in content/book.config.json with each chapter's page range (copy book.config.example.json).
//   3) npm run ingest -- path/to/textbook.pdf
//      Writes content/chapters/chNN.json. Restart the server to see them.
import fs from "node:fs";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const pdfPath = process.argv[2];
if (!pdfPath || !fs.existsSync(pdfPath)) {
  console.error("Usage: npm run ingest -- path/to/textbook.pdf");
  process.exit(1);
}

const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), useSystemFonts: true }).promise;
console.log(`Read ${doc.numPages} pages from ${path.basename(pdfPath)}`);

async function pageText(n) {
  const page = await doc.getPage(n);
  const content = await page.getTextContent();
  let out = "";
  let lastY = null;
  for (const item of content.items) {
    if (!("str" in item)) continue;
    const y = item.transform[5];
    if (lastY !== null && Math.abs(y - lastY) > 2) out += "\n";
    out += item.str;
    lastY = y;
  }
  return out.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

fs.mkdirSync("content/chapters", { recursive: true });
const configPath = "content/book.config.json";

if (!fs.existsSync(configPath)) {
  const lines = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const t = await pageText(n);
    lines.push(`PDF page ${n}: ${t.split("\n").slice(0, 3).join(" | ").slice(0, 160)}`);
  }
  fs.writeFileSync("content/pdf-pages.txt", lines.join("\n"));
  console.log("No content/book.config.json yet.");
  console.log("Wrote content/pdf-pages.txt: use it to find each chapter's first and last PDF page,");
  console.log("then copy content/book.config.example.json to content/book.config.json, fill it in, and run this again.");
  process.exit(0);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
for (const [i, ch] of config.chapters.entries()) {
  const pages = [];
  for (let n = ch.startPage; n <= ch.endPage; n++) {
    const text = await pageText(n);
    if (text.length < 80) continue; // skip blank/picture-only pages
    pages.push({ page: n - (config.pageOffset || 0), text });
  }
  const id = ch.id || `ch${String(i + 1).padStart(2, "0")}`;
  const out = { id, title: ch.title, titleTa: ch.titleTa || "", source: path.basename(pdfPath), pages };
  fs.writeFileSync(path.join("content/chapters", `${id}.json`), JSON.stringify(out, null, 2));
  console.log(`${id}: ${ch.title} -> ${pages.length} pages`);
}
console.log("Done. Restart the server (npm start) to use the new chapters.");
