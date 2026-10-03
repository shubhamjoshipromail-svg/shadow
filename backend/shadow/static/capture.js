/* Shadow capture script — loaded by the observed app (e.g. the sandbox ERP).
 *
 * Sends semantic events (what was opened, which field changed, which panel the
 * expert looked at) and activity *kinds* (typing / scrolling / pointer) to
 * Shadow. It never sends keystroke contents. It also exposes
 * window.shadow.beforeSave, the save intercept the tutor uses to step in
 * before a guardrail is broken.
 */
(function () {
  if (window.__shadowCapture) return;
  window.__shadowCapture = true;

  var script = document.currentScript;
  var API = (window.SHADOW_API && window.SHADOW_API.indexOf("%") < 0 && window.SHADOW_API) ||
            (script ? new URL(script.src).origin : "http://localhost:8000");
  var qs = new URLSearchParams(location.search);
  var SID = qs.get("shadow") || null;
  var MODE = null;
  var ws = null, outbox = [], lastCase = null;

  function connect() {
    ws = new WebSocket(API.replace(/^http/, "ws") + "/ws/capture" + (SID ? "?session=" + SID : ""));
    ws.onopen = function () { outbox.splice(0).forEach(function (m) { ws.send(m); }); send({ type: "hello" }); };
    ws.onmessage = function (e) {
      var m = JSON.parse(e.data);
      if (m.type === "session") { SID = m.session; MODE = m.mode; badge(); }
      if (m.type === "mode") { MODE = m.mode; badge(); }
      if (m.type === "record") { badge(m.off_record); }
      if (m.type === "highlight" && window.shadowERP && window.shadowERP.highlight) window.shadowERP.highlight(m.field);
      if (m.type === "intervene") overlay(m.intervention);
    };
    ws.onclose = function () { setTimeout(connect, 1500); };
  }

  function send(evt) {
    evt.client_ts = Date.now() / 1000;
    if (SID) evt.session = SID;
    var s = JSON.stringify(evt);
    if (ws && ws.readyState === 1) ws.send(s); else outbox.push(s);
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
    if (cid && cid !== lastCase) { lastCase = cid; send({ type: "case_opened", case_id: cid }); }
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

  document.addEventListener("keydown", throttle(function () { send({ type: "input", kind: "key" }); }, 350), true);
  document.addEventListener("scroll", throttle(function () { send({ type: "input", kind: "scroll" }); }, 500), true);
  document.addEventListener("wheel", throttle(function () { send({ type: "input", kind: "scroll" }); }, 500), true);
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
        body: JSON.stringify({ session: SID, action: req.action, case_id: req.caseId || lastCase,
                               booking: req.booking || {}, reason: req.reason, approver: req.approver })
      }).then(function (r) { return r.json(); }).then(function (v) {
        if (!v.allow && v.intervention) {
          overlay(v.intervention);
          if (v.intervention.field && window.shadowERP && window.shadowERP.highlight) {
            window.shadowERP.highlight(v.intervention.field === "action" ? "cost_center" : v.intervention.field);
          }
        }
        return v;
      }).catch(function () { return { allow: true }; });
    }
  };

  // ------------------------------------------------------------- UI (shadow DOM, never clashes with the app)
  var host = document.createElement("div");
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
  var root = host.attachShadow({ mode: "open" });
  root.innerHTML =
    '<style>' +
    '.badge{font:600 11px/1 ui-sans-serif,system-ui;color:#e8eef5;background:#0f1720;border:1px solid #2a3a4a;' +
    'border-radius:999px;padding:7px 11px;display:flex;gap:7px;align-items:center;box-shadow:0 6px 24px rgba(0,0,0,.25)}' +
    '.dot{width:7px;height:7px;border-radius:50%;background:#3ddc97;box-shadow:0 0 0 3px rgba(61,220,151,.2)}' +
    '.off .dot{background:#9aa5b1;box-shadow:none}' +
    '.card{width:340px;margin-bottom:10px;background:#0f1720;color:#e8eef5;border:1px solid #f5b544;border-radius:12px;' +
    'padding:14px 16px;font:14px/1.45 ui-sans-serif,system-ui;box-shadow:0 12px 40px rgba(0,0,0,.35)}' +
    '.card h4{margin:0 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#f5b544}' +
    '.card q{display:block;margin-top:8px;color:#b8c4d0;font-style:italic}' +
    '.card button{margin-top:10px;background:#1d2a37;color:#e8eef5;border:1px solid #2a3a4a;border-radius:8px;' +
    'padding:6px 10px;cursor:pointer;font:600 12px ui-sans-serif,system-ui}' +
    '</style><div id="cards"></div><div class="badge" id="badge"><span class="dot"></span><span id="label">Shadow</span></div>';
  function mount() { if (document.body) document.body.appendChild(host); else setTimeout(mount, 50); }
  mount();

  function badge(off) {
    var b = root.getElementById("badge");
    var label = root.getElementById("label");
    if (off === true) { b.className = "badge off"; label.textContent = "Shadow · off the record"; return; }
    b.className = "badge";
    label.textContent = MODE === "tutor" ? "Shadow tutor · watching" : MODE === "debrief" ? "Shadow · debrief" : "Shadow · learning";
  }

  function overlay(iv) {
    if (!iv) return;
    var cards = root.getElementById("cards");
    var quote = iv.violation && iv.violation.quote ? (iv.violation.quote.translation || iv.violation.quote.text) : null;
    var el = document.createElement("div");
    el.className = "card";
    el.innerHTML = "<h4>Shadow stepped in</h4><div></div>" + (quote ? "<q></q>" : "") + "<button>Got it</button>";
    el.querySelector("div").textContent = iv.say || "Let's pause here.";
    if (quote) el.querySelector("q").textContent = quote;
    el.querySelector("button").onclick = function () { el.remove(); };
    cards.innerHTML = "";
    cards.appendChild(el);
  }

  connect();
})();
