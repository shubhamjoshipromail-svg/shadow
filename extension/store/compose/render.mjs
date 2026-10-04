#!/usr/bin/env node
/*
 * Render the Chrome Web Store images for the Tacet extension.
 *
 *   node extension/store/compose/render.mjs
 *
 * What it does
 *   1. serves compose/ over http://localhost:9350 and the *real*
 *      backend/shadow/static/capture.js at /capture.js, the real sprite at
 *      /companion/intern.png, and a stub /api/config
 *   2. runs a fake Tacet Core WebSocket on the same port (/ws/capture) that
 *      sends the same messages the engine sends: session, ask, intervene
 *   3. launches headless Chrome with --remote-debugging-port=9351 (CDP) and,
 *      for each shot, opens the host page, waits for the companion to settle,
 *      and writes a PNG into extension/store/
 *
 * Never touches port 8000. Writes only inside extension/store/.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.resolve(__dirname, ".."); // extension/store/
const REPO = path.resolve(STORE, "..", ".."); // repo root
const STATIC = path.join(REPO, "backend", "shadow", "static");

const HTTP_PORT = 9350;
const CDP_PORT = 9351;
const ORIGIN = `http://localhost:${HTTP_PORT}`;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const cft = "Google Chrome for Testing";
  const candidates = [
    process.env.CHROME,
    `/tmp/tacet-cft/chrome-mac-arm64/${cft}.app/Contents/MacOS/${cft}`,
    path.join(REPO, "extension", ".cache", "chrome-mac-arm64", `${cft}.app`, "Contents", "MacOS", cft),
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (e) {
      /* next */
    }
  }
  throw new Error("no browser found; set CHROME=/path/to/chrome");
}

/* ------------------------------------------------------------------ :9350 */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

/* The state the next page load should tell the companion about. The driver sets
 * it before opening each screenshot target; one shot is rendered at a time. */
let active = { state: "watch" };

function serve(res, file, type) {
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": type || MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
}

function textFrame(str) {
  const payload = Buffer.from(str);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function drainFrames(buf) {
  let off = 0;
  for (;;) {
    if (buf.length - off < 2) break;
    const b1 = buf[off + 1];
    const masked = (b1 & 0x80) === 0x80;
    let len = b1 & 0x7f;
    let p = off + 2;
    if (len === 126) {
      if (buf.length - p < 2) break;
      len = buf.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (buf.length - p < 8) break;
      len = Number(buf.readBigUInt64BE(p));
      p += 8;
    }
    if (masked) p += 4;
    if (buf.length - p < len) break;
    off = p + len;
  }
  return buf.subarray(off);
}

function startServer() {
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, ORIGIN);
    const name = url.pathname;
    if (name === "/api/config") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ console_url: "" }));
      return;
    }
    if (name === "/capture.js") {
      serve(res, path.join(STATIC, "capture.js"));
      return;
    }
    if (name === "/companion/intern.png") {
      serve(res, path.join(STATIC, "intern.png"));
      return;
    }
    if (name === "/companion/teacher.png") {
      serve(res, path.join(STATIC, "teacher.png"));
      return;
    }
    const rel = name === "/" ? "shot.html" : name.replace(/^\/+/, "");
    const file = path.join(__dirname, rel);
    if (!file.startsWith(__dirname)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    serve(res, file);
  });

  srv.on("upgrade", (req, socket) => {
    if (!req.url || !req.url.startsWith("/ws/capture")) {
      socket.destroy();
      return;
    }
    const key = req.headers["sec-websocket-key"] || "";
    const accept = crypto
      .createHash("sha1")
      .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    const send = (obj) => {
      try {
        socket.write(textFrame(JSON.stringify(obj)));
      } catch (e) {
        /* tab closed */
      }
    };

    const state = active.state;
    send({ type: "session", session: "store-" + state, mode: "capture" });
    if (state === "ask") {
      setTimeout(() => send({
        type: "ask",
        inquiry: {
          id: "q-store-1",
          status: "live",
          phase: "live",
          text: "Claims over 3,600 without a receipt \u2014 manager review or reject?",
        },
      }), 250);
    } else if (state === "learned") {
      setTimeout(() => send({
        type: "learned",
        metrics: { rules_learned: 3, rules_confirmed: 2, questions_live: 0 },
        added: [{ title: "Equipment over \u20ac3,600 net is capex" }],
        retro: [{ case_id: "inv-4471" }],
        receipt: { before: { value: "\u20ac3,600" }, after: { value: "\u20ac4,069" } },
      }), 250);
    } else if (state === "intervene") {
      setTimeout(() => send({
        type: "intervene",
        intervention: {
          say: "Hold on \u2014 this one needs an asset number before it is booked.",
          violation: { quote: { text: "No asset number, no capex booking." } },
        },
      }), 250);
    }

    let buf = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buf = drainFrames(Buffer.concat([buf, chunk]));
    });
    socket.on("error", () => {});
  });

  return new Promise((resolve) => srv.listen(HTTP_PORT, () => resolve(srv)));
}

/* -------------------------------------------------------------------- CDP */
class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve());
      this.ws.addEventListener("error", () => reject(new Error("CDP socket failed")));
    });
    this.ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
      this.ws.send(JSON.stringify(payload));
    });
  }
  close() {
    try {
      this.ws.close();
    } catch (e) {
      /* ignore */
    }
  }
}

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function waitFor(fn, tries = 100, ms = 100) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const v = await fn();
      if (v) return v;
      last = v;
    } catch (e) {
      last = e;
    }
    await delay(ms);
  }
  return last;
}

/* The shadow-DOM probe: what the companion is showing right now. */
const PROBE = `(function () {
  var hosts = Array.prototype.slice.call(document.body.children).filter(function (el) {
    return el.shadowRoot && el.shadowRoot.getElementById("kid");
  });
  if (!hosts.length) return JSON.stringify({ capture: !!window.__shadowCapture, mounted: false });
  var r = hosts[0].shadowRoot;
  var cap = r.getElementById("cap");
  var toast = r.getElementById("toast");
  var cards = r.getElementById("cards");
  return JSON.stringify({
    capture: true, mounted: true,
    ask: cap ? cap.classList.contains("show") : false,
    askText: r.getElementById("cap-t") ? r.getElementById("cap-t").textContent : "",
    toast: toast ? toast.classList.contains("show") : false,
    cardText: cards ? cards.textContent.replace(/\\s+/g, " ").trim() : ""
  });
})()`;

const SHOTS = [
  { file: "screenshot-1-watching.png", state: "watch", url: "/shot.html?state=watch",
    ready: (s) => s.mounted },
  { file: "screenshot-2-one-question.png", state: "ask", url: "/shot.html?state=ask",
    ready: (s) => s.ask && s.askText.length > 0 },
  { file: "screenshot-3-stopped.png", state: "intervene", url: "/shot.html?state=intervene",
    ready: (s) => s.cardText.indexOf("Mira stepped in") >= 0 },
];

const ART = [
  { file: "promo-440x280.png", url: "/promo.html", width: 440, height: 280, transparent: false },
  { file: "icon16.png", url: "/icon.html", width: 16, height: 16, transparent: true },
  { file: "icon32.png", url: "/icon.html", width: 32, height: 32, transparent: true },
  { file: "icon48.png", url: "/icon.html", width: 48, height: 48, transparent: true },
  { file: "icon128.png", url: "/icon.html", width: 128, height: 128, transparent: true },
];

/* ------------------------------------------------------------------- main */
async function main() {
  fs.mkdirSync(STORE, { recursive: true });
  const srv = await startServer();
  const CHROME = findBrowser();
  console.log(`browser: ${CHROME}`);

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tacet-store-"));
  const logPath = path.join(os.tmpdir(), "tacet-store-chrome.log");
  const log = fs.openSync(logPath, "w");

  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${CDP_PORT}`,
      "--window-size=1280,800",
      "about:blank",
    ],
    { stdio: ["ignore", log, log] }
  );

  let cdp = null;
  try {
    const version = await waitFor(() => getJson(`http://127.0.0.1:${CDP_PORT}/json/version`), 100, 100);
    if (!version || !version.webSocketDebuggerUrl) throw new Error(`CDP did not come up; see ${logPath}`);
    cdp = new CDP(version.webSocketDebuggerUrl);
    await cdp.ready;

    const render = async ({ file, url, state, ready, width = 1280, height = 800, transparent = false }) => {
      if (state) active.state = state;
      const target = await cdp.send("Target.createTarget", { url: "about:blank" });
      const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
      const session = attached.sessionId;
      try {
        await cdp.send("Page.enable", {}, session);
        await cdp.send("Runtime.enable", {}, session);
        await cdp.send(
          "Emulation.setDeviceMetricsOverride",
          { width, height, deviceScaleFactor: 1, mobile: false },
          session
        );
        if (transparent) {
          await cdp.send(
            "Emulation.setDefaultBackgroundColorOverride",
            { color: { r: 0, g: 0, b: 0, a: 0 } },
            session
          );
        }
        await cdp.send("Page.navigate", { url: ORIGIN + url }, session);

        if (ready) {
          let ok = false;
          for (let i = 0; i < 120; i++) {
            const r = await cdp.send("Runtime.evaluate", { expression: PROBE, returnByValue: true }, session);
            let st = {};
            try {
              st = JSON.parse((r.result && r.result.value) || "{}");
            } catch (e) {
              st = {};
            }
            if (ready(st)) {
              ok = true;
              break;
            }
            await delay(100);
          }
          if (!ok) throw new Error(`${file}: companion never reached the expected state`);
          await delay(400); // let fonts/rules settle
        } else {
          await delay(900);
        }

        const shot = await cdp.send(
          "Page.captureScreenshot",
          { format: "png", fromSurface: true, captureBeyondViewport: false },
          session
        );
        const out = path.join(STORE, file);
        fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
        console.log(`wrote ${path.relative(REPO, out)}`);
      } finally {
        await cdp.send("Target.closeTarget", { targetId: target.targetId }).catch(() => {});
      }
    };

    for (const shot of SHOTS) await render(shot);
    for (const art of ART) await render(art);
  } catch (e) {
    console.error("render error:", e && e.message ? e.message : e);
    if (fs.existsSync(logPath)) {
      console.error("chrome.log tail:\n" + fs.readFileSync(logPath, "utf8").split("\n").slice(-20).join("\n"));
    }
    process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    chrome.kill("SIGKILL");
    srv.close();
    fs.closeSync(log);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch (e) {
      /* best effort */
    }
  }
}

main();
