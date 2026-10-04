/* Tacet capture script — loaded by the observed app (e.g. the sandbox ERP).
 *
 * Sends semantic events (what was opened, which field changed, which panel the
 * expert looked at) and activity *kinds* (typing / scrolling / pointer) to
 * Tacet. It never sends keystroke contents. It also exposes
 * window.shadow.beforeSave, the save intercept the tutor uses to step in
 * before a guardrail is broken.
 *
 * UI: an ambient "student" companion lives bottom-right inside a shadow DOM.
 * It is nearly invisible while watching and only asks for attention when it
 * has something worth saying (hand raised at a pause, a question, a lesson).
 */
(function () {
  if (window.__shadowCapture) return;
  window.__shadowCapture = true;

  var script = document.currentScript;
  var API = (window.SHADOW_API && window.SHADOW_API.indexOf("%") < 0 && window.SHADOW_API) ||
            (script ? new URL(script.src).origin : "http://localhost:8000");
  var NAME = window.SHADOW_NAME || "Mira";  // the companion's name (product: Tacet) lives here and nowhere else
  var CONSOLE = window.SHADOW_CONSOLE || "";   // notebook origin: /api/config console_url, else the API origin
  var CONFIG = null;
  var EXPERT = window.SHADOW_EXPERT || "Sabine";
  var NOVICE = window.SHADOW_NOVICE || "Lena";
  var SESSION_KEY = "shadow.session";
  function storeGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function storeSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  function storeDel(k) { try { sessionStorage.removeItem(k); } catch (e) {} }
  var qs = new URLSearchParams(location.search);
  // a pinned session survives navigation and reloads, in this order: ?shadow=<sid>, sessionStorage, else
  // unpinned (follows the latest session). Storage is best-effort: private modes may refuse it.
  var urlPin = qs.get("shadow") || null;
  var PINNED = urlPin || storeGet(SESSION_KEY) || null;
  var SID = PINNED;
  if (urlPin) storeSet(SESSION_KEY, urlPin);
  var MODE = null;
  var WORKFLOW = null, SIMULATED = false;
  var GENERIC_PAGE = !(window.shadowERP || document.querySelector("[data-shadow-case],[data-shadow-field]"));
  var LEARN_KEY = "shadow.learning", LEARN = { stage: "idle", goal: "", demos: [], current: [], match: null, error: "" };
  try {
    var savedLearn = JSON.parse(storeGet(LEARN_KEY) || "null");
    if (savedLearn && !SID) {
      LEARN = savedLearn;
      if (["matching", "creating", "continuing"].indexOf(LEARN.stage) >= 0) LEARN.stage = LEARN.demos.length ? "stopped" : "idle";
    }
  } catch (e) {}
  var ws = null, outbox = [], lastCase = null;

  // companion state
  var F = { off: false, hand: false, handId: null, asking: false, askText: "", thinking: false, learned: false,
            busy: false, offline: true, guess: false, open: false };
  var M = { rules_learned: null, rules_confirmed: null, questions_live: null };
  var T = {};
  function later(name, ms, fn) { clearTimeout(T[name]); T[name] = setTimeout(fn, ms); }

  function connect() {
    try { ws = new WebSocket(API.replace(/^http/, "ws") + "/ws/capture" + (PINNED ? "?session=" + PINNED : (GENERIC_PAGE ? "?follow_latest=false" : ""))); }
    catch (e) { F.offline = true; render(); setTimeout(connect, 3000); return; }
    ws.onopen = function () {
      F.offline = false; render();
      outbox.splice(0).forEach(function (m) { ws.send(m); });
      send({ type: "hello" });
      if (SID && GENERIC_PAGE && window.shadowObserve) sendSnapshot();
    };
    ws.onmessage = function (e) {
      var m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      try { onServer(m); } catch (err) { /* never let UI break capture */ }
      try { afterServer(m); } catch (err) { /* never let persistence break capture */ }
    };
    ws.onclose = function () { F.offline = true; render(); setTimeout(connect, 1500); };
  }

  function send(evt) {
    evt.client_ts = Date.now() / 1000;
    if (PINNED) evt.session = PINNED;
    var s = JSON.stringify(evt);
    if (ws && ws.readyState === 1) ws.send(s);
    else { outbox.push(s); if (outbox.length > 300) outbox.shift(); }
  }

  function throttle(fn, ms) {
    var last = 0;
    return function () { var n = Date.now(); if (n - last > ms) { last = n; fn.apply(null, arguments); } };
  }

  function state() {
    try { return (window.shadowERP && window.shadowERP.getState && window.shadowERP.getState()) || {}; }
    catch (e) { return {}; }
  }

  // case detection: poll the app's state accessor, fall back to the DOM attribute
  setInterval(function () {
    var st = state();
    var cid = (st.case && st.case.id) || null;
    if (!cid) {
      var root = document.querySelector('[data-shadow-entity^="invoice:"]:not([data-shadow-action])');
      if (root) cid = root.getAttribute("data-shadow-entity").split(":")[1];
    }
    if (cid && cid !== lastCase) { lastCase = cid; F.guess = false; render(); send({ type: "case_opened", case_id: cid }); }
    if (!cid) lastCase = null;
  }, 400);

  var lastValues = {};
  function onField(e) {
    var el = e.target && e.target.closest && e.target.closest("[data-shadow-field]");
    if (!el) return;
    var field = el.getAttribute("data-shadow-field");
    var value = el.value != null ? el.value : el.textContent;
    var key = lastCase + ":" + field;
    if (lastValues[key] === value) return;
    send({ type: "field_changed", case_id: lastCase, field: field, before: lastValues[key] || null, after: value });
    lastValues[key] = value;
  }
  document.addEventListener("change", onField, true);
  document.addEventListener("blur", onField, true);

  function busy() { if (!F.busy) { F.busy = true; render(); } later("busy", 1600, function () { F.busy = false; render(); }); }
  document.addEventListener("keydown", throttle(function () { send({ type: "input", kind: "key" }); }, 350), true);
  document.addEventListener("keydown", function (e) {
    if (e.altKey && e.shiftKey && e.code === "KeyS") { e.preventDefault(); toggleRecord(); return; }
    busy();
  }, true);
  document.addEventListener("scroll", throttle(function () { send({ type: "input", kind: "scroll" }); busy(); }, 500), true);
  document.addEventListener("wheel", throttle(function () { send({ type: "input", kind: "scroll" }); busy(); }, 500), true);
  document.addEventListener("mousemove", throttle(function () { send({ type: "input", kind: "mouse" }); }, 1200), true);

  // personal data stays on screen but is blurred before any frame leaves the browser
  setInterval(function () {
    var rects = [];
    document.querySelectorAll('[data-shadow-pii="true"]').forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.width && r.height && r.bottom > 0 && r.top < innerHeight) rects.push([r.left, r.top, r.width, r.height]);
    });
    var key = JSON.stringify(rects);
    if (key !== window.__shadowPii) { window.__shadowPii = key; send({ type: "pii_rects", rects: rects, vw: innerWidth, vh: innerHeight }); }
  }, 800);

  document.addEventListener("click", function (e) {
    var p = e.target.closest && e.target.closest("[data-shadow-panel]");
    if (p) send({ type: "panel_opened", case_id: lastCase, panel: p.getAttribute("data-shadow-panel") });
  }, true);

  // ------------------------------------------------------------- save intercept
  window.shadow = {
    beforeSave: function (req) {
      return fetch(API + "/api/capture/before_save", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: PINNED, action: req.action, case_id: req.caseId || lastCase,
                               booking: req.booking || {}, reason: req.reason, approver: req.approver })
      }).then(function (r) { return r.json(); }).then(function (v) {
        if (!v.allow && v.intervention) {
          overlay(v.intervention);
          if (v.intervention.field && window.shadowERP && window.shadowERP.highlight) {
            window.shadowERP.highlight(v.intervention.field === "action" ? "cost_center" : v.intervention.field);
          }
        }
        return v;
      }).catch(function () {
        if (MODE === "tutor") {
          var iv = { say: "Mira can\u2019t reach Tacet right now \u2014 try saving again in a moment." };
          overlay(iv);
          return { allow: false, intervention: iv };
        }
        return { allow: true };
      });
    }
  };

  // ------------------------------------------------------------- server messages -> companion state
  function onServer(m) {
    switch (m.type) {
      case "session": SID = m.session; MODE = m.mode; break;
      case "mode": MODE = m.mode; break;
      case "record":
        F.off = !!m.off_record;
        if (F.off) { F.hand = false; F.asking = false; F.thinking = false; }
        break;
      case "highlight":
        if (window.shadowERP && window.shadowERP.highlight) window.shadowERP.highlight(m.field);
        return;
      case "intervene": F.asking = false; overlay(m.intervention); break;  // the stop replaces the coaching card
      case "activity":
        if (m.activity && m.activity.paused === false) busy();
        break;
      case "episode":
        takeMetrics(m.metrics);
        if ((m.gaps || []).some(function (g) { return g && g.type === "structural"; })) think();
        break;
      case "hypotheses": think(); break;
      case "inquiry": {
        var q = m.inquiry || {};
        if (q.status === "queued" && q.phase === "live" && !F.off) { F.hand = true; F.handId = q.id; }
        else if (F.hand && q.id && q.id === F.handId) { F.hand = false; }
        break;
      }
      case "ask": {
        var a = m.inquiry || {};
        F.hand = false; F.asking = true; F.askText = a.text || "";
        later("ask", 120000, function () { F.asking = false; render(); });
        break;
      }
      case "learned": {
        takeMetrics(m.metrics);
        F.asking = false; clearTimeout(T.ask);
        var added = m.added || [], retro = m.retro || [];
        var lines = [];
        if (added.length && added[0].title) lines.push("Noted: " + added[0].title);
        if (retro.length) lines.push("also explains " + retro.length + " earlier case" + (retro.length === 1 ? "" : "s"));
        var rc = m.receipt || {}, b = rc.before || {}, a = rc.after || {};
        if (b.value != null && a.value != null && b.value !== a.value) lines.push("I'd have said " + b.value + ", now " + a.value);
        if (lines.length) toast(lines, "green");
        F.learned = true; flash("spark", 1400);
        later("learned", 3500, function () { F.learned = false; render(); });
        break;
      }
      case "silence": flash("hush", 1200); return;
      case "tutor_ok": flash("spark", 1400); flash("okc", 1600); return;
      case "prediction":
        if (MODE !== "tutor") { F.guess = true; later("guess", 30000, function () { F.guess = false; render(); }); }
        break;
      default: return;
    }
    render();
  }

  function takeMetrics(mt) {
    if (!mt) return;
    ["rules_learned", "rules_confirmed", "questions_live"].forEach(function (k) { if (mt[k] != null) M[k] = mt[k]; });
  }
  function think() {
    if (F.off) return;
    F.thinking = true;
    later("think", 3000, function () { F.thinking = false; render(); });
  }

  // ------------------------------------------------------------- session controls
  // The companion runs the session: the expert starts and ends it from her own work app.
  var CONFIRM_END = false;
  var MAX_REPLAY_FRAMES = 120;
  var REPLAYS = { on: false, stream: null, video: null, canvas: null, timer: null, frames: [] };

  function pinSession(sid, mode) {
    if (!sid) return;
    PINNED = SID = sid;
    if (mode) MODE = mode;
    storeSet(SESSION_KEY, sid);
  }
  function unpinSession() {
    PINNED = null; SID = null; MODE = null;
    WORKFLOW = null; SIMULATED = false;
    storeDel(SESSION_KEY);
    if (ws) reconnect();
  }
  function reconnect() {
    var old = ws;
    ws = null;
    if (old) { old.onopen = old.onmessage = old.onclose = null; try { old.close(); } catch (e) {} }
    connect();
  }
  // a server message can pin an unpinned observer, and can end the session from the other side
  function afterServer(m) {
    if (!m || typeof m !== "object") return;
    if (m.type === "session_missing" && m.session === SID) {
      unpinSession(); render();
      toast(["That session is no longer available. Continue its saved workflow or show a new task."]);
      return;
    }
    if (m.type === "ended") {
      if (SID && (!m.session || m.session === SID)) { stopReplays(); unpinSession(); render(); }
      return;
    }
    if (!PINNED && SID) pinSession(SID, MODE);
    if (m.type === "session") {
      api("/api/sessions/" + SID).then(function (snap) {
        if (snap.id !== SID) return;
        WORKFLOW = snap.pack; SIMULATED = !!snap.simulated; EXPERT = snap.expert;
        takeMetrics(snap.metrics); render();
      }).catch(function () {});
      renderSession();
    }
  }
  // /api/config is fetched once: console_url may be "" meaning "same origin as the API"
  function loadConfig() {
    return fetch(API + "/api/config").then(function (r) { return r.ok ? r.json() : null; }).then(function (c) {
      CONFIG = c || {};
      if (!CONSOLE && CONFIG.console_url) CONSOLE = CONFIG.console_url;
      renderSession();
      return CONFIG;
    }).catch(function () { renderSession(); return null; });
  }
  function notebookURL() {
    var base = CONSOLE || (CONFIG && CONFIG.console_url) || API;
    return String(base).replace(/\/$/, "") + "/s/" + SID;
  }
  function startSession() {
    if (SID) return;
    if (GENERIC_PAGE) { learnTask(); return; }
    var b = $("b-start");
    if (b) b.disabled = true;
    // starting a session also starts the voice: one click, and Tacet can actually speak
    ensureSession().then(function () { render(); return startVoice().catch(function () {}); }).catch(function () {
      toast(["Couldn\u2019t start a session \u2014 the notebook may be offline."]);
    }).then(function () { if (b) b.disabled = false; });
  }
  function askEndSession() { CONFIRM_END = true; renderSession(); }
  function cancelEndSession() { CONFIRM_END = false; renderSession(); }
  function endSession() {
    var sid = SID;
    if (!sid) return;
    CONFIRM_END = false;
    stopReplays();
    try {
      fetch(API + "/api/sessions/" + sid + "/end", { method: "POST", headers: { "Content-Type": "application/json" } })
        .catch(function () {});
    } catch (e) {}
    unpinSession();  // forget the pin at once; the server confirms with {"type":"ended"}
    render();
  }
  function renderSession() {
    var line = $("sess-t");
    if (!line) return;
    var nb = $("nb"), start = $("b-start"), end = $("b-end"), yes = $("b-end-yes"), no = $("b-end-no");
    line.textContent = SID ? ((SIMULATED ? "Practice \u00b7 simulated expert" : "Live") + " \u00b7 " +
      (WORKFLOW ? WORKFLOW.name : "Session " + SID.slice(0, 6)) + " \u00b7 " + (MODE || "capture")) : "Not recording";
    start.hidden = !!SID || GENERIC_PAGE || LEARN.stage !== "idle";
    nb.href = notebookURL();
    nb.style.display = (SID && !CONFIRM_END) ? "" : "none";
    end.hidden = !SID || CONFIRM_END;
    yes.hidden = !CONFIRM_END;
    no.hidden = !CONFIRM_END;
    var rp = $("rp-t"), sw = $("b-replays");
    if (rp) rp.textContent = REPLAYS.on
      ? ("Replays: on \u00b7 " + REPLAYS.frames.length + " frames kept on this device")
      : "Replays: off";
    if (sw) sw.setAttribute("aria-checked", REPLAYS.on ? "true" : "false");
    renderLearning();
  }

  // Generic observers use this companion's pinned connection. Unassigned page
  // events stay local; they must never teach some other tab's latest session.
  function sendSnapshot() {
    var snap = window.shadowObserve.snapshot();
    send({ type: "observe", url: snap.url, title: snap.title, fields: snap.fields });
  }
  function keepLearning() { storeSet(LEARN_KEY, JSON.stringify(LEARN)); }
  function receiveObservation(evt) {
    if (LEARN.stage === "watching" && !F.off) {
      if (!LEARN.current.length && evt.type !== "observe") {
        var snap = window.shadowObserve.snapshot();
        // change fires after the edit: restore its opening value for the demo.
        if (evt.type === "field_changed") snap.fields.forEach(function (f) { if (f.name === evt.field) f.value = evt.before; });
        LEARN.current.push({ type: "observe", url: snap.url, title: snap.title, fields: snap.fields });
      }
      LEARN.current.push(evt);
      if (evt.type === "action" && evt.terminal) {
        LEARN.demos.push(LEARN.current); LEARN.current = [];
      }
      keepLearning(); renderLearning();
    } else if (SID && LEARN.stage === "idle" && !F.off) send(evt);
  }
  function wireObserver() {
    if (!GENERIC_PAGE || !window.shadowObserve || window.__shadowObserverConnected) return;
    window.__shadowObserverConnected = true;
    window.shadowObserve.on(receiveObservation);
    if (SID) sendSnapshot();
    else if (LEARN.stage === "watching") window.shadowObserve.refresh();
    render();
  }
  window.__shadowWireObserver = wireObserver;
  window.addEventListener("shadow-observer-ready", wireObserver);
  function learnTask() {
    if (SID) return;
    F.open = true; LEARN.stage = "matching"; LEARN.error = ""; render();
    if (!window.shadowObserve) {
      var obs = document.createElement("script"); obs.src = API + "/observe.js";
      obs.onload = matchPage; obs.onerror = function () { LEARN.error = "The page observer could not load. Try again when Tacet is connected."; renderLearning(); };
      document.head.appendChild(obs);
    } else matchPage();
  }
  function matchPage() {
    var snap = window.shadowObserve.snapshot();
    api("/api/workflows/match", { url: snap.url, fields: snap.fields.map(function (f) { return f.name; }),
      actions: (snap.actions || []).map(function (a) { return a.name; }) }).then(function (match) {
      LEARN.match = match; LEARN.stage = match.verdict === "new" ? "goal" : "choose"; renderLearning();
    }).catch(function () { LEARN.error = "I couldn\u2019t check this page. Connect to Tacet, then try again."; renderLearning(); });
  }
  function watchTask() {
    var goal = $("learn-goal").value.trim();
    if (!goal) { $("learn-goal").focus(); return; }
    LEARN.goal = goal; LEARN.stage = "watching"; LEARN.error = "";
    F.off = false; window.shadowObserve.refresh(); keepLearning(); render();
  }
  function stopWatching() { LEARN.stage = "stopped"; keepLearning(); render(); }
  function resumeWatching() {
    LEARN.stage = "watching"; F.off = false;
    // Keep a partial demonstration's opening snapshot across a deliberate pause.
    if (!LEARN.current.length) window.shadowObserve.refresh();
    keepLearning(); render();
  }
  function useSession(snap) {
    LEARN = { stage: "idle", goal: "", demos: [], current: [], match: null, error: "" };
    storeDel(LEARN_KEY); outbox = [];
    WORKFLOW = snap.pack; SIMULATED = !!snap.simulated; EXPERT = snap.expert;
    pinSession(snap.id, snap.mode); takeMetrics(snap.metrics); reconnect(); render();
  }
  function doneShowing() {
    if (!LEARN.demos.length || LEARN.stage === "creating") return;
    LEARN.stage = "creating"; LEARN.error = ""; render();
    api("/api/onboard", { goal: LEARN.goal, demos: LEARN.demos, events: true }).then(function (r) {
      useSession(r.session);
      toast(["I\u2019ve opened a Work Map. Keep working; I\u2019ll ask when I need to understand a decision."]);
    }).catch(function (e) { LEARN.stage = "stopped"; LEARN.error = e.message || "I couldn\u2019t open this workflow. Your demonstrations are still here."; keepLearning(); render(); });
  }
  function continueWorkflow() {
    var best = LEARN.match && LEARN.match.best;
    if (!$("learn-workflow-choice").hidden) best = LEARN.match.candidates.filter(function (c) { return c.id === $("learn-workflow").value; })[0];
    if (!best) return;
    LEARN.stage = "continuing"; LEARN.error = ""; render();
    api("/api/sessions", { mode: "capture", pack: best.id, fresh: false, simulate: false }).then(useSession)
      .catch(function (e) { LEARN.stage = "choose"; LEARN.error = e.message; renderLearning(); });
  }
  function renderLearning() {
    var stage = LEARN.stage, showing = stage === "watching" || stage === "stopped";
    $("b-learn").hidden = !!SID || stage !== "idle";
    $("learn").hidden = !!SID || stage === "idle";
    $("learn-choose").hidden = stage !== "choose";
    $("learn-form").hidden = stage !== "goal";
    $("learn-watch").hidden = !showing;
    $("learn-cancel").hidden = stage === "idle" || stage === "creating" || stage === "continuing";
    var best = LEARN.match && LEARN.match.best;
    var candidates = LEARN.match && LEARN.match.candidates || [];
    candidates = candidates.filter(function (c) { return c.score >= 0.35; });
    var choices = $("learn-workflow");
    if (choices.getAttribute("data-options") !== JSON.stringify(candidates)) {
      choices.textContent = "";
      candidates.forEach(function (c) { var option = document.createElement("option"); option.value = c.id; option.textContent = c.name + (c.goal ? " \u00b7 " + c.goal : ""); choices.appendChild(option); });
      choices.setAttribute("data-options", JSON.stringify(candidates));
    }
    $("learn-workflow-choice").hidden = candidates.length < 2;
    $("learn-match").textContent = best ? (LEARN.match.verdict === "same" ? "This looks like " : "Is this ") + best.name + (LEARN.match.verdict === "same" ? ". Continue learning it?" : ", or a new task?") : "";
    $("learn-state").textContent = stage === "matching" ? "Checking this page\u2026" :
      stage === "creating" ? "Opening your workflow\u2026" : stage === "continuing" ? "Opening the saved Work Map\u2026" : "";
    $("learn-state").hidden = !$("learn-state").textContent;
    $("learn-count").textContent = (stage === "watching" ? "Watching" : "Stopped") + " \u00b7 " + LEARN.demos.length +
      " demonstration" + (LEARN.demos.length === 1 ? "" : "s") + " saved";
    $("learn-stop").hidden = stage !== "watching";
    $("learn-resume").hidden = stage !== "stopped";
    $("learn-done").disabled = !LEARN.demos.length;
    $("learn-error").textContent = LEARN.error; $("learn-error").hidden = !LEARN.error;
    $("learn-retry").hidden = stage !== "matching" || !LEARN.error;
    if (stage === "watching" || stage === "stopped") {
      $("hc-s").textContent = stage === "watching" ? (F.off ? "Watching paused \u00b7 off the record" : "Watching \u00b7 live demonstrations") : "Watching stopped";
      $("hint").textContent = stage === "watching" ? (F.off ? "Observation paused" : "Watching this task") : "Watching stopped";
    }
    $("rows").hidden = !SID;
    $("session-acts").hidden = !SID;
  }
  // optional local replays: frames never leave the device and are dropped when the replay stops
  function startReplays() {
    if (REPLAYS.on) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) return;  // off, silently
    navigator.mediaDevices.getDisplayMedia({ video: true, preferCurrentTab: true }).then(function (stream) {
      REPLAYS.stream = stream;
      var v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.setAttribute("playsinline", "");
      v.srcObject = stream;
      REPLAYS.video = v;
      var p = v.play(); if (p && p.catch) p.catch(function () {});
      REPLAYS.canvas = document.createElement("canvas");
      var track = stream.getVideoTracks()[0];
      if (track) track.addEventListener("ended", function () { stopReplays(); });
      REPLAYS.on = true;
      REPLAYS.timer = setInterval(grabReplayFrame, 1000);
      renderSession();
    }).catch(function () { /* picker cancelled or denied: stay off, silently */ });
  }
  function grabReplayFrame() {
    var v = REPLAYS.video, c = REPLAYS.canvas;
    if (!v || !c || !v.videoWidth) return;
    c.width = v.videoWidth; c.height = v.videoHeight;
    try { c.getContext("2d").drawImage(v, 0, 0, c.width, c.height); } catch (e) { return; }
    if (!c.toBlob) return;
    c.toBlob(function (blob) {
      if (!blob) return;
      REPLAYS.frames.push(blob);
      while (REPLAYS.frames.length > MAX_REPLAY_FRAMES) REPLAYS.frames.shift();
      renderSession();
    }, "image/jpeg", 0.55);
  }
  function stopReplays() {
    if (REPLAYS.timer) { clearInterval(REPLAYS.timer); REPLAYS.timer = null; }
    REPLAYS.on = false;
    REPLAYS.frames = [];
    if (REPLAYS.video) { try { REPLAYS.video.pause(); } catch (e) {} REPLAYS.video.srcObject = null; }
    if (REPLAYS.stream) { try { REPLAYS.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} }
    REPLAYS.stream = null; REPLAYS.video = null; REPLAYS.canvas = null;
    renderSession();
  }
  function setReplayMode(on, n) {  // harness only: no capture device in a screenshot
    stopReplays();
    REPLAYS.on = !!on;
    if (REPLAYS.on) for (var i = 0; i < (n || 8); i++) REPLAYS.frames.push("frame");
    renderSession();
  }

  // ------------------------------------------------------------- UI (shadow DOM, never clashes with the app)
  // Visual layer ported from advisory/companion-design-2026-10-03: the pixel intern,
  // a warm paper panel, sage accent, one soft blink and a rare curl shift.
  var PAPER = "#fffdf7", INK = "#30362f", MUTED = "#697165", LINE = "#e0e3d8", ACCENT = "#627857";
  var UID = "sc" + Math.random().toString(36).slice(2, 8);
  var ART = API + "/companion/intern.png";
  var ART_T = API + "/companion/teacher.png";  // teaching mode: same Mira, with a pointer (Codex art)
  // the learner-guide nudge: { level, text, look } from the server (or the harness hook)
  var NUDGE = { level: 0, text: "", look: [], case_id: null };

  var STATES = {
    idle:      { hint: "Here when you need me", status: "Observing", badge: "" },
    question:  { hint: "One question, when you have a moment", status: "Question ready", badge: "?" },
    listening: { hint: "Listening", status: "Listening", badge: "" },
    thinking:  { hint: "Checking what I learned", status: "Checking", badge: "" },
    learned:   { hint: "Added to my notes", status: "Noted", badge: "\u2713" },
    paused:    { hint: "Observation paused", status: "Paused", badge: "\u2161" },
    offline:   { hint: "Connection unavailable", status: "Offline", badge: "\u2013" }
  };

  var SVG =
    '<svg class="sp-a" viewBox="145 96 426 520" aria-hidden="true" focusable="false">' +
      '<defs>' +
        '<clipPath id="' + UID + '-eyes"><ellipse cx="313" cy="294" rx="28" ry="24"/><ellipse cx="404" cy="289" rx="27" ry="24"/></clipPath>' +
        '<clipPath id="' + UID + '-curl"><path d="M470 329 L515 333 L537 362 L524 380 L509 386 L493 410 L468 401 L479 381 L487 365 Z"/></clipPath>' +
      '</defs>' +
      '<image href="' + ART + '" width="1254" height="1254"/>' +
      '<g clip-path="url(#' + UID + '-eyes)" class="blink"><image href="' + ART + '" width="1254" height="1254" transform="translate(-552 0)"/></g>' +
      '<g class="curl"><g clip-path="url(#' + UID + '-curl)"><image href="' + ART + '" width="1254" height="1254"/></g></g>' +
    '</svg>';
  // teaching mode: only the forearm and pointer move, one slight lift in a long cycle
  var SVG_T =
    '<svg class="sp-t" viewBox="120 260 1120 880" aria-hidden="true" focusable="false">' +
      '<defs>' +
        '<clipPath id="' + UID + '-tb"><rect x="0" y="0" width="790" height="1254"/></clipPath>' +
        '<clipPath id="' + UID + '-ta"><rect x="780" y="0" width="474" height="1254"/></clipPath>' +
      '</defs>' +
      '<g clip-path="url(#' + UID + '-tb)"><image href="' + ART_T + '" width="1254" height="1254"/></g>' +
      '<g class="pointer"><g clip-path="url(#' + UID + '-ta)"><image href="' + ART_T + '" width="1254" height="1254"/></g></g>' +
    '</svg>';

  var CSS =
    ':host{all:initial}' +
    '#w{--shadow-size:56px;--paper:' + PAPER + ';--ink:' + INK + ';--muted:' + MUTED + ';--line:' + LINE + ';--accent:' + ACCENT + ';' +
    'position:relative;width:calc(var(--shadow-size) + 8px);font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);color-scheme:light}' +
    '#w *{box-sizing:border-box}#w button,#w input{font:inherit}#w button{cursor:pointer}' +
    '#w button:focus-visible,#w input:focus-visible,#w a:focus-visible{outline:2px solid #6f854f;outline-offset:4px}' +
    '.portrait{all:unset;display:block;width:var(--shadow-size);height:calc(var(--shadow-size)*1.23);border:0;padding:0;margin:0 auto;background:none;position:relative;opacity:.86;transition:opacity .18s;touch-action:manipulation}' +
    '.portrait:hover,.portrait:focus-visible,#w.open .portrait{opacity:1}' +
    '.portrait svg{display:block;width:100%;height:100%;overflow:hidden;image-rendering:pixelated}' +
    '.blink{animation:blink 8.6s steps(1,end) infinite;opacity:0}.curl{animation:curl 19s steps(2,end) infinite}' +
    '@keyframes blink{0%,91%,94%,100%{opacity:0}92%,93%{opacity:1}}' +
    '.portrait .sp-t{display:none}#w.tutor .portrait .sp-a{display:none}#w.tutor .portrait .sp-t{display:block}' +
    '#w.tutor{width:calc(var(--shadow-size)*1.58 + 8px)}#w.tutor .portrait{width:calc(var(--shadow-size)*1.58)}' +
    '.pointer{transform-box:view-box;transform-origin:780px 1045px;animation:pointer 14s ease-in-out infinite}' +
    '@keyframes pointer{0%,82%,100%{transform:rotate(0)}86%,89%{transform:rotate(-1.2deg)}93%{transform:rotate(0)}}' +
    '#w.state-paused .pointer,#w.state-offline .pointer,#w.still .pointer{animation:none}' +
    '@keyframes curl{0%,79%,100%{transform:translate(0,0)}83%,86%{transform:translate(3px,0)}90%{transform:translate(1px,0)}}' +
    '.badge{position:absolute;right:-2px;top:5px;display:none;align-items:center;justify-content:center;min-width:17px;height:17px;border-radius:5px;background:#efe3bb;color:#67552c;border:1px solid #d8c999;font:600 11px/1 ui-monospace,monospace}' +
    '#w.state-question .badge,#w.state-learned .badge,#w.state-paused .badge,#w.state-offline .badge{display:flex}' +
    '#w.state-learned .badge{background:#e4ecdc;color:#48663d;border-color:#bacbad}' +
    '#w.state-paused .badge,#w.state-offline .badge{background:#f1f0e9;color:#797d72;border-color:#dadcd3}' +
    '#w.state-listening .portrait,#w.state-question .portrait{opacity:1}' +
    '#w.state-paused .portrait,#w.state-offline .portrait{filter:saturate(.3);opacity:.65}' +
    '#w.state-paused .blink,#w.state-paused .curl,#w.state-offline .blink,#w.state-offline .curl,#w.still .blink,#w.still .curl{animation:none}' +
    '.hint{position:absolute;bottom:20px;right:calc(100% + 12px);padding:7px 11px;background:var(--paper);border:1px solid var(--line);border-radius:9px;color:var(--muted);font-size:11px;white-space:nowrap;opacity:0;pointer-events:none;transform:translateX(3px);transition:opacity .15s,transform .15s}' +
    '.portrait:hover~.hint,.portrait:focus-visible~.hint,#w.showhint .hint{opacity:1;transform:none}' +
    '#w.open .hint{display:none}' +
    '.stack{position:absolute;right:0;bottom:calc(var(--shadow-size)*1.23 + 14px);display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none;max-height:calc(100vh - var(--shadow-size)*1.23 - 46px);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none}' +
    '.stack>*{pointer-events:auto}' +
    '.pop{opacity:0;transform:translateY(6px);transform-origin:bottom right;transition:opacity .22s ease,transform .22s ease;pointer-events:none;visibility:hidden}' +
    '.pop.show{opacity:1;transform:none;pointer-events:auto;visibility:visible}' +
    '.panel{width:min(304px,calc(100vw - 40px));background:var(--paper);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 26px #26321d12;padding:16px 18px}' +
    '.heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}' +
    '.brand{display:block;font-weight:650;font-size:13px}' +
    '.status{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--muted);margin-top:2px}' +
    '.status i{width:5px;height:5px;border-radius:50%;background:#8b9d76;display:inline-block}' +
    '#w.state-paused .status i,#w.state-offline .status i{background:#989d93}#w.state-question .status i{background:#b49858}' +
    '.close{border:0;background:none;font-size:20px;line-height:20px;color:var(--muted);padding:2px 4px;margin:-2px -4px 0 0}' +
    '.rows{margin:13px 0 0}' +
    '.row{display:flex;justify-content:space-between;gap:12px;padding:5px 0;font-size:12px;color:var(--muted);border-top:1px solid var(--line)}' +
    '.row b{color:var(--ink);font-weight:600}' +
    '.acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}' +
    '.btn{all:unset;cursor:pointer;padding:6px 10px;border-radius:8px;font:600 11.5px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:#f4f2e9;border:1px solid var(--line);transition:background .2s,border-color .2s}' +
    '.btn:hover{background:#eeecdf}' +
    '.btn.accent{background:var(--accent);color:#fff;border-color:#556b49}.btn.accent:hover{background:#556b49}' +
    '.btn[hidden]{display:none}' +
    '.vst{margin-top:9px;font-size:11px;color:var(--muted)}.vst[hidden]{display:none}' +
    '.nb{display:block;margin-top:10px;color:var(--accent);text-decoration:none;font-size:11.5px}.nb:hover{text-decoration:underline}' +
    '.sess{margin:12px 0 0}' +
    '.sess-line{font:600 11px ui-monospace,SFMono-Regular,monospace;color:var(--muted);letter-spacing:.02em}' +
    '.sess-acts{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:7px}' +
    '.sess-acts .nb{margin:0}' +
    '.learn{margin-top:12px;border-top:1px solid var(--line);padding-top:12px;font-size:12px}' +
    '.learn p{margin:0 0 9px;color:var(--muted)}.learn label{display:block;margin-bottom:5px;color:var(--ink)}' +
    '.learn input,.learn select{width:100%;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--ink);padding:7px 9px;margin-bottom:9px}' +
    '.learn [hidden],.rows[hidden],.acts[hidden]{display:none}.btn:disabled{opacity:.5;cursor:default}' +
    '.switch{all:unset;cursor:pointer;display:inline-block;position:relative;width:30px;height:16px;border-radius:8px;background:#e7e5da;border:1px solid var(--line);transition:background .2s,border-color .2s}' +
    '.switch i{position:absolute;top:1px;left:1px;width:12px;height:12px;border-radius:50%;background:#fff;border:1px solid var(--line);transition:transform .18s}' +
    '.switch[aria-checked="true"]{background:var(--accent);border-color:#556b49}' +
    '.switch[aria-checked="true"] i{transform:translateX(14px)}' +
    // level 1 of the help ladder is only a soft paper dot on the portrait
    '.nbadge{position:absolute;left:-1px;top:6px;display:none;width:7px;height:7px;border-radius:50%;background:#b49858;border:1px solid var(--paper)}' +
    '#w.nudged .nbadge{display:block}' +
    '.card.nudge{padding:12px 15px}' +
    '.card .look{margin-top:7px;font-size:11.5px;color:var(--muted)}' +
    '.showcap{max-width:300px;background:var(--paper);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 26px #26321d12;padding:9px 11px;font:italic 12px/1.45 Georgia,"Times New Roman",serif;color:var(--muted)}' +
    '.stuckrow{margin-top:10px;border-top:1px solid var(--line);padding-top:8px}' +
    '.linkbtn{all:unset;cursor:pointer;font-size:11px;color:var(--accent);text-decoration:underline}' +
    '.linkbtn:hover{color:#556b49}' +
    '.caption{width:min(268px,calc(100vw - 56px));background:var(--paper);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 26px #26321d12;padding:12px 13px}' +
    '.caption .q{font-size:13px;line-height:1.45;color:var(--ink)}' +
    '.caption .hintline{margin-top:6px;font-size:11px;color:var(--muted)}' +
    '.caption input{all:unset;box-sizing:border-box;display:block;width:100%;margin-top:8px;padding:7px 9px;border-radius:8px;background:#fff;border:1px solid var(--line);font-size:12px;color:var(--ink)}' +
    '.caption input::placeholder{color:#a3a99c}' +
    '.toast{max-width:250px;background:var(--paper);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 26px #26321d12;padding:9px 11px;font-size:12px;line-height:1.4;color:var(--ink)}' +
    '.toast b{color:var(--accent);font-weight:650}.toast div+div{color:var(--muted)}' +
    '.later{all:unset;position:absolute;right:calc(100% + 12px);bottom:50px;padding:5px 9px;border-radius:8px;font:600 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:var(--paper);border:1px solid var(--line);white-space:nowrap;opacity:0;transform:translateX(4px);pointer-events:none;transition:opacity .2s,transform .2s}' +
    '#w.hand:hover .later{opacity:1;transform:none;pointer-events:auto}.later:hover{background:#f4f2e9}' +
    '.card{width:340px;max-width:calc(100vw - 40px);box-sizing:border-box;background:var(--paper);color:var(--ink);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 26px #26321d12;padding:14px 16px}' +
    '.card h4{margin:0 0 6px;font:600 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}' +
    '.card .say{font-size:15px;line-height:1.45;color:var(--ink)}' +
    '.card q{display:block;margin-top:9px;color:var(--muted);font:italic 13px/1.5 Georgia,"Times New Roman",serif}' +
    // end-of-practice summary: the tutor's report card on warm paper, lists only, no chart
    '.card.summary .sumtop{font-size:12px;color:var(--muted);margin-top:5px}' +
    '.card.summary .sumtop b{color:var(--ink);font-weight:650}' +
    '.card.summary .sumb{margin-top:11px;border-top:1px solid var(--line);padding-top:9px}' +
    '.card.summary .sumb h5{margin:0 0 4px;font:600 10.5px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}' +
    '.card.summary ul.sum{list-style:none;margin:0;padding:0}' +
    '.card.summary ul.sum li{display:flex;align-items:baseline;gap:8px;padding:2.5px 0;font-size:12.5px;line-height:1.4;color:var(--ink)}' +
    '.card.summary ul.sum li i{flex:0 0 13px;width:13px;text-align:center;font-style:normal}' +
    '.card.summary ul.sum li i.tick{color:#4e6b44}' +
    '.card.summary ul.sum li i.ring{color:#8f6420}' +
    '.card.summary ul.sum li .t{flex:1}' +
    '.card.summary ul.sum li .why{color:var(--muted);font-size:11px}' +
    '.card.summary ul.sum li .pp{font:11px ui-monospace,SFMono-Regular,monospace;color:var(--muted)}' +
    '.card.summary ul.sum li.empty .none{color:var(--muted);font-size:11.5px}' +
    '@media (prefers-reduced-motion:reduce){#w *,#w *::before,#w *::after{animation:none!important;transition:none!important}}';

  var host = document.createElement("div");
  host.setAttribute("data-shadow-ui", "companion");
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
  var root = host.attachShadow({ mode: "open" });
  root.innerHTML = '<style>' + CSS + '</style>' +
    '<div id="w" class="state-idle">' +
      '<div class="stack">' +
        '<div id="cards"></div>' +
        '<div class="panel pop" id="hc" role="dialog" aria-label="' + NAME + '">' +
          '<div class="heading">' +
            '<div><span class="brand" id="hc-t"></span>' +
              '<div class="status"><i></i><span id="hc-s"></span></div></div>' +
            '<button class="close" id="b-close" type="button" aria-label="Close companion">\u00d7</button>' +
          '</div>' +
          '<div class="sess">' +
            '<div class="sess-line" id="sess-t">Not recording</div>' +
            '<div class="sess-acts">' +
              '<button class="btn accent" id="b-start" type="button">Start session</button>' +
              '<button class="btn accent" id="b-learn" type="button">Learn this task</button>' +
              '<a class="nb" id="nb" target="_blank" rel="noopener">Open notebook \u2197</a>' +
              '<button class="btn" id="b-end" type="button">End session</button>' +
              '<button class="btn accent" id="b-end-yes" type="button" hidden>End? yes</button>' +
              '<button class="btn" id="b-end-no" type="button" hidden>no</button>' +
            '</div>' +
          '</div>' +
          '<div class="learn" id="learn" hidden>' +
            '<p id="learn-state" role="status" hidden></p>' +
            '<div id="learn-choose" hidden><p id="learn-match"></p>' +
              '<label id="learn-workflow-choice" hidden>Which workflow are you doing?<select id="learn-workflow"></select></label><div class="sess-acts">' +
              '<button class="btn accent" id="learn-continue" type="button">Continue this workflow</button>' +
              '<button class="btn" id="learn-new" type="button">Learn a new task</button></div></div>' +
            '<form id="learn-form" hidden><label for="learn-goal">What should this task accomplish?</label>' +
              '<input id="learn-goal" maxlength="300" placeholder="A one-line goal" required autocomplete="off">' +
              '<p>Show Mira a few examples. A save or submit finishes each demonstration.</p>' +
              '<button class="btn accent" type="submit">Start watching</button></form>' +
            '<div id="learn-watch" hidden><p id="learn-count" role="status"></p><p>One example is enough to start. Two or three help me see what changes.</p>' +
              '<div class="sess-acts"><button class="btn" id="learn-stop" type="button">Stop</button>' +
              '<button class="btn" id="learn-resume" type="button" hidden>Resume watching</button>' +
              '<button class="btn accent" id="learn-done" type="button" disabled>Done showing</button></div></div>' +
            '<p id="learn-error" role="alert" hidden></p><button class="btn" id="learn-retry" type="button" hidden>Try again</button>' +
            '<div class="sess-acts"><button class="btn" id="learn-cancel" type="button">Cancel</button></div>' +
          '</div>' +
          '<div class="rows" id="rows">' +
            '<div class="row"><span>Rules learned</span><b id="m-rl">\u2014</b></div>' +
            '<div class="row"><span>Rules confirmed</span><b id="m-rc">\u2014</b></div>' +
            '<div class="row"><span>Questions asked</span><b id="m-q">\u2014</b></div>' +
            '<div class="row"><span id="rp-t">Replays: off</span>' +
              '<button class="switch" id="b-replays" type="button" role="switch" aria-checked="false" aria-label="Replays"><i></i></button></div>' +
          '</div>' +
          '<div class="acts" id="session-acts"><button class="btn" id="b-voice" type="button">Talk</button>' +
            '<button class="btn accent" id="b-ask" type="button" hidden>Ask me now</button>' +
            '<button class="btn" id="b-debrief" type="button" hidden>Debrief me</button>' +
            '<button class="btn" id="b-teach" type="button" hidden>Teach ' + NOVICE + '</button>' +
            '<button class="btn accent" id="b-finish" type="button" hidden>Finish practice</button>' +
            '<button class="btn" id="b-off" type="button"></button></div>' +
          '<div class="stuckrow"><button class="linkbtn" id="b-stuck" type="button">I\u2019m stuck</button></div>' +
          '<div class="vst" id="v-st" hidden><span id="v-t"></span></div>' +
        '</div>' +
        '<div class="caption pop" id="cap">' +
          '<div class="q" id="cap-t"></div>' +
          '<div class="hintline" id="cap-h"></div>' +
          '<input id="cap-in" placeholder="A short answer is enough\u2026" autocomplete="off">' +
        '</div>' +
        '<div class="toast pop" id="toast"></div>' +
        '<div class="showcap pop" id="showcap"></div>' +
      '</div>' +
      '<button class="portrait" id="kid" type="button" aria-label="' + NAME + ' companion">' + SVG + SVG_T +
        '<span class="badge" id="badge" aria-hidden="true"></span>' +
        '<span class="nbadge" id="nbadge" aria-hidden="true"></span></button>' +
      '<span class="hint" id="hint" aria-hidden="true">Here when you need me</span>' +
      '<button class="later" id="later" type="button" title="Ask at the end instead">later</button>' +
    '</div>';
  function mount() { if (document.body) document.body.appendChild(host); else setTimeout(mount, 50); }
  mount();

  var $ = function (id) { return root.getElementById(id); };
  var W = $("w");

  $("b-close").addEventListener("click", function (e) {
    e.stopPropagation(); clearTimeout(T.open); F.open = false; render();
  });
  $("b-start").addEventListener("click", startSession);
  $("b-learn").addEventListener("click", learnTask);
  $("learn-retry").addEventListener("click", learnTask);
  $("learn-form").addEventListener("submit", function (e) { e.preventDefault(); watchTask(); });
  $("learn-stop").addEventListener("click", stopWatching);
  $("learn-resume").addEventListener("click", resumeWatching);
  $("learn-done").addEventListener("click", doneShowing);
  $("learn-continue").addEventListener("click", continueWorkflow);
  $("learn-new").addEventListener("click", function () { LEARN.stage = "goal"; renderLearning(); });
  $("learn-cancel").addEventListener("click", function () {
    LEARN = { stage: "idle", goal: "", demos: [], current: [], match: null, error: "" }; storeDel(LEARN_KEY); render();
  });
  $("b-finish").addEventListener("click", finishPractice);
  $("b-end").addEventListener("click", askEndSession);
  $("b-end-yes").addEventListener("click", endSession);
  $("b-end-no").addEventListener("click", cancelEndSession);
  $("b-replays").addEventListener("click", function () { if (REPLAYS.on) stopReplays(); else startReplays(); });
  $("b-stuck").addEventListener("click", function (e) {
    e.stopPropagation();
    send({ type: "help" });
    toast(["Asked " + NAME + " for a hand."]);
  });

  // headless-harness hook: force one of the seven design states without a server
  var TEST = { state: null, hint: false, motion: true };
  window.__shadowCompanion = {
    states: Object.keys(STATES),
    setState: function (name) {
      if (!STATES[name]) return false;
      TEST.state = name;
      F.offline = false; F.off = false; F.hand = false; F.asking = false; F.thinking = false; F.learned = false;
      V.conv = null; V.status = "off";
      if (name === "offline") F.offline = true;
      else if (name === "paused") F.off = true;
      else if (name === "question") { F.hand = true; F.asking = true; F.askText = "Equipment over 3,600 net \u2014 capex or opex?"; }
      else if (name === "learned") F.learned = true;
      else if (name === "thinking") F.thinking = true;
      else if (name === "listening") { V.conv = {}; V.status = "listening"; }
      render();
      return true;
    },
    setPanel: function (open) { F.open = !!open; render(); },
    setHint: function (show) { TEST.hint = !!show; W.classList.toggle("showhint", TEST.hint); },
    setMotion: function (on) { TEST.motion = !!on; W.classList.toggle("still", !TEST.motion); },
    setSession: function (sid, mode) {
      if (sid) pinSession(sid, mode || "capture");
      else { storeDel(SESSION_KEY); PINNED = null; SID = null; MODE = null; }
      render();
      return true;
    },
    setConfirmEnd: function (on) { CONFIRM_END = !!on; renderSession(); return true; },
    setReplays: function (on, n) { setReplayMode(on, n); return true; },
    setNudge: function (level, text, look) {
      nudge({ level: level, text: text, look: look || [], case_id: lastCase });
      return true;
    },
    setSummary: function (m) { tutorSummary(m || {}); return true; },
    setIntervention: function (iv) { overlay(iv || {}); return true; },
    showMe: function (steps) { replayPath(steps || []); return true; },
    notebook: function () { return SID ? notebookURL() : null; },
    showToast: function (lines) {
      toast(lines || ["Noted: Equipment over 3,600 net is capex", "I'd have said 4711, now 0400"]);
    },
    clear: function () { TEST.state = null; render(); }
  };

  function companionState() {
    if (TEST.state) return TEST.state;
    if (F.offline) return "offline";
    if (F.off) return "paused";
    if (F.asking || F.hand) return "question";
    if (F.learned) return "learned";
    if (F.thinking) return "thinking";
    if (V.conv && !V.speaking && /listen/i.test(V.status || "")) return "listening";
    return "idle";
  }

  function renderVoice() {
    var bv = $("b-voice"); if (!bv) return;
    bv.textContent = V.conv ? "Stop talking" : (MODE === "tutor" ? "Talk to the tutor" : "Talk");
    // a question is waiting and nobody can hear it: make the way to hear it obvious
    bv.classList.toggle("accent", !V.conv && (F.asking || F.hand || MODE === "tutor"));
    $("b-debrief").hidden = !(SID && MODE === "capture");
    $("b-teach").hidden = !(SID && MODE !== "tutor");
    $("b-finish").hidden = !(SID && MODE === "tutor");  // the trainee ends the practice
  }
  function render() {
    var st = companionState(), meta = STATES[st];
    var cls = ["state-" + st];
    if (F.hand) cls.push("hand");
    if (F.open) cls.push("open");
    if (MODE === "tutor") cls.push("tutor");
    W.className = cls.join(" ");
    if (NUDGE.level === 1) W.classList.add("nudged");  // level 1: just the soft badge
    if (TEST.hint) W.classList.add("showhint");
    if (!TEST.motion) W.classList.add("still");
    $("hc-t").textContent = !SID ? "Tacet \u00b7 " + NAME : (MODE === "tutor" ? NAME + " tutor \u00b7 watching " + NOVICE : NAME + " \u00b7 learning from " + EXPERT);
    $("hc-s").textContent = meta.status;
    $("m-rl").textContent = M.rules_learned != null ? M.rules_learned : "\u2014";
    $("m-rc").textContent = M.rules_confirmed != null ? M.rules_confirmed : "\u2014";
    $("m-q").textContent = M.questions_live != null ? M.questions_live : "\u2014";
    $("b-ask").hidden = !F.hand;
    $("b-off").textContent = F.off ? "Back on the record" : "Off the record";
    $("b-off").title = "Alt+Shift+S";
    renderVoice();
    renderSession();
    $("hc").classList.toggle("show", F.open);
    $("hint").textContent = meta.hint;
    $("badge").textContent = meta.badge;
    $("cap-t").textContent = F.askText;
    $("cap-h").textContent = V.conv ? NAME + " is listening \u2014 just answer out loud" : "Type an answer \u2014 or press Talk to say it";
    $("cap").title = F.askText;
    $("cap").classList.toggle("show", F.asking && !!F.askText);
    $("kid").setAttribute("aria-label", NAME + " \u2014 " + meta.status + (F.off ? " (off the record)" : ""));
    $("kid").title = F.off ? "off the record" : "";
  }

  function flash(cls, ms) {
    // kept for the server's tutor_ok / silence signals; this design has no motion flourishes.
    var el = $("kid");
    el.setAttribute("data-signal", cls);
    later("flash", ms, function () { el.removeAttribute("data-signal"); });
  }

  function toast(lines, tone) {
    var el = $("toast");
    el.innerHTML = "";
    lines.forEach(function (l, i) {
      var d = document.createElement("div");
      if (i === 0 && l.indexOf("Noted: ") === 0) {
        var b = document.createElement("b"); b.textContent = "Noted: "; d.appendChild(b);
        d.appendChild(document.createTextNode(l.slice(7)));
      } else d.textContent = l;
      el.appendChild(d);
    });
    el.classList.add("show");
    later("toast", 3500, function () { el.classList.remove("show"); });
  }

  // ------------------------------------------- learner guide: nudge + show me
  // The server watches behaviour (backend/shadow/stuck.py) and sends a nudge on
  // the help ladder. These functions only render it; the words come from the
  // engine and the actions stay in the page: highlight, or open the panel.
  function cssEscape(s) {
    s = String(s == null ? "" : s);
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return s.replace(/["\\\]]/g, "\\$&");
  }
  function shadowHighlight(name) {
    try {
      if (window.shadowERP && window.shadowERP.highlight) { window.shadowERP.highlight(name); return true; }
    } catch (e) {}
    return false;
  }
  function openPanel(name) {
    var el = document.querySelector('[data-shadow-panel="' + cssEscape(name) + '"]');
    if (el && el.click) { el.click(); return true; }
    return false;
  }
  // a field is highlighted; anything else is treated as a panel to open
  function revealLook(name) {
    if (!name) return false;
    if (shadowHighlight(name)) return true;
    return openPanel(String(name));
  }
  function lowerFirst(s) {
    if (!s) return s;
    if (/^[A-Z0-9]{2,}\b/.test(s)) return s;  // an acronym or a code keeps its case
    return s.charAt(0).toLowerCase() + s.slice(1);
  }
  function humanName(name) {
    var field = document.querySelector('[data-shadow-field="' + cssEscape(name) + '"]');
    if (field) {
      var label = field.getAttribute("aria-label");
      if (!label && field.closest) {
        var wrap = field.closest("label");
        if (wrap) label = (wrap.textContent || "").trim();
      }
      if (!label) label = field.getAttribute("data-shadow-field");
      if (label) return label;
    }
    var panel = document.querySelector('[data-shadow-panel="' + cssEscape(name) + '"]');
    if (panel) {
      var pl = panel.getAttribute("aria-label");
      if (!pl && panel.textContent) pl = (panel.textContent || "").trim();
      if (!pl) pl = panel.getAttribute("data-shadow-panel");
      if (pl) return pl;
    }
    return String(name).replace(/[_-]+/g, " ");
  }
  function showCaption(text) {
    var el = $("showcap");
    if (!el) return;
    el.textContent = text;
    el.classList.add("show");
  }
  function hideCaption() {
    var el = $("showcap");
    if (el) el.classList.remove("show");
  }
  // replay the expert's attention path in the trainee's own screen, in order,
  // ~900 ms apart. Values are never filled in.
  function replayPath(steps) {
    var path = (steps || []).slice();
    var i = 0;
    clearTimeout(T.showme);
    function step() {
      if (i >= path.length) {
        later("showme", 1600, hideCaption);
        return;
      }
      var s = path[i++] || {};
      var name = s.name;
      if (s.kind === "panel") openPanel(name); else revealLook(name);
      showCaption(EXPERT + " looked at the " + lowerFirst(humanName(name)) + "\u2026");
      later("showme", 900, step);
    }
    step();
  }
  function nudgeCard(level, text, look, showMe) {
    var cards = $("cards");
    if (!cards) return;
    var el = document.createElement("div");
    el.className = "card nudge";
    el.innerHTML = '<h4>' + (level >= 4 ? "Let\u2019s walk through it" : "A question") + '</h4>' +
      '<div class="say"></div>' +
      (level >= 3 && look.length ? '<div class="look"></div>' : "") +
      '<div class="acts">' + (showMe && showMe.length ? '<button class="btn accent" data-k="showme">Show me</button>' : "") +
      '<button class="btn" data-k="ok">I\u2019ll take it from here</button></div>';
    el.querySelector(".say").textContent = text || (level >= 4 ? "Take it one step at a time." : "Still with me?");
    if (level >= 3 && look.length) {
      el.querySelector(".look").textContent = "Look at: " + look.map(humanName).join(" \u00b7 ");
    }
    var smb = el.querySelector('[data-k="showme"]');
    if (smb) smb.onclick = function () { smb.textContent = "Showing\u2026"; replayPath(showMe); };
    el.querySelector('[data-k="ok"]').onclick = function () {
      el.remove(); NUDGE.level = 0; W.classList.remove("nudged");
    };
    cards.innerHTML = "";
    cards.appendChild(el);
  }
  function nudge(m) {
    m = m || {};
    var level = Math.max(0, Math.min(4, Number(m.level) || 0));
    var look = m.look || [];
    NUDGE = { level: level, text: m.text || "", look: look, case_id: m.case_id || lastCase };
    var cards = $("cards");
    if (level === 0) {
      if (cards) cards.innerHTML = "";
      W.classList.remove("nudged");
      render();
      return;
    }
    if (level === 1) {  // the cue is only the badge
      if (cards) cards.innerHTML = "";
      render();
      return;
    }
    nudgeCard(level, NUDGE.text, look, m.show_me);
    if (level >= 3) look.forEach(revealLook);  // level 3 points where to look
    render();
  }

  // ------------------------------------------- end-of-practice tutor summary
  // When the trainee finishes (the Finish button) or the last case is done, the
  // engine sends tutor_summary. It is the report card: what is solid, what to
  // practise next, and the first-try score. This only reads it; leaving for the
  // next case is the trainee's click, through the app's own router when it has one.
  function pctOf(p) {
    var n = Number(p);
    if (p == null || isNaN(n)) return "";
    return Math.round(n * 100) + "%";
  }
  function reasonFor(status) {
    var s = String(status == null ? "" : status).toLowerCase();
    if (s === "shaky") return "still shaky";
    if (s === "practice") return "needs practice";
    if (s === "unseen" || s === "not seen yet") return "not tried yet";
    return s;
  }
  function summaryList(title, items, mark, mastered) {
    var box = document.createElement("div"); box.className = "sumb";
    var h = document.createElement("h5"); h.textContent = title; box.appendChild(h);
    var ul = document.createElement("ul"); ul.className = "sum";
    if (!items.length) {
      var li0 = document.createElement("li"); li0.className = "empty";
      var n0 = document.createElement("span"); n0.className = "none";
      n0.textContent = mastered ? "Nothing confirmed yet \u2014 keep going." : "Nothing queued \u2014 nice.";
      li0.appendChild(n0); ul.appendChild(li0);
    } else {
      items.forEach(function (it) {
        it = it || {};
        var li = document.createElement("li");
        var i = document.createElement("i"); i.className = mark; i.textContent = mastered ? "\u2713" : "\u25cc";
        var t = document.createElement("span"); t.className = "t"; t.textContent = it.title || it.id || "\u2014";
        li.appendChild(i); li.appendChild(t);
        if (!mastered) {
          var why = document.createElement("span"); why.className = "why"; why.textContent = reasonFor(it.status);
          li.appendChild(why);
        }
        var pp = pctOf(it.p);
        if (pp) { var pEl = document.createElement("span"); pEl.className = "pp"; pEl.textContent = pp; li.appendChild(pEl); }
        ul.appendChild(li);
      });
    }
    box.appendChild(ul);
    return box;
  }
  function openNextCase(id) {
    if (id == null || id === "") return false;
    try {
      if (window.shadowERP && typeof window.shadowERP.open === "function") { window.shadowERP.open(id); return true; }
    } catch (e) {}
    // generic fallback: only swap the id already in the current path, never guess a route
    var path = location.pathname || "";
    if (lastCase && path.indexOf(lastCase) >= 0) { location.pathname = path.split(lastCase).join(String(id)); return true; }
    return false;
  }
  // the Finish button asks the engine for the summary; the engine may also send it on its own
  function finishPractice() {
    if (!SID) return;
    var b = $("b-finish");
    if (b) { b.disabled = true; b.textContent = "Finishing\u2026"; }
    think();
    send({ type: "finish_practice" });
    later("finish", 8000, function () {  // the socket may be offline; never leave the button stuck
      var x = $("b-finish");
      if (x && x.disabled) { x.disabled = false; x.textContent = "Finish practice"; }
    });
  }
  function tutorSummary(m) {
    m = m || {};
    var cards = $("cards");
    if (!cards) return;
    clearTimeout(T.finish);
    var b = $("b-finish");
    if (b) { b.disabled = false; b.textContent = "Finish practice"; }
    var ind = m.independent || {};
    var el = document.createElement("div");
    el.className = "card summary";
    var h = document.createElement("h4"); h.textContent = "Practice summary"; el.appendChild(h);
    var top = document.createElement("div"); top.className = "sumtop";
    top.appendChild(document.createTextNode((m.learner ? m.learner + " \u00b7 " : "") + "first try, on your own: "));
    if (ind.of) {
      var sb = document.createElement("b"); sb.textContent = (ind.ok || 0) + " of " + ind.of; top.appendChild(sb);
    } else {
      top.appendChild(document.createTextNode("no independent tries yet"));
    }
    el.appendChild(top);
    el.appendChild(summaryList("What you\u2019ve mastered", m.mastered || [], "tick", true));
    el.appendChild(summaryList("Practise next", m.practice || [], "ring", false));
    var acts = document.createElement("div"); acts.className = "acts";
    if (m.next_case != null && m.next_case !== "") {
      var nb = document.createElement("button"); nb.className = "btn accent"; nb.type = "button"; nb.textContent = "Next case";
      nb.onclick = function () { nb.textContent = "Opening\u2026"; openNextCase(m.next_case); };
      acts.appendChild(nb);
    }
    var ok = document.createElement("button"); ok.className = "btn"; ok.type = "button"; ok.textContent = "Close";
    ok.onclick = function () { el.remove(); };
    acts.appendChild(ok);
    el.appendChild(acts);
    cards.innerHTML = "";
    cards.appendChild(el);
    F.open = false; render();
  }

  // interactions
  function askNow() { if (!F.hand) return; send({ type: "ask_now" }); F.hand = false; think(); render(); }
  function askLater() { send({ type: "ask_later" }); F.hand = false; render(); }
  function toggleRecord() {
    var off = !F.off;
    F.off = off; if (off) { F.hand = false; F.asking = false; } render();
    if (!SID) return;
    fetch(API + "/api/sessions/" + SID + "/record", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ off: off })
    }).catch(function () { F.off = !off; F.offline = true; render(); });
  }

  // ------------------------------------------------------------- voice (ElevenLabs, inside the observed app)
  // Tacet decides what to say (server, via the agents' Custom LLM); this only starts the conversation,
  // triggers turns at the moments Tacet picks, and reports who is speaking for pause detection.
  var V = { conv: null, role: null, status: "off", speaking: false, userTalking: false, quiet: 0 };

  function voiceStatus(t) { V.status = t; var el = $("v-st"); if (el) { el.hidden = !t || t === "off"; $("v-t").textContent = t; } render(); }

  function api(path, body) {
    return fetch(API + path, body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (data) { if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Tacet could not complete that request."); return data; }); });
  }

  function ensureSession() {
    if (SID) return Promise.resolve(SID);
    if (GENERIC_PAGE) { learnTask(); return Promise.reject(new Error("Show this task first.")); }
    return api("/api/sessions", { mode: "capture" }).then(function (snap) {
      pinSession(snap.id, snap.mode);  // remember it across navigation and reloads
      send({ type: "hello" });
      return SID;
    });
  }

  function startVoice() {
    if (V.conv) return Promise.resolve();
    voiceStatus("connecting…");
    var role = MODE === "tutor" ? "tutor" : "interviewer";
    return Promise.all([ensureSession(), api("/api/config"), Promise.resolve(window.ElevenLabsClient)]).then(function (r) {
      var agentId = (r[1].agents || {})[role];
      if (!agentId) throw new Error("no " + role + " agent — run scripts/setup_elevenlabs.py");
      return r[2].Conversation.startSession({
        agentId: agentId,
        libsampleratePath: window.__tacetVoiceResources.libsampleratePath,
        workletPaths: window.__tacetVoiceResources.workletPaths,
        connectionType: "websocket",
        dynamicVariables: { shadow_session: SID, shadow_mode: MODE || "capture" },
        customLlmExtraBody: { shadow_session: SID },
        onConnect: function () { voiceStatus(role === "tutor" ? "tutor listening" : "listening"); },
        onDisconnect: function () { V.conv = null; voiceStatus("off"); },
        onError: function (msg) { voiceStatus("voice error: " + msg); },
        onModeChange: function (m) {
          V.speaking = m.mode === "speaking";
          send({ type: "speech", who: "agent", speaking: V.speaking });
          voiceStatus(V.speaking ? "speaking" : (role === "tutor" ? "tutor listening" : "listening"));
        },
        onVadScore: function (v) {
          var now = Date.now();
          if (v.vadScore > 0.6 && !V.userTalking) { V.userTalking = true; send({ type: "speech", who: "user", speaking: true }); }
          if (v.vadScore < 0.3) {
            if (!V.quiet) V.quiet = now;
            if (V.userTalking && now - V.quiet > 600) { V.userTalking = false; send({ type: "speech", who: "user", speaking: false }); }
          } else { V.quiet = 0; }
        }
      });
    }).then(function (conv) { V.conv = conv; V.role = role; }).catch(function (e) {
      V.conv = null;
      var msg = /permission|notallowed|denied/i.test(String(e && (e.name + " " + e.message)))
        ? "Microphone blocked. Allow the mic for this site (or open it in Chrome), then press Talk again."
        : "Voice couldn\u2019t start: " + e.message;
      voiceStatus(msg);
      toast([msg], "amber");
      F.open = true; render();
    });
  }

  function stopVoice() { var c = V.conv; V.conv = null; if (c) c.endSession(); voiceStatus("off"); }
  function say(tag) { if (V.conv) V.conv.sendUserMessage(tag); }

  function startDebrief() {
    if (!SID) return;
    api("/api/sessions/" + SID + "/debrief", {}).then(function () {
      MODE = "debrief"; render();
      if (V.conv) say("[[shadow:debrief]]");
      else api("/api/sessions/" + SID + "/utterance", { text: "[[shadow:debrief]]" });
    }).catch(function (e) { toast([e.message]); });
  }

  function teachLena() {
    var from = SID;
    stopVoice();
    api("/api/sessions", { mode: "tutor", pack: WORKFLOW ? WORKFLOW.id : "ap_invoices", trainee: NOVICE, from_session: from, simulate: SIMULATED }).then(function (snap) {
      if (GENERIC_PAGE) { useSession(snap); return; }
      pinSession(snap.id, "tutor");  // remembered for the tab, so the reload lands in the tutor session
      setTimeout(function () { location.href = "/?shadow=" + snap.id; }, 200);  // inbox shows the new hire's cases
    }).catch(function () { toast(["Couldn\u2019t start tutoring \u2014 is a Work Map saved yet?"]); });
  }
  if (sessionStorage.getItem("shadow.voice") === "on") setTimeout(function () { if (SID) startVoice(); }, 1500);

  var _onServer = onServer;
  onServer = function (m) {
    _onServer(m);
    if (m.type === "nudge") nudge(m);  // learner guide: cue, question, highlight or show me
    if (m.type === "tutor_summary") tutorSummary(m);  // end of practice: the trainee's report card
    if (m.type === "ask" && MODE !== "tutor") say("[[shadow:ask " + m.inquiry.id + "]]");
    if (m.type === "intervene" && m.intervention && m.intervention.id) say("[[shadow:intervene " + m.intervention.id + "]]");
    if (m.type === "tutor_case" && m.prompt) {  // proactive coaching as a case opens: where to look, predict first
      F.asking = true; F.askText = m.prompt; render();
      say("[[shadow:say " + m.prompt.replace(/[\[\]]/g, "") + "]]");
    }
    if (m.type === "session" || m.type === "mode") {
      var want = MODE === "tutor" ? "tutor" : "interviewer";
      if (V.conv && V.role !== want) { stopVoice(); startVoice(); }
    }
  };

  $("kid").addEventListener("click", function () {
    if (F.hand) { askNow(); return; }
    clearTimeout(T.open); F.open = !F.open; render();
  });
  $("later").addEventListener("click", function (e) { e.stopPropagation(); askLater(); });
  $("cap-in").addEventListener("keydown", function (e) {
    e.stopPropagation();  // typing an answer is not expert activity on the ERP
    if (e.key !== "Enter") return;
    var text = e.target.value.trim();
    if (!text || !SID) return;
    e.target.value = "";
    F.asking = false; think(); render();
    api("/api/sessions/" + SID + "/utterance", { text: text }).then(function (r) {
      if (r.reply) toast([r.reply], "amber");
    }).catch(function () {});
  });
  $("b-voice").addEventListener("click", function (e) {
    e.stopPropagation();
    if (V.conv) { sessionStorage.removeItem("shadow.voice"); stopVoice(); }
    else { sessionStorage.setItem("shadow.voice", "on"); startVoice(); }
  });
  $("b-debrief").addEventListener("click", function (e) { e.stopPropagation(); startDebrief(); });
  $("b-teach").addEventListener("click", function (e) { e.stopPropagation(); teachLena(); });
  $("b-ask").addEventListener("click", askNow);
  $("b-off").addEventListener("click", toggleRecord);
  $("kid").addEventListener("mouseenter", function () {
    clearTimeout(T.close);
    later("open", 400, function () { F.open = true; render(); });
  });
  $("kid").addEventListener("mouseleave", function () { clearTimeout(T.open); });
  W.addEventListener("mouseenter", function () { clearTimeout(T.close); });
  W.addEventListener("mouseleave", function () {
    clearTimeout(T.open);
    later("close", 350, function () { F.open = false; render(); });
  });

  // pupils follow the pointer, very slightly
  var raf = 0, mx = 0, my = 0;
  document.addEventListener("mousemove", function (e) {
    mx = e.clientX; my = e.clientY;
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      var r = host.getBoundingClientRect();
      var dx = mx - (r.left + 28), dy = my - (r.top + 24), d = Math.hypot(dx, dy) || 1;
      var k = Math.min(1, d / 300) * 1.1;
      var p = root.querySelector(".pupils");
      if (p) p.style.transform = "translate(" + (dx / d * k).toFixed(2) + "px," + (dy / d * k).toFixed(2) + "px)";
    });
  }, { passive: true });

  function overlay(iv) {
    if (!iv) return;
    var cards = $("cards");
    NUDGE.level = 0; W.classList.remove("nudged");  // the stop card replaces a nudge
    // the hint ladder decides how much to reveal; the expert's words come at their rung, or on request (replay)
    var quote = iv.violation && iv.violation.quote && (!iv.hint || iv.hint.quote) ?
      (iv.violation.quote.translation || iv.violation.quote.text) : null;
    var showMe = iv.show_me || [];
    var el = document.createElement("div");
    el.className = "card";
    el.innerHTML = '<h4>Mira stepped in</h4><div class="say"></div>' + (quote ? "<q></q>" : "") +
      (showMe.length ? '<div class="look"></div>' : "") +
      '<div class="acts">' + (showMe.length ? '<button class="btn accent" data-k="showme">Show me</button>' : "") +

      '<button class="btn" data-k="ok">Got it</button></div>';
    el.querySelector(".say").textContent = (iv.say || "Let's pause here.") + (iv.hint && iv.hint.text ? " " + iv.hint.text : "");
    if (quote) el.querySelector("q").textContent = quote;
    if (showMe.length) el.querySelector(".look").textContent = "Where " + EXPERT + " looked on a case like this.";
    var sm = el.querySelector('[data-k="showme"]');
    if (sm) {
      sm.onclick = function () {
        sm.textContent = "Showing\u2026";
        replayPath(showMe);  // in the trainee's own screen, one step at a time
      };
    }
    el.querySelector('[data-k="ok"]').onclick = function () { el.remove(); };
    cards.innerHTML = "";
    cards.appendChild(el);
    F.open = false; render();
  }

  render();
  wireObserver();
  if (PINNED) api("/api/sessions/" + PINNED).then(function (snap) {
    if (snap.ended) { unpinSession(); return; }
    WORKFLOW = snap.pack; SIMULATED = !!snap.simulated; EXPERT = snap.expert; MODE = snap.mode; render();
  }).catch(function () { unpinSession(); toast(["That session is no longer available. Continue its saved workflow or show a new task."]); });
  loadConfig();  // fetched once: resolves the notebook URL (console_url, else the API origin)
  connect();
})();
