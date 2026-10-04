// Tiny static server for the fixtures: node serve.mjs [port]  (default 8091)
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), ".");
http.createServer((req, res) => {
  const rel = new URL(req.url, "http://x").pathname.replace(/\/+$/, "") || "/index.html";
  const f = path.join(dir, rel === "/" ? "index.html" : rel);
  fs.readFile(f.startsWith(dir) ? f : "", (e, b) => e ? res.writeHead(404).end() : res.writeHead(200, { "content-type": f.endsWith(".html") ? "text/html" : "text/plain" }).end(b));
}).listen(+process.argv[2] || 8091, () => console.log("fixtures on", process.argv[2] || 8091));
