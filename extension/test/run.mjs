#!/usr/bin/env node
/*
 * Acceptance harness for the Tacet extension (task X).
 *
 * What it does:
 *   1. serves extension/test/ on :8098 (a plain third-party form)
 *   2. runs a tiny fake Shadow Core on :8001 (HTTP + /ws/capture WebSocket)
 *   3. launches a Chromium with --load-extension, seeds the extension's settings
 *      (server URL :8001, test origin enabled), opens the test page
 *   4. asserts the companion + observer are injected, exactly once, and that the
 *      observer's events travel on the companion's own socket
 *   5. screenshots Mira to extension/test/out/mira-on-any-site.png
 *
 * Note: official Chrome (137+) ignores --load-extension, so the harness prefers an
 * unbranded Chrome for Testing or Edge when available. Point CHROME= at any Chromium
 * that still loads unpacked extensions.
 *
 * Usage: node extension/test/run.mjs     (exit code 0 = all checks passed)
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, ".."); // extension/
const REPO = path.resolve(ROOT, ".."); // repo root
const OUT = path.join(__dirname, "out");

const PORT_PAGE = 8098;
const PORT_CORE = 8001;
const CDP_PORT = 9333;
const TEST_SITE = "http://localhost"; // site = scheme + hostname (port is not part of a site)
const TEST_PAGE = `${TEST_SITE}:${PORT_PAGE}/page.html`;
const SERVER = `http://localhost:${PORT_CORE}`;

const CHROME = findBrowser();
console.log(`browser: ${CHROME}`);

/* Official Chrome 137+ ignores --load-extension; prefer a Chromium that still honours it. */
function findBrowser() {
  const cft = "Google Chrome for Testing";
  const candidates = [
    process.env.CHROME,
    `/tmp/tacet-cft/chrome-mac-arm64/${cft}.app/Contents/MacOS/${cft}`,
    path.join(ROOT, ".cache", "chrome-mac-arm64", `${cft}.app`, "Contents", "MacOS", cft),
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

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

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

function getJson(url) {
  return fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url} -> ${r.status}`);
    return r.json();
  });
}

/* Chrome derives an unpacked extension's id from the absolute path (its public key is
 * missing), so we can know it without waking the lazy MV3 service worker. */
function extensionIdFromPath(dir) {
  const h = crypto.createHash("sha256").update(dir).digest();
  let id = "";
  for (let i = 0; i < 16; i++) id += String.fromCharCode(97 + (h[i] >> 4)) + String.fromCharCode(97 + (h[i] & 15));
  return id;
}

/* ------------------------------------------------------------------ :8098 */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function startPageServer() {
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, TEST_SITE);
    const rel = url.pathname === "/" ? "page.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = path.join(__dirname, rel);
    if (!file.startsWith(__dirname)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(buf);
    });
  });
  return new Promise((resolve) => srv.listen(PORT_PAGE, () => resolve(srv)));
}

/* -------------------------------------------------------------- :8001 core */
const serverState = { connections: 0, events: [], perConnection: [] };

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

/* Returns the unconsumed tail of buf. */
function drainFrames(buf, onText) {
  let off = 0;
  for (;;) {
    if (buf.length - off < 2) break;
    const b0 = buf[off];
    const b1 = buf[off + 1];
    const opcode = b0 & 0x0f;
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
    let mask = null;
    if (masked) {
      if (buf.length - p < 4) break;
      mask = buf.subarray(p, p + 4);
      p += 4;
    }
    if (buf.length - p < len) break;
    const payload = Buffer.from(buf.subarray(p, p + len));
    if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    if (opcode === 0x1) onText(payload.toString("utf8"));
    off = p + len;
  }
  return buf.subarray(off);
}

function startCoreServer() {
  const srv = http.createServer((req, res) => {
    if (req.url === "/api/config") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ console_url: "", config: {} }));
      return;
    }
    if (req.url === "/companion/intern.png") {
      fs.readFile(path.join(REPO, "backend/shadow/static/intern.png"), (err, buf) => {
        if (err) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { "content-type": "image/png" });
        res.end(buf);
      });
      return;
    }
    if (req.url === "/capture.js") {
      fs.readFile(path.join(REPO, "backend/shadow/static/capture.js"), (err, buf) => {
        if (err) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end(buf);
      });
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end("{}");
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

    serverState.connections += 1;
    const conn = [];
    serverState.perConnection.push(conn);

    socket.write(textFrame(JSON.stringify({ type: "session", session: "ext-test", mode: "capture" })));
    socket.write(
      textFrame(JSON.stringify({ type: "prediction", field: "route", value: "manager review", confidence: 0.62 }))
    );
    const askTimer = setTimeout(() => {
      socket.write(
        textFrame(
          JSON.stringify({
            type: "ask",
            inquiry: {
              id: "q1",
              status: "live",
              phase: "live",
              text: "Claims over 3,600 without a receipt \u2014 manager review or reject?",
            },
          })
        )
      );
    }, 350);

    let buf = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      buf = drainFrames(buf, (text) => {
        let msg;
        try {
          msg = JSON.parse(text);
        } catch (e) {
          return;
        }
        serverState.events.push(msg);
        conn.push(msg.type);
      });
    });
    socket.on("close", () => clearTimeout(askTimer));
    socket.on("error", () => {});
  });

  return new Promise((resolve) => srv.listen(PORT_CORE, () => resolve(srv)));
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

/* ------------------------------------------------------------------- main */
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const pageSrv = await startPageServer();
  const coreSrv = await startCoreServer();

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tacet-ext-"));
  const logPath = path.join(OUT, "chrome.log");
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
      `--user-data-dir=${profile}`,
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`,
      `--remote-debugging-port=${CDP_PORT}`,
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: ["ignore", log, log] }
  );

  let cdp = null;
  let exitCode = 1;

  try {
    const version = await waitFor(() => getJson(`http://127.0.0.1:${CDP_PORT}/json/version`), 100, 100);
    if (!version || !version.webSocketDebuggerUrl) {
      throw new Error(`Chrome DevTools endpoint did not come up; see ${logPath}`);
    }
    cdp = new CDP(version.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send("Target.setDiscoverTargets", { discover: true });

    // The id is derived from the unpacked path. (Chrome ships other extensions with a
    // background.js service worker, so match ours by id, not by filename.)
    const extId = extensionIdFromPath(fs.realpathSync(ROOT));

    // Open the plain third-party page first: the navigation wakes the lazy MV3 worker.
    const page = await cdp.send("Target.createTarget", { url: TEST_PAGE });
    const pageAttach = await cdp.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
    const pageSession = pageAttach.sessionId;
    await cdp.send("Runtime.enable", {}, pageSession);
    await cdp.send("Page.enable", {}, pageSession);

    // Seed settings from inside the extension's own service worker (chrome.storage lives there).
    const seedExpression = `chrome.storage.local.set(${JSON.stringify({
      serverUrl: SERVER,
      enabledOrigins: [TEST_SITE],
    })}).then(() => "ok")`;
    const swUrl = `chrome-extension://${extId}/background.js`;
    const sw = await waitFor(async () => {
      const { targetInfos } = await cdp.send("Target.getTargets");
      return targetInfos.find(
        (t) =>
          (t.type === "service_worker" || t.type === "background_page") &&
          (t.url === swUrl || t.url.startsWith(`chrome-extension://${extId}/`))
      );
    }, 100, 100);
    let seeded = false;
    if (sw) {
      const swAttach = await cdp.send("Target.attachToTarget", { targetId: sw.targetId, flatten: true });
      const swSession = swAttach.sessionId;
      await cdp.send("Runtime.enable", {}, swSession);
      seeded = await waitFor(async () => {
        const r = await cdp.send(
          "Runtime.evaluate",
          { expression: seedExpression, awaitPromise: true, returnByValue: true },
          swSession
        );
        return r.result && r.result.value === "ok";
      }, 30, 100);
    }
    check("extension loaded", !!sw, sw ? swUrl : "(service worker did not start)");
    check("settings seeded", seeded === true, `server=${SERVER} site=${TEST_SITE}`);

    // Re-navigate so the worker, now seeing the setting, injects the companion + observer.
    await cdp.send("Page.navigate", { url: TEST_PAGE }, pageSession);

    const probe = `JSON.stringify({
      capture: !!window.__shadowCapture,
      observe: !!window.shadowObserve,
      name: window.SHADOW_NAME || null,
      api: window.SHADOW_API || null,
      hosts: Array.from(document.body.children).filter((el) => el.shadowRoot && el.shadowRoot.getElementById("kid")).length,
      ask: (() => { const h = Array.from(document.body.children).find((el) => el.shadowRoot && el.shadowRoot.getElementById("cap-t")); return h ? h.shadowRoot.getElementById("cap-t").textContent.trim() : ""; })()
    })`;

    let state = {};
    for (let i = 0; i < 100; i++) {
      const r = await cdp.send("Runtime.evaluate", { expression: probe, returnByValue: true }, pageSession);
      try {
        state = JSON.parse(r.result.value || "{}");
      } catch (e) {
        state = {};
      }
      if (state.capture && state.observe && state.hosts >= 1) break;
      await delay(150);
    }

    const apiOk = state.api === SERVER;
    check("window.SHADOW_API points at :8001", apiOk, String(state.api));
    check("window.SHADOW_NAME is Tacet", state.name === "Tacet", String(state.name));
    check("companion injected (window.__shadowCapture)", !!state.capture);
    check("observer installed (window.shadowObserve)", !!state.observe);
    check("Mira mounted exactly once", state.hosts === 1, `hosts=${state.hosts}`);
    check("bridge reused the companion socket", serverState.connections === 1, `connections=${serverState.connections}`);

    // Exercise the plain form; observe.js should emit field_changed + action through the bridge.
    await cdp.send(
      "Runtime.evaluate",
      {
        expression: `(function () {
          var amount = document.getElementById("amount");
          amount.value = "4120";
          amount.dispatchEvent(new Event("change", { bubbles: true }));
          var receipt = document.getElementById("receipt");
          receipt.checked = true;
          receipt.dispatchEvent(new Event("change", { bubbles: true }));
          document.getElementById("approve").click();
          return true;
        })()`,
        returnByValue: true,
      },
      pageSession
    );
    await delay(800);

    const types = new Set(serverState.events.map((e) => e.type));
    const amountEvent = serverState.events.find((e) => e.type === "field_changed" && e.field === "amount");
    check("observe event reached :8001", types.has("observe"));
    check("field_changed reached :8001", !!amountEvent, amountEvent ? `${amountEvent.field}=${amountEvent.after}` : "");
    check("action reached :8001", types.has("action"));
    check(
      "free text stays short on the wire",
      serverState.events.every((e) => typeof e.after !== "string" || e.after.length <= 40)
    );

    // An SPA navigation must re-announce the page (observe.js patches history)…
    const beforeRoutes = serverState.events.filter((e) => e.type === "observe").length;
    await cdp.send(
      "Runtime.evaluate",
      { expression: `history.pushState({}, "", "/page.html?step=2"); true`, returnByValue: true },
      pageSession
    );
    await delay(700);
    const afterRoutes = serverState.events.filter((e) => e.type === "observe").length;
    check("SPA navigation re-announced", afterRoutes > beforeRoutes, `${beforeRoutes} -> ${afterRoutes}`);

    // …and a reload must re-inject without double-mounting.
    await cdp.send("Page.reload", {}, pageSession);
    let reloaded = {};
    for (let i = 0; i < 100; i++) {
      const r = await cdp.send("Runtime.evaluate", { expression: probe, returnByValue: true }, pageSession);
      try {
        reloaded = JSON.parse(r.result.value || "{}");
      } catch (e) {
        reloaded = {};
      }
      if (reloaded.capture && reloaded.hosts >= 1) break;
      await delay(150);
    }
    await delay(600); // let the fake core re-send the ask card
    const after = await cdp.send("Runtime.evaluate", { expression: probe, returnByValue: true }, pageSession);
    try {
      reloaded = JSON.parse(after.result.value || "{}");
    } catch (e) {
      /* keep the previous reading */
    }
    check("re-injected after reload", !!reloaded.capture);
    check("never double-injects after reload", reloaded.hosts === 1, `hosts=${reloaded.hosts}`);
    check("Mira asks one question", !!reloaded.ask && /3,600/.test(reloaded.ask), reloaded.ask || "(none)");

    // Screenshot Mira on the third-party page.
    const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, pageSession);
    const shotPath = path.join(OUT, "mira-on-any-site.png");
    fs.writeFileSync(shotPath, Buffer.from(shot.data, "base64"));
    check("screenshot written", fs.existsSync(shotPath), path.relative(REPO, shotPath));

    // The popup itself, at 320px. Extension pages are blocked to Target.createTarget, but a
    // browser-initiated Page.navigate is allowed.
    const popupTab = await cdp.send("Target.createTarget", { url: "about:blank" });
    const popupAttach = await cdp.send("Target.attachToTarget", { targetId: popupTab.targetId, flatten: true });
    const popupSession = popupAttach.sessionId;
    await cdp.send("Page.enable", {}, popupSession);
    await cdp.send("Runtime.enable", {}, popupSession);
    await cdp.send("Page.navigate", { url: `chrome-extension://${extId}/popup/popup.html` }, popupSession);
    let popupState = {};
    const popupProbe = `JSON.stringify({
      title: document.title,
      toggle: !!document.getElementById("toggle"),
      server: document.getElementById("server") ? document.getElementById("server").value : null,
      site: document.getElementById("site") ? document.getElementById("site").textContent : null
    })`;
    for (let i = 0; i < 40; i++) {
      const r = await cdp.send("Runtime.evaluate", { expression: popupProbe, returnByValue: true }, popupSession);
      try {
        popupState = JSON.parse(r.result.value || "{}");
      } catch (e) {
        popupState = {};
      }
      if (popupState.toggle && popupState.server) break;
      await delay(150);
    }
    check("popup renders at 320px", !!popupState.toggle && popupState.title === "Tacet");
    check("popup shows the shared server URL", popupState.server === SERVER, String(popupState.server));
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 320, height: 600, deviceScaleFactor: 2, mobile: false },
      popupSession
    );
    await delay(250);
    const popupShot = await cdp.send(
      "Page.captureScreenshot",
      { format: "png", captureBeyondViewport: true },
      popupSession
    );
    const popupPath = path.join(OUT, "popup.png");
    fs.writeFileSync(popupPath, Buffer.from(popupShot.data, "base64"));
    check("popup screenshot written", fs.existsSync(popupPath), path.relative(REPO, popupPath));

    // A page that already ships capture.js (our ERP) must not be double-injected or re-wired.
    const connsBefore = serverState.connections;
    const ownTab = await cdp.send("Target.createTarget", { url: `${TEST_SITE}:${PORT_PAGE}/page-own-capture.html` });
    const ownAttach = await cdp.send("Target.attachToTarget", { targetId: ownTab.targetId, flatten: true });
    const ownSession = ownAttach.sessionId;
    await cdp.send("Runtime.enable", {}, ownSession);
    let own = {};
    for (let i = 0; i < 60; i++) {
      const r = await cdp.send(
        "Runtime.evaluate",
        {
          expression: `JSON.stringify({ capture: !!window.__shadowCapture, hadCapture: !!window.__shadowHadCapture, hosts: Array.from(document.body.children).filter((el) => el.shadowRoot && el.shadowRoot.getElementById("kid")).length })`,
          returnByValue: true,
        },
        ownSession
      );
      try {
        own = JSON.parse(r.result.value || "{}");
      } catch (e) {
        own = {};
      }
      if (own.capture && own.hosts >= 1) break;
      await delay(150);
    }
    check("page with its own companion is left alone", own.capture === true && own.hadCapture === true && own.hosts === 1, JSON.stringify(own));
    check(
      "no second socket on a page with its own companion",
      serverState.connections === connsBefore + 1,
      `${connsBefore} -> ${serverState.connections}`
    );

    const failed = checks.filter((c) => !c.ok);
    exitCode = failed.length === 0 ? 0 : 1;
    console.log(
      `\n${checks.length - failed.length}/${checks.length} checks passed` +
        (failed.length ? `: ${failed.map((f) => f.name).join(", ")}` : "")
    );
  } catch (e) {
    console.error("harness error:", e && e.message ? e.message : e);
    try {
      if (cdp) {
        const { targetInfos } = await cdp.send("Target.getTargets");
        console.error("targets:", targetInfos.map((t) => `${t.type}:${t.url}`).join("\n  "));
      }
    } catch (e2) {
      /* ignore */
    }
    if (fs.existsSync(logPath)) console.error("chrome.log tail:\n" + fs.readFileSync(logPath, "utf8").split("\n").slice(-20).join("\n"));
    exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    chrome.kill("SIGKILL");
    pageSrv.close();
    coreSrv.close();
    fs.closeSync(log);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch (e) {
      /* best effort */
    }
  }
  process.exit(exitCode);
}

main();
