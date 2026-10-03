/* Shadow capture script — loaded by the observed app (e.g. the sandbox ERP).
 *
 * Sends semantic events (what was opened, which field changed, which panel the
 * expert looked at) and activity *kinds* (typing / scrolling / pointer) to
 * Shadow. It never sends keystroke contents. It also exposes
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
  var CONSOLE = window.SHADOW_CONSOLE || "http://localhost:5173";
  var EXPERT = window.SHADOW_EXPERT || "Sabine";
  var NOVICE = window.SHADOW_NOVICE || "Lena";
  var qs = new URLSearchParams(location.search);
  var PINNED = qs.get("shadow") || null;  // ?shadow=<id> pins a session; otherwise follow the latest
  var SID = PINNED;
  var MODE = null;
  var ws = null, outbox = [], lastCase = null;

  // companion state
  var F = { off: false, hand: false, handId: null, asking: false, askText: "", thinking: false, learned: false,
            busy: false, offline: true, guess: false, open: false };
  var M = { rules_learned: null, rules_confirmed: null, questions_live: null };
  var T = {};
  function later(name, ms, fn) { clearTimeout(T[name]); T[name] = setTimeout(fn, ms); }

  function connect() {
    try { ws = new WebSocket(API.replace(/^http/, "ws") + "/ws/capture" + (PINNED ? "?session=" + PINNED : "")); }
    catch (e) { F.offline = true; render(); setTimeout(connect, 3000); return; }
    ws.onopen = function () {
      F.offline = false; render();
      outbox.splice(0).forEach(function (m) { ws.send(m); });
      send({ type: "hello" });
    };
    ws.onmessage = function (e) {
      var m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      try { onServer(m); } catch (err) { /* never let UI break capture */ }
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
          var iv = { say: "Shadow tutor is unreachable \u2014 try saving again in a moment." };
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
      case "intervene": overlay(m.intervention); break;
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

  // ------------------------------------------------------------- UI (shadow DOM, never clashes with the app)
  var INK = "#141a23", LINE = "#e3e9f0";
  var SVG =
    '<svg viewBox="0 0 64 64" aria-hidden="true">' +
    '<circle class="glow" cx="32" cy="38" r="20"/>' +
    '<g class="fig">' +
      '<path class="ink" d="M13 63 C13 47 21 40.5 32 40.5 C43 40.5 51 47 51 63 Z"/>' +
      '<path class="ink" d="M29 36 h6 v6 h-6z"/>' +
      '<circle class="ink" cx="32" cy="26" r="11"/>' +
      '<path class="hair" d="M21.5 24 C22 16 28 13.6 33 14 C39 14.4 43 18.5 42.6 24.5 C39.5 19.5 33 18.4 27.5 20.6 C25 21.6 23 22.6 21.5 24 Z"/>' +
      '<g class="blink"><g class="eyes">' +
        '<circle class="lens" cx="27.4" cy="27.4" r="3.5"/><circle class="lens" cx="36.6" cy="27.4" r="3.5"/>' +
        '<path class="lens" d="M30.9 27 q1.1 -0.9 2.2 0"/>' +
        '<g class="pupils"><circle cx="27.4" cy="27.6" r="1"/><circle cx="36.6" cy="27.6" r="1"/></g>' +
      '</g></g>' +
      '<g class="arm"><path d="M45.5 47 C49 39 51 29 51 20.5"/><circle cx="51" cy="18" r="3.1"/></g>' +
      '<g class="book">' +
        '<rect class="cover" x="20.5" y="43" width="23" height="14.5" rx="2"/>' +
        '<rect class="pg" x="22" y="44.4" width="9.6" height="11.6" rx="1"/>' +
        '<rect class="pg" x="32.4" y="44.4" width="9.6" height="11.6" rx="1"/>' +
        '<rect class="pg flip" x="32.4" y="44.4" width="9.6" height="11.6" rx="1"/>' +
        '<path class="lines" d="M24 47.5h5.5M24 50h5.5M24 52.5h4M34.5 47.5h5.5M34.5 50h4"/>' +
        '<circle class="guess" cx="39.3" cy="53.4" r="1.25"/>' +
      '</g>' +
      '<g class="gcap"><path d="M18.5 17.8 L32 11.6 L45.5 17.8 L32 24 Z"/><path d="M25 20.6 v4 c0 1.8 14 1.8 14 0 v-4"/>' +
        '<path class="tassel" d="M44.6 18.4 v5.8"/><circle class="tassel-k" cx="44.6" cy="25" r="1.1"/></g>' +
    '</g>' +
    '<g class="dots"><circle cx="17" cy="13" r="1.5"/><circle cx="11.5" cy="8.5" r="2"/><circle cx="5" cy="4" r="2.6"/></g>' +
    '<g class="qb"><circle cx="57" cy="7.5" r="6.6"/><text x="57" y="10.9" text-anchor="middle">?</text></g>' +
    '<g class="sparks"><path d="M10 34 l1 -3 l1 3 l3 1 l-3 1 l-1 3 l-1 -3 l-3 -1z"/>' +
      '<path d="M53 30 l.8 -2.4 l.8 2.4 l2.4 .8 l-2.4 .8 l-.8 2.4 l-.8 -2.4 l-2.4 -.8z"/>' +
      '<path d="M47 8 l.7 -2 l.7 2 l2 .7 l-2 .7 l-.7 2 l-.7 -2 l-2 -.7z"/></g>' +
    '<g class="okc"><circle cx="52" cy="52" r="6.2"/><path d="M48.9 52.1 l2.2 2.2 l4 -4.3"/></g>' +
    '</svg>';

  var CSS =
    ':host{all:initial}' +
    '#w{--ink:' + INK + ';--line:' + LINE + ';--glow:rgba(120,170,255,.38);--amber:#f5b544;--green:#3ddc97;' +
    'position:relative;width:56px;height:56px;font:13px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#e9eef4}' +
    '.kid{all:unset;display:block;width:56px;height:56px;cursor:pointer;opacity:.35;transition:opacity .7s ease,filter .7s ease;' +
    '-webkit-tap-highlight-color:transparent}' +
    '.kid:focus-visible{outline:1px solid rgba(120,170,255,.6);outline-offset:2px;border-radius:50%}' +
    'svg{width:56px;height:56px;overflow:visible;display:block}' +
    '.fig{transform-box:view-box;transform-origin:32px 63px;animation:breathe 5.5s ease-in-out infinite}' +
    '@keyframes breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.022) translateY(-.4px)}}' +
    '.ink{fill:var(--ink)}.hair{fill:#232c38}' +
    '.glow{fill:var(--glow);filter:blur(7px);opacity:.55;transition:fill .6s,opacity .6s}' +
    '.lens{fill:none;stroke:var(--line);stroke-width:1;stroke-linecap:round}' +
    '.pupils circle{fill:var(--line)}.pupils{transition:transform .25s ease-out}' +
    '.blink{transform-box:view-box;transform-origin:32px 27.4px;animation:blink 7s infinite}' +
    '@keyframes blink{0%,95%,100%{transform:scaleY(1)}97%{transform:scaleY(.12)}}' +
    '.arm{transform-box:view-box;transform-origin:45.5px 47px;transform:rotate(145deg);opacity:0;' +
    'transition:transform .5s cubic-bezier(.3,1.5,.5,1),opacity .25s}' +
    '.arm path{fill:none;stroke:var(--ink);stroke-width:4.6;stroke-linecap:round}.arm circle{fill:var(--ink)}' +
    '.book{transition:transform .55s cubic-bezier(.4,1.2,.5,1)}' +
    '.cover{fill:#2b3646}.pg{fill:#efe9dc;opacity:.93}.lines{stroke:#b9b2a2;stroke-width:.6;stroke-linecap:round}' +
    '.flip{transform-box:view-box;transform-origin:32.2px 50px;opacity:0}' +
    '.guess{fill:#6fa6ff;opacity:0;transition:opacity .5s}' +
    '.gcap{opacity:0;transform:translateY(-5px);transition:opacity .5s,transform .5s}' +
    '.gcap path{fill:var(--ink);stroke:var(--line);stroke-width:.5;stroke-linejoin:round}' +
    '.gcap .tassel{fill:none;stroke:var(--amber);stroke-width:.8}.tassel-k{fill:var(--amber)}' +
    '.dots circle{fill:#9fc1ff;opacity:0}' +
    '.qb{transform-box:view-box;transform-origin:57px 7.5px;transform:scale(0);transition:transform .35s cubic-bezier(.3,1.6,.5,1) .15s}' +
    '.qb circle{fill:var(--amber)}.qb text{font:700 9.5px ui-sans-serif,system-ui;fill:var(--ink)}' +
    '.sparks path{fill:var(--green);opacity:0;transform-box:fill-box;transform-origin:center}' +
    '.okc{opacity:0;transform-box:view-box;transform-origin:52px 52px}' +
    '.okc circle{fill:var(--green)}.okc path{fill:none;stroke:#0b1a12;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}' +
    '.ring{position:absolute;inset:4px;border-radius:50%;border:1px solid rgba(160,190,230,.35);opacity:0;pointer-events:none}' +
    // state cascade (later = higher priority)
    '#w.busy .kid{opacity:.2}' +
    '#w.thinking .kid{opacity:.6}#w.thinking{--glow:rgba(120,170,255,.6)}' +
    '#w.thinking .flip{animation:flip .9s ease-in-out infinite;opacity:1}' +
    '@keyframes flip{0%{transform:scaleX(1)}50%{transform:scaleX(0)}100%{transform:scaleX(-1)}}' +
    '#w.thinking .dots circle{animation:dot 1.5s ease-in-out infinite}' +
    '#w.thinking .dots circle:nth-child(2){animation-delay:.2s}#w.thinking .dots circle:nth-child(3){animation-delay:.4s}' +
    '@keyframes dot{0%,100%{opacity:0;transform:translateY(1px)}40%,60%{opacity:.9;transform:translateY(-1px)}}' +
    '#w.guess .guess{opacity:.9}#w.tutor .gcap{opacity:1;transform:none}' +
    '#w.learned .kid{opacity:.95}#w.learned{--glow:rgba(61,220,151,.6)}' +
    '#w.hand .kid{opacity:.95}#w.hand{--glow:rgba(245,181,68,.45)}' +
    '#w.hand .arm{transform:rotate(0);opacity:1;animation:wave 2.6s ease-in-out .6s infinite}' +
    '@keyframes wave{0%,100%{transform:rotate(0)}50%{transform:rotate(-7deg)}}' +
    '#w.hand .qb{transform:scale(1)}' +
    '#w.asking .kid{opacity:1}#w.asking{--glow:rgba(245,181,68,.85)}#w.asking .glow{opacity:.9}' +
    '#w.off .kid{opacity:.4;filter:grayscale(1)}#w.off .book{transform:translateY(-20.5px)}#w.off{--glow:transparent}' +
    '#w.offline .kid{opacity:.16;filter:grayscale(.8)}' +
    '#w:hover .kid,#w.open .kid{opacity:1}' +
    '#w.spark .sparks path{animation:spark 1.3s ease-out}' +
    '#w.spark .sparks path:nth-child(2){animation-delay:.12s}#w.spark .sparks path:nth-child(3){animation-delay:.24s}' +
    '@keyframes spark{0%{opacity:0;transform:scale(.2) rotate(0)}35%{opacity:1;transform:scale(1.2) rotate(30deg)}100%{opacity:0;transform:scale(.6) rotate(70deg)}}' +
    '#w.okc .okc{animation:okc 1.6s ease-out}' +
    '@keyframes okc{0%{opacity:0;transform:scale(.3)}25%{opacity:1;transform:scale(1.1)}80%{opacity:1;transform:scale(1)}100%{opacity:0}}' +
    '#w.hush .ring{animation:hush 1.2s ease-out}' +
    '@keyframes hush{0%{opacity:.5;transform:scale(.9)}100%{opacity:0;transform:scale(1.25)}}' +
    // later chip
    '.later{all:unset;position:absolute;right:58px;bottom:18px;padding:3px 8px;border-radius:999px;cursor:pointer;' +
    'font:600 10.5px ui-sans-serif,system-ui;color:#cfd8e3;background:rgba(14,19,27,.85);border:1px solid rgba(255,255,255,.1);' +
    'opacity:0;transform:translateX(4px);pointer-events:none;transition:opacity .25s,transform .25s}' +
    '#w.hand:hover .later{opacity:1;transform:none;pointer-events:auto}.later:hover{color:#fff}' +
    // stack above the student
    '.stack{position:absolute;right:0;bottom:64px;display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none}' +
    '.stack>*{pointer-events:auto}' +
    '.pop{opacity:0;transform:translateY(6px) scale(.98);transform-origin:bottom right;transition:opacity .3s ease,transform .3s ease;' +
    'pointer-events:none;visibility:hidden}' +
    '.pop.show{opacity:1;transform:none;pointer-events:auto;visibility:visible}' +
    '.bubble{max-width:240px;background:#141a23;color:#f4efe4;border:1px solid rgba(245,181,68,.65);border-radius:12px 12px 4px 12px;' +
    'padding:8px 11px;font-size:13px;line-height:1.38;box-shadow:0 8px 28px rgba(0,0,0,.28),0 0 18px rgba(245,181,68,.15)}' +
    '.bubble span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
    '.bubble:hover span{display:block}' +
    '.bubble .hint{margin-top:6px;font-size:11px;color:#f5b544;opacity:.9}' +
    '.bubble input{all:unset;box-sizing:border-box;display:block;width:100%;margin-top:6px;padding:5px 8px;' +
    'border-radius:7px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);font-size:12px;color:#f4efe4;pointer-events:auto}' +
    '.bubble input::placeholder{color:rgba(244,239,228,.45)}' +
    '.toast{max-width:250px;background:#141a23;border:1px solid rgba(61,220,151,.55);border-radius:10px;padding:7px 10px;' +
    'font-size:12px;box-shadow:0 8px 24px rgba(0,0,0,.25)}.toast b{color:var(--green);font-weight:600}.toast div+div{color:#9fb0c2}' +
    '.glass{width:260px;box-sizing:border-box;background:rgba(14,19,27,.9);-webkit-backdrop-filter:blur(14px) saturate(1.3);' +
    'backdrop-filter:blur(14px) saturate(1.3);border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:12px 14px;' +
    'box-shadow:0 14px 44px rgba(0,0,0,.35);font-size:12.5px}' +
    '.glass h5{margin:0 0 2px;font:600 13px ui-sans-serif,system-ui;color:#f2f5f8}' +
    '.glass .st{color:#9fb0c2;margin-bottom:9px}.glass .st i{display:inline-block;width:6px;height:6px;border-radius:50%;' +
    'background:var(--green);margin-right:6px;vertical-align:1px}' +
    '#w.off .glass .st i,#w.offline .glass .st i{background:#7d8894}#w.hand .glass .st i,#w.asking .glass .st i{background:var(--amber)}' +
    '.row{display:flex;justify-content:space-between;padding:3px 0;color:#c4cfdb;border-top:1px solid rgba(255,255,255,.05)}' +
    '.row b{color:#f2f5f8;font-weight:600}' +
    '.acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}' +
    '.btn{all:unset;cursor:pointer;padding:5px 9px;border-radius:8px;font:600 11.5px ui-sans-serif,system-ui;color:#e9eef4;' +
    'background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);transition:background .2s}' +
    '.btn:hover{background:rgba(255,255,255,.14)}.btn.amber{background:var(--amber);color:#1a1307;border-color:transparent}' +
    '.btn[hidden]{display:none}' +
    '.nb{display:block;margin-top:9px;color:#8fb6ff;text-decoration:none;font-size:11.5px}.nb:hover{text-decoration:underline}' +
    '.card{width:340px;box-sizing:border-box;background:#141a23;color:#e9eef4;border:1px solid var(--amber);border-radius:14px;' +
    'padding:14px 16px;box-shadow:0 14px 44px rgba(0,0,0,.38),0 0 24px rgba(245,181,68,.12);animation:in .35s ease}' +
    '@keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}' +
    '.card h4{margin:0 0 6px;font:600 11px ui-sans-serif,system-ui;letter-spacing:.08em;text-transform:uppercase;color:var(--amber)}' +
    '.card .say{font-size:16px;line-height:1.4;color:#f6f2ea}' +
    '.card q{display:block;margin-top:9px;color:#b8c4d0;font-style:italic;font-size:13px}' +
    '@media (prefers-reduced-motion:reduce){*{animation:none!important;transition-duration:.01ms!important}' +
    '#w.thinking .flip,#w.thinking .dots circle{opacity:.8}#w.spark .sparks path{opacity:1}}';

  var host = document.createElement("div");
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
  var root = host.attachShadow({ mode: "open" });
  root.innerHTML = '<style>' + CSS + '</style>' +
    '<div id="w">' +
      '<div class="stack">' +
        '<div id="cards"></div>' +
        '<div class="glass pop" id="hc" role="dialog" aria-label="Shadow">' +
          '<h5 id="hc-t"></h5><div class="st"><i></i><span id="hc-s"></span></div>' +
          '<div class="row"><span>Rules learned</span><b id="m-rl">\u2014</b></div>' +
          '<div class="row"><span>Rules confirmed</span><b id="m-rc">\u2014</b></div>' +
          '<div class="row"><span>Questions asked</span><b id="m-q">\u2014</b></div>' +
          '<div class="acts"><button class="btn amber" id="b-voice">Start Shadow</button>' +
          '<button class="btn amber" id="b-ask" hidden>Ask me now</button>' +
          '<button class="btn" id="b-debrief" hidden>Debrief me</button>' +
          '<button class="btn" id="b-teach" hidden>Teach Lena</button>' +
          '<button class="btn" id="b-off"></button></div>' +
          '<div class="st" id="v-st" hidden><span id="v-t"></span></div>' +
          '<a class="nb" id="nb" target="_blank" rel="noopener">Open Shadow\u2019s notebook \u2197</a>' +
        '</div>' +
        '<div class="bubble pop" id="cap"><span id="cap-t"></span>' +
          '<div class="hint" id="cap-h"></div>' +
          '<input id="cap-in" placeholder="\u2026or type your answer, then Enter" autocomplete="off"></div>' +
        '<div class="toast pop" id="toast"></div>' +
      '</div>' +
      '<button class="kid" id="kid" aria-label="Shadow companion">' + SVG + '</button>' +
      '<div class="ring"></div>' +
      '<button class="later" id="later" title="Ask at the end instead">later</button>' +
    '</div>';
  function mount() { if (document.body) document.body.appendChild(host); else setTimeout(mount, 50); }
  mount();

  var $ = function (id) { return root.getElementById(id); };
  var W = $("w");

  function stateLine() {
    if (F.offline) return "Offline \u2014 can\u2019t reach Shadow";
    if (F.off) return "Off the record \u2014 not watching";
    if (F.asking) return "Asked a question \u2014 listening";
    if (F.hand) return "Has a question \u2014 waiting for a pause";
    if (F.thinking) return "Thinking about what it just saw";
    if (MODE === "tutor") return "Watching quietly \u2014 will step in before a slip";
    if (MODE === "debrief") return "Debrief \u2014 going over open questions";
    return F.busy ? "Watching quietly (you\u2019re busy)" : "Watching quietly";
  }

  function renderVoice() {
    var bv = $("b-voice"); if (!bv) return;
    bv.textContent = V.conv ? "Stop voice" : (MODE === "tutor" ? "Start tutor" : "Start Shadow");
    $("b-debrief").hidden = !(V.conv && MODE === "capture");
    $("b-teach").hidden = !(SID && MODE !== "tutor");
  }
  function render() {
    var cls = [];
    ["off", "hand", "asking", "thinking", "learned", "busy", "offline", "guess", "open"].forEach(function (k) { if (F[k]) cls.push(k); });
    if (MODE === "tutor") cls.push("tutor");
    ["spark", "okc", "hush"].forEach(function (k) { if (W.classList.contains(k)) cls.push(k); });
    W.className = cls.join(" ");
    $("hc-t").textContent = MODE === "tutor" ? "Shadow tutor \u00b7 watching " + NOVICE : "Shadow \u00b7 learning from " + EXPERT;
    $("hc-s").textContent = stateLine();
    $("m-rl").textContent = M.rules_learned != null ? M.rules_learned : "\u2014";
    $("m-rc").textContent = M.rules_confirmed != null ? M.rules_confirmed : "\u2014";
    $("m-q").textContent = M.questions_live != null ? M.questions_live : "\u2014";
    $("b-ask").hidden = !F.hand;
    $("b-off").textContent = F.off ? "Back on the record" : "Off the record";
    $("b-off").title = "Alt+Shift+S";
    var nb = $("nb");
    renderVoice();
    if (SID) { nb.href = CONSOLE.replace(/\/$/, "") + "/s/" + SID; nb.style.display = ""; } else nb.style.display = "none";
    $("hc").classList.toggle("show", F.open);
    $("cap-t").textContent = F.askText;
    $("cap-h").textContent = V.conv ? "\ud83c\udf99 Shadow is listening \u2014 just answer out loud" : "Answer here \u2014 or click Start Shadow to talk";
    $("cap").title = F.askText;
    $("cap").classList.toggle("show", F.asking && !!F.askText);
    $("kid").setAttribute("aria-label", "Shadow \u2014 " + stateLine() + (F.off ? " (off the record)" : ""));
    $("kid").title = F.off ? "off the record" : "";
  }

  function flash(cls, ms) {
    W.classList.remove(cls); void W.offsetWidth; W.classList.add(cls);
    later("f-" + cls, ms, function () { W.classList.remove(cls); });
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
  // Shadow decides what to say (server, via the agents' Custom LLM); this only starts the conversation,
  // triggers turns at the moments Shadow picks, and reports who is speaking for pause detection.
  var V = { conv: null, role: null, status: "off", speaking: false, userTalking: false, quiet: 0 };
  var EL_CDN = "https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.26.0/+esm";

  function voiceStatus(t) { V.status = t; var el = $("v-st"); if (el) { el.hidden = !t || t === "off"; $("v-t").textContent = t; } render(); }

  function api(path, body) {
    return fetch(API + path, body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }

  function ensureSession() {
    if (SID) return Promise.resolve(SID);
    return api("/api/sessions", { mode: "capture" }).then(function (snap) {
      SID = snap.id; MODE = snap.mode; send({ type: "hello" }); return SID;
    });
  }

  function startVoice() {
    if (V.conv) return Promise.resolve();
    voiceStatus("connecting…");
    var role = MODE === "tutor" ? "tutor" : "interviewer";
    return Promise.all([ensureSession(), api("/api/config"), import(EL_CDN)]).then(function (r) {
      var agentId = (r[1].agents || {})[role];
      if (!agentId) throw new Error("no " + role + " agent — run scripts/setup_elevenlabs.py");
      return r[2].Conversation.startSession({
        agentId: agentId,
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
    }).then(function (conv) { V.conv = conv; V.role = role; }).catch(function (e) { V.conv = null; voiceStatus("couldn’t start: " + e.message); });
  }

  function stopVoice() { var c = V.conv; V.conv = null; if (c) c.endSession(); voiceStatus("off"); }
  function say(tag) { if (V.conv) V.conv.sendUserMessage(tag); }

  function startDebrief() {
    if (!SID) return;
    api("/api/sessions/" + SID + "/debrief", {}).then(function () { MODE = "debrief"; say("[[shadow:debrief]]"); render(); });
  }

  function teachLena() {
    var from = SID;
    stopVoice();
    api("/api/sessions", { mode: "tutor", trainee: NOVICE, from_session: from }).then(function (snap) {
      SID = snap.id; MODE = "tutor"; send({ type: "hello" }); render();
      setTimeout(function () { location.href = "/"; }, 300);  // reload so the inbox shows the new hire's cases
    });
  }
  if (sessionStorage.getItem("shadow.voice") === "on") setTimeout(function () { if (SID) startVoice(); }, 1500);

  var _onServer = onServer;
  onServer = function (m) {
    _onServer(m);
    if (m.type === "ask" && MODE !== "tutor") say("[[shadow:ask " + m.inquiry.id + "]]");
    if (m.type === "intervene" && m.intervention && m.intervention.id) say("[[shadow:intervene " + m.intervention.id + "]]");
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
    var quote = iv.violation && iv.violation.quote ? (iv.violation.quote.translation || iv.violation.quote.text) : null;
    var el = document.createElement("div");
    el.className = "card";
    el.innerHTML = '<h4>Shadow stepped in</h4><div class="say"></div>' + (quote ? "<q></q>" : "") +
      '<div class="acts">' + (iv.id ? '<button class="btn amber" data-k="replay"></button>' : "") +
      '<button class="btn" data-k="ok">Got it</button></div>';
    el.querySelector(".say").textContent = iv.say || "Let's pause here.";
    if (quote) el.querySelector("q").textContent = quote;
    var rb = el.querySelector('[data-k="replay"]');
    if (rb) {
      rb.textContent = "Show me how " + EXPERT + " did it";
      rb.onclick = function () { send({ type: "replay_request", intervention_id: iv.id }); rb.textContent = "Replaying\u2026"; };
    }
    el.querySelector('[data-k="ok"]').onclick = function () { el.remove(); };
    cards.innerHTML = "";
    cards.appendChild(el);
    F.open = false; render();
  }

  render();
  connect();
})();
