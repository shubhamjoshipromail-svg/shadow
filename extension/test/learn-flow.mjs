#!/usr/bin/env node
/* End-to-end: the real extension on a workflow Tacet has never seen (fixtures/returns, a returns desk).
 * Needs: a Core on CORE (default http://localhost:8002), the fixture served on :8091
 *   node extension/test/fixtures/returns/serve.mjs 8091
 *   node extension/test/learn-flow.mjs
 * Flow: popup (server URL, per-site switch) -> Learn this task -> 3 demos -> Done showing -> expert breaks the
 * learned pattern -> Mira asks at a pause -> typed answer -> rule compiles -> prediction changes -> revisit recognised.
 */
import { launch, attach, evalIn, shot, realClick, realType, realKey, delay, waitFor } from "./cdp-lib.mjs";
const CORE = process.env.CORE || "http://localhost:8002";
const SITE = "http://localhost:8091/";
const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  (" + d + ")" : ""}`); };
const CAP = `([...document.body.children].find(e => e.getAttribute && e.getAttribute("data-shadow-ui") === "companion"))`;
const R = `${CAP}.shadowRoot`;
const { cdp, cleanup, extId } = await launch();
let code = 1;
try {
  const page = await cdp.send("Target.createTarget", { url: SITE + "?i=1" });
  const P = await attach(cdp, page.targetId);
  const sw = await waitFor(async () => (await cdp.send("Target.getTargets")).targetInfos.find((t) => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${extId}/`)), 100, 100);
  check("extension loaded", !!sw);
  const SW = await attach(cdp, sw.targetId);
  const tabId = await waitFor(() => evalIn(cdp, SW, `chrome.tabs.query({url: "${SITE}*"}).then(t => t[0] && t[0].id)`), 50, 100);

  // --- popup, as a user: it reads the active tab, so show it the returns tab
  const pop = await cdp.send("Target.createTarget", { url: "about:blank" });
  const PP = await attach(cdp, pop.targetId);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `chrome.tabs.query = async () => [{ id: ${tabId}, url: "${SITE}?i=1" }];` }, PP);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 520, deviceScaleFactor: 2, mobile: false }, PP);
  await cdp.send("Page.navigate", { url: `chrome-extension://${extId}/popup/popup.html` }, PP);
  await waitFor(() => evalIn(cdp, PP, `!!document.getElementById("toggle") && document.getElementById("site").textContent.includes("localhost")`), 60, 100);
  await evalIn(cdp, PP, `(() => { const s = document.getElementById("server"); s.value = ""; s.focus(); })()`);
  await realType(cdp, PP, CORE);
  await realClick(cdp, PP, `document.getElementById("save")`);
  await delay(300);
  await realClick(cdp, PP, `document.getElementById("toggle")`);
  await waitFor(() => evalIn(cdp, PP, `document.getElementById("toggle").getAttribute("aria-checked") === "true"`), 40, 100);
  await shot(cdp, PP, "ext-popup-on.png");
  const stored = await evalIn(cdp, SW, `chrome.storage.local.get(["serverUrl","enabledOrigins"])`);
  check("popup saved the server URL and enabled the site", stored.serverUrl === CORE && stored.enabledOrigins.includes("http://localhost"), JSON.stringify(stored));

  await cdp.send("Target.closeTarget", { targetId: pop.targetId });
  await cdp.send("Page.bringToFront", {}, P);
  await cdp.send("Page.navigate", { url: SITE + "?i=1" }, P);
  const mounted = await waitFor(() => evalIn(cdp, P, `!!${CAP} && window.SHADOW_API`), 100, 150);
  check("Mira injected on the returns desk", mounted === CORE, String(mounted));
  const click = (id) => realClick(cdp, P, `${R}.getElementById("${id}")`);
  const txt = (id) => evalIn(cdp, P, `${R}.getElementById("${id}").textContent.trim()`);
  const stage = () => evalIn(cdp, P, `(${R}.getElementById("learn-count")||{}).textContent + " | " + (${R}.getElementById("learn-state")||{}).textContent`);

  const openPanel = async () => {
    for (let k = 0; k < 3; k++) {
      if (await evalIn(cdp, P, `/\\bopen\\b/.test(${R}.getElementById("w").className)`)) return true;
      const pt = await evalIn(cdp, P, `(() => { const r = ${R}.getElementById("kid").getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y }, P); await delay(1500);
    }
    return false;
  };
  check("companion opens from the portrait", await openPanel());
  await click("b-learn");
  const goalVisible = await waitFor(() => evalIn(cdp, P, `!${R}.getElementById("learn-form").hidden`), 60, 150);
  check("page recognised as new -> goal form", !!goalVisible);
  await shot(cdp, P, "ext-learn-goal.png");
  await evalIn(cdp, P, `${R}.getElementById("learn-goal").focus()`);
  await realType(cdp, P, "Decide the resolution for each customer return request");
  await realKey(cdp, P, "Enter", "Enter", 13);
  await waitFor(() => evalIn(cdp, P, `!${R}.getElementById("learn-watch").hidden`), 40, 100);
  check("watching", /Watching/.test(await stage()), await stage());

  const decide = async (value) => {
    await cdp.send("Page.bringToFront", {}, P);
    await evalIn(cdp, P, `(() => { const s = document.getElementById("resolution"); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event("input", {bubbles:true})); s.dispatchEvent(new Event("change", {bubbles:true})); })()`);
    await delay(250);
    await realClick(cdp, P, `document.getElementById("save")`);
  };
  const onItem = (n) => waitFor(() => evalIn(cdp, P, `location.search === "?i=${n}" && !!${CAP} && !!window.__shadowObserverConnected`), 120, 150);
  const demos = ["Full refund", "Full refund", "Store credit"];
  for (let n = 1; n <= 3; n++) {
    await decide(demos[n - 1]);
    await onItem(n + 1); await delay(900);
    if (+process.env.STOPAFTER === n) throw new Error('stopped for debugging');
    console.log(`  demo ${n} -> ${await stage().catch(() => "(companion reloading)")}`);
  }
  await openPanel(); await delay(300);
  const cnt = await stage();
  check("3 demonstrations saved across page loads", /3 demonstrations/.test(cnt), cnt);
  await shot(cdp, P, "ext-learn-3demos.png");
  await click("learn-done");
  await waitFor(() => evalIn(cdp, P, `!!sessionStorage.getItem("shadow.session")`), 80, 250);
  const SID = await evalIn(cdp, P, `sessionStorage.getItem("shadow.session")`);
  check("Done showing opened a live capture session", !!SID, String(SID));
  await delay(1200);
  await shot(cdp, P, "ext-after-done.png");
  console.log("  panel:", (await evalIn(cdp, P, `${R}.getElementById("hc").innerText`)).replace(/\n/g, " / "));
  const api = (p) => fetch(CORE + p).then((r) => r.json());
  const sess = await api("/api/sessions/" + SID);
  console.log("  session keys:", Object.keys(sess).join(","));
  // Expert phase. The hidden policy the demos never showed: anything delivered more than 30 days ago is rejected;
  // opened/used "changed mind" over EUR 250 goes to a supervisor. Mira, cold, guesses; where she is wrong she should ask.
  const truth = { 4: "Escalate to supervisor", 5: "Escalate to supervisor", 6: "Reject", 7: "Escalate to supervisor", 8: "Full refund", 9: "Reject" };
  const predictionFor = async () => {
    const x = await api("/api/sessions/" + SID); const cur = x.current_case; const p = x.predictions[cur];
    return p ? { case: cur, value: p.fields.resolution.value, p: p.fields.resolution.p, source: p.fields.resolution.source, fired: p.fired_rules } : null;
  };
  const ui = () => evalIn(cdp, P, `JSON.stringify({ cap: ${R}.getElementById("cap-t").innerText, capShown: /show/.test(${R}.getElementById("cap").className), rules: ${R}.getElementById("m-rl").textContent, q: ${R}.getElementById("m-q").textContent, cards: ${R}.getElementById("cards").innerText })`);
  let asked = null, missed = false;
  for (let n = 4; n <= 9; n++) {
    await onItem(n); await delay(2500);
    if (!asked && n > 4 && missed) await waitFor(async () => JSON.parse(await ui()).capShown, 40, 300); // a person pauses after a surprise
    const pr = await predictionFor();
    var thisMiss = !!pr && pr.value !== truth[n];
    console.log(`  item ${n}: Mira predicts`, JSON.stringify(pr), "| expert will pick", truth[n]);
    if (n === 9) { await shot(cdp, P, "ext-item9-prediction.png"); globalThis.pred9 = pr; }
    if (!asked) {
      const u = JSON.parse(await ui());
      if (u.capShown) {
        asked = u.cap; console.log("  QUESTION:", asked);
        await openPanel().catch(() => {});
        await shot(cdp, P, "ext-question.png");
        check("Mira asked a question at a pause", true, asked);
        await evalIn(cdp, P, `${R}.getElementById("cap-in").focus()`);
        await realType(cdp, P, "Anything delivered more than 30 days ago is rejected, whatever the reason. Inside 30 days a change of mind on an opened item over 250 euros goes to the supervisor.");
        await realKey(cdp, P, "Enter", "Enter", 13);
        const learned = await waitFor(async () => { const u2 = JSON.parse(await ui()); return u2.rules !== "0" && u2.rules !== "\u2014" ? u2 : null; }, 120, 500);
        console.log("  after answer ui:", JSON.stringify(await ui()));
        const ss = await api("/api/sessions/" + SID);
        console.log("  rules:", JSON.stringify((ss.map.rules || []).map((r) => ({ id: r.id, text: r.text || r.statement || r.description, when: r.when || r.conditions })).slice(0, 4)).slice(0, 900));
        console.log("  receipts:", (ss.receipts || []).length, "metrics:", JSON.stringify(ss.metrics));
        check("answer compiled into a rule", !!learned && ((ss.map.rules || []).length > 0));
        await shot(cdp, P, "ext-rule-learned.png");
      }
    }
    await decide(truth[n]); missed = thisMiss; await delay(2000);
  }
  check("question was asked during the expert phase", !!asked);
  check("prediction for the 45-day request is Reject after the answer", globalThis.pred9 && globalThis.pred9.value === "Reject", JSON.stringify(globalThis.pred9));

  // Revisit: a brand-new tab (no pinned session) on the same page must be recognised as the same workflow.
  const tab2 = await cdp.send("Target.createTarget", { url: SITE + "?i=9" });
  const P2 = await attach(cdp, tab2.targetId);
  await cdp.send("Page.bringToFront", {}, P2);
  await waitFor(() => evalIn(cdp, P2, `!!${CAP} && !!window.__shadowObserverConnected`), 100, 150);
  const hover = async () => {
    const pt = await evalIn(cdp, P2, `(() => { const r = ${R}.getElementById("kid").getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y }, P2); await delay(1500);
  };
  await hover();
  await realClick(cdp, P2, `${R}.getElementById("b-learn")`);
  const match = await waitFor(() => evalIn(cdp, P2, `!${R}.getElementById("learn-choose").hidden && ${R}.getElementById("learn-match").textContent`), 60, 200);
  check("revisit recognised as the same workflow", /Returns desk/.test(String(match)) && /Continue/.test(String(match)), String(match));
  await shot(cdp, P2, "ext-revisit-recognised.png");
  await realClick(cdp, P2, `${R}.getElementById("learn-continue")`);
  const SID2 = await waitFor(() => evalIn(cdp, P2, `sessionStorage.getItem("shadow.session")`), 60, 250);
  const s2 = await api("/api/sessions/" + SID2);
  check("continuing opens a session on the saved Work Map", !!SID2 && (s2.map.rules || []).length > 0, `session=${SID2} rules=${(s2.map.rules || []).length} version=${s2.map.version}`);
  await delay(3000);
  const cur2 = s2.current_case; const s2b = await api("/api/sessions/" + SID2);
  const p2 = s2b.predictions[s2b.current_case];
  check("revisited page is predicted from the learned rule", p2 && p2.fields.resolution.value === "Reject", p2 ? JSON.stringify(p2.fields.resolution) : "no prediction");
  await shot(cdp, P2, "ext-revisit-continued.png");
  const h = await api("/health"); console.log("  spend:", JSON.stringify(h.spend));
  code = results.every(Boolean) ? 0 : 1;
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
} catch (e) { console.error("harness error:", e.stack || e); } finally { if (!process.env.KEEP) cleanup(); }
process.exit(code);
