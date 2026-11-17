// npm run preview: open the app in your web browser (Edge/Chrome) without Electron.
// Serves the public/ folder on http://localhost:8080 from this computer only.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";

const root = path.resolve("public");
const port = Number(process.env.PORT) || 8080;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

http
  .createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path.join(root, url === "/" ? "index.html" : url);
    if (!file.startsWith(root + path.sep) && file !== root) return res.writeHead(403).end();
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end("Not found");
      res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }).end(data);
    });
  })
  .listen(port, "127.0.0.1", () => {
    const url = `http://localhost:${port}`;
    console.log(`Guru is running at ${url}  (press Ctrl+C to stop)`);
    const open = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open ${url}` : `xdg-open ${url}`;
    exec(open, () => {});
  });
