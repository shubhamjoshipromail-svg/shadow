/* Minimal CDP helpers shared by the end-to-end flows (launch Chrome with the unpacked extension, drive pages). */
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import crypto from "node:crypto";
import { spawn } from "node:child_process"; import { fileURLToPath } from "node:url";
export const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, ".."); export const OUT = path.join(__dirname, "out");
export const delay = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(fn, tries = 100, ms = 100) { let last; for (let i = 0; i < tries; i++) { try { const v = await fn(); if (v) return v; last = v; } catch (e) { last = e; } await delay(ms); } return last; }
export function findBrowser() {
  const cft = "Google Chrome for Testing";
  for (const p of [process.env.CHROME, `/tmp/tacet-cft/chrome-mac-arm64/${cft}.app/Contents/MacOS/${cft}`, path.join(ROOT, ".cache", "chrome-mac-arm64", `${cft}.app`, "Contents", "MacOS", cft)].filter(Boolean))
    if (fs.existsSync(p)) return p;
  throw new Error("no Chrome for Testing; run: CHROME=\"$(bash extension/test/get-chrome.sh)\"");
}
export function extensionIdFromPath(dir) { const h = crypto.createHash("sha256").update(dir).digest(); let id = ""; for (let i = 0; i < 16; i++) id += String.fromCharCode(97 + (h[i] >> 4)) + String.fromCharCode(97 + (h[i] & 15)); return id; }
export class CDP {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.pending = new Map();
    this.ready = new Promise((res, rej) => { this.ws.addEventListener("open", () => res()); this.ws.addEventListener("error", () => rej(new Error("CDP socket failed"))); });
    this.ws.addEventListener("message", (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } }); }
  send(method, params = {}, sessionId) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params })); }); }
  close() { try { this.ws.close(); } catch (e) {} }
}
export async function launch({ port = 9334, size = "1280,860" } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tacet-ext-"));
  const log = fs.openSync(path.join(OUT, "chrome-flow.log"), "w");
  const chrome = spawn(findBrowser(), ["--no-sandbox", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-sync",
    `--user-data-dir=${profile}`, `--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`, `--remote-debugging-port=${port}`, `--window-size=${size}`, "about:blank"], { stdio: ["ignore", log, log] });
  const version = await waitFor(() => fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()), 100, 100);
  const cdp = new CDP(version.webSocketDebuggerUrl); await cdp.ready;
  const cleanup = () => { cdp.close(); chrome.kill("SIGKILL"); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  return { cdp, chrome, profile, cleanup, extId: extensionIdFromPath(fs.realpathSync(ROOT)) };
}
export async function attach(cdp, targetId) { const a = await cdp.send("Target.attachToTarget", { targetId, flatten: true }); await cdp.send("Runtime.enable", {}, a.sessionId); await cdp.send("Page.enable", {}, a.sessionId).catch(() => {}); return a.sessionId; }
export async function evalIn(cdp, session, expression) { const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, session); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
export async function shot(cdp, session, name) { const s = await cdp.send("Page.captureScreenshot", { format: "png" }, session); fs.writeFileSync(path.join(OUT, name), Buffer.from(s.data, "base64")); return name; }
/* A real mouse click at the centre of the element a JS expression returns. */
export async function realClick(cdp, session, elExpr) {
  const pt = await evalIn(cdp, session, `(() => { const el = ${elExpr}; if (!el) return null; el.scrollIntoView({block:"center"}); const r = el.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
  if (!pt) throw new Error("click target missing: " + elExpr);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp.send("Input.dispatchMouseEvent", { type, x: pt.x, y: pt.y, button: "left", clickCount: 1 }, session);
}
export async function realType(cdp, session, text) { await cdp.send("Input.insertText", { text }, session); }
export async function realKey(cdp, session, key, code, vk) { for (const type of ["keyDown", "keyUp"]) await cdp.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk, text: key === "Enter" ? "\r" : undefined }, session); }
