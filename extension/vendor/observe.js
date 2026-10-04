/* Shadow — cold-start page observer ("watch me do this").
 *
 * A generic observer for ANY web page: no app cooperation, no data-shadow-*
 * contract, no UI, no network. It discovers the form controls and buttons that
 * already exist, infers a stable name and a human label for each, and reports
 * what changed. The host page decides where the events go (e.g. POST
 * /api/onboard or a capture session's /events).
 *
 * Events (window.shadowObserve.on(fn) receives each):
 *   {type:"observe", url, title, fields:[{name,label,kind,value_kind,options,value?}]}
 *   {type:"field_changed", url, field, before, after, kind, value_kind, redacted?}
 *   {type:"action", url, name, label}
 *
 * Privacy is enforced here, not by the host: passwords/hidden fields and
 * anything that looks like a card, IBAN, CVV, SSN, token or PIN never leave the
 * page. Free text is reported as a length only; short codes may be reported.
 *
 * API: window.shadowObserve = {snapshot(), on(fn), observe(), refresh()}.
 */
(function () {
  "use strict";

  var NAME = window.SHADOW_NAME || "Shadow"; // the product name lives here and nowhere else

  if (window.shadowObserve) return; // never install twice

  // ------------------------------------------------------------------ config
  var SHORT_CODE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,15}$/; // "T2", "SF-12", "NORTH"
  var EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var CARD_LIKE = /^(?:\d[ -]?){12,18}\d$/; // 13-19 digits, spaced or dashed
  var IBAN_LIKE = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;
  var SENSITIVE = /pass(word|phrase)?|secret|token|otp|cvv|cvc|card|credit|iban|bic|swift|ssn|social.?security|routing|account.?number|cvv|pin\b/i;
  var SHADOW_UI = "[data-shadow-ui],[data-shadow-ignore],#hc,#kid,#shadowUI,[data-shadow-panel]";
  var MAX_FIELDS = 400;
  var ROUTE_DEBOUNCE_MS = 250;

  var listeners = [];
  var baseline = {}; // name -> last seen safe value (or null)
  var lastSignature = "";
  var lastUrl = "";
  var lastClick = { name: "", t: 0 };
  var routeTimer = null;

  // ------------------------------------------------------------------ utils
  function norm(text) {
    return String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  }

  function slug(text, fallback) {
    var s = norm(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!s) s = fallback || "field";
    if (/^[0-9]/.test(s)) s = "f_" + s;
    return s;
  }

  function attr(el, name) {
    try {
      return el.getAttribute ? el.getAttribute(name) : null;
    } catch (e) {
      return null;
    }
  }

  function textOf(el) {
    if (!el) return "";
    return norm(el.innerText || el.textContent || el.value || "");
  }

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    if (el.disabled) return false;
    var r = el.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) return false;
    var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
    return true;
  }

  function insideShadowUI(el) {
    if (!el || !el.closest) return false;
    try {
      return !!el.closest(SHADOW_UI);
    } catch (e) {
      return false;
    }
  }

  function typeOf(el) {
    return String((el && (el.type || el.tagName)) || "").toLowerCase();
  }

  function sensitive(el) {
    if (!el) return true;
    var t = typeOf(el);
    if (t === "password" || t === "hidden") return true;
    var hay = [attr(el, "name"), attr(el, "id"), attr(el, "autocomplete"), attr(el, "placeholder"),
               attr(el, "aria-label"), labelFor(el)].join(" ");
    return SENSITIVE.test(hay);
  }

  function looksLikeSecret(value) {
    var v = norm(value);
    if (!v) return false;
    return EMAIL_LIKE.test(v) || CARD_LIKE.test(v) || IBAN_LIKE.test(v);
  }

  // ------------------------------------------------------------------ labels
  function labelFor(el) {
    if (!el) return "";
    var id = attr(el, "id");
    if (id) {
      try {
        var esc = window.CSS && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, "\\$&");
        var l = document.querySelector('label[for="' + esc + '"]');
        if (l) return textOf(l);
      } catch (e) { /* ignore */ }
    }
    var wrapped = el.closest ? el.closest("label") : null;
    if (wrapped) return textOf(wrapped);
    var aria = attr(el, "aria-label");
    if (aria) return norm(aria);
    var labelledby = attr(el, "aria-labelledby");
    if (labelledby) {
      var parts = labelledby.split(/\s+/).map(function (bid) {
        var n = document.getElementById(bid);
        return n ? textOf(n) : "";
      });
      var joined = norm(parts.join(" "));
      if (joined) return joined;
    }
    var ph = attr(el, "placeholder");
    if (ph) return norm(ph);
    var fieldset = el.closest ? el.closest("fieldset") : null;
    if (fieldset) {
      var legend = fieldset.querySelector("legend");
      if (legend) return textOf(legend);
    }
    var section = el.closest ? el.closest("section,form,div") : null;
    if (section) {
      var h = section.querySelector("h1,h2,h3,h4,h5,h6");
      if (h) return textOf(h);
    }
    var title = attr(el, "title");
    if (title) return norm(title);
    return norm(attr(el, "name") || attr(el, "id") || "");
  }

  function stableName(el, label) {
    var name = norm(attr(el, "name"));
    if (name && !/^(input|field|text|value)$/i.test(name)) return name;
    var id = norm(attr(el, "id"));
    if (id) return id;
    var base = slug(label || attr(el, "placeholder") || typeOf(el), "field");
    var same = 0;
    var all = document.querySelectorAll("input,select,textarea");
    for (var i = 0; i < all.length && i < MAX_FIELDS; i++) {
      if (all[i] === el) break;
      if (slug(labelFor(all[i]) || attr(all[i], "name") || attr(all[i], "id"), "field") === base) same++;
    }
    return same ? base + "_" + (same + 1) : base;
  }

  // -------------------------------------------------------------- value kinds
  function valueKind(el) {
    var tag = String(el.tagName || "").toLowerCase();
    if (tag === "select") return el.multiple ? "cat" : "cat";
    var t = typeOf(el);
    if (t === "checkbox") return "bool";
    if (t === "radio") return "cat";
    if (t === "number" || t === "range") return "num";
    if (t === "date" || t === "datetime-local" || t === "month" || t === "week" || t === "time") return "date";
    if (tag === "textarea") return "text";
    return "text";
  }

  function controlKind(el) {
    var tag = String(el.tagName || "").toLowerCase();
    if (tag === "select") return "select";
    if (tag === "textarea") return "textarea";
    return typeOf(el) || "text";
  }

  function optionsFor(el) {
    var tag = String(el.tagName || "").toLowerCase();
    var out = [];
    if (tag === "select") {
      var opts = el.options || [];
      for (var i = 0; i < opts.length; i++) {
        var v = opts[i].value;
        if (v !== "" && out.indexOf(v) < 0) out.push(v);
      }
    } else if (typeOf(el) === "radio" && attr(el, "name")) {
      var group = document.querySelectorAll('input[type="radio"][name="' + attr(el, "name").replace(/["\\]/g, "\\$&") + '"]');
      for (var j = 0; j < group.length; j++) {
        if (group[j].value !== "" && out.indexOf(group[j].value) < 0) out.push(group[j].value);
      }
    }
    return out;
  }

  // Safe reading: never returns a value for sensitive inputs; free text -> null.
  function safeValue(el) {
    if (!el || sensitive(el)) return { value: null, redacted: true, length: 0 };
    var vk = valueKind(el);
    var raw;
    if (typeOf(el) === "checkbox") raw = !!el.checked;
    else if (typeOf(el) === "radio") raw = el.checked ? el.value : null;
    else raw = el.value;
    var text = norm(raw);
    if (vk === "num") {
      var n = Number(text);
      return isNaN(n) ? { value: text || null, redacted: false, length: text.length }
                      : { value: n, redacted: false, length: text.length };
    }
    if (vk === "bool") return { value: !!raw, redacted: false, length: 0 };
    if (vk === "date" || vk === "cat") return { value: text || null, redacted: false, length: text.length };
    // free text: a short code may pass, otherwise length only
    if (text && SHORT_CODE.test(text) && !looksLikeSecret(text)) {
      return { value: text, redacted: false, length: text.length };
    }
    return { value: null, redacted: true, length: text.length };
  }

  function fieldRecord(el) {
    var label = labelFor(el);
    var safe = safeValue(el);
    var rec = {
      name: stableName(el, label),
      label: label,
      kind: controlKind(el),
      value_kind: valueKind(el),
      options: optionsFor(el),
      value: safe.value,
    };
    if (safe.redacted) {
      rec.redacted = true;
      rec.value_length = safe.length;
    }
    return rec;
  }

  function fields() {
    var out = [];
    var nodes = document.querySelectorAll("input,select,textarea");
    for (var i = 0; i < nodes.length && out.length < MAX_FIELDS; i++) {
      var el = nodes[i];
      if (insideShadowUI(el) || sensitive(el) || !visible(el)) continue;
      out.push(fieldRecord(el));
    }
    return out;
  }

  // ------------------------------------------------------------------- emit
  function emit(evt) {
    evt.url = evt.url || location.href;
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i](evt);
      } catch (e) {
        if (window.console && console.warn) console.warn(NAME + " observe listener failed", e);
      }
    }
  }

  function on(fn) {
    if (typeof fn !== "function") return function () {};
    listeners.push(fn);
    return function () {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function snapshot() {
    return { url: location.href, title: norm(document.title), fields: fields() };
  }

  function observe() {
    var snap = snapshot();
    lastUrl = location.href;
    lastSignature = snap.fields.map(function (f) { return f.name + ":" + f.value_kind; }).join("|");
    baseline = {};
    var nodes = document.querySelectorAll("input,select,textarea");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (insideShadowUI(el) || sensitive(el) || !visible(el)) continue;
      baseline[stableName(el, labelFor(el))] = safeValue(el);
    }
    emit({ type: "observe", url: snap.url, title: snap.title, fields: snap.fields });
  }

  function scheduleRouteCheck() {
    if (routeTimer) clearTimeout(routeTimer);
    routeTimer = setTimeout(function () {
      routeTimer = null;
      var sig = fields().map(function (f) { return f.name + ":" + f.value_kind; }).join("|");
      if (location.href !== lastUrl || sig !== lastSignature) observe();
    }, ROUTE_DEBOUNCE_MS);
  }

  // ---------------------------------------------------------------- changes
  function fieldChanged(el) {
    if (insideShadowUI(el) || sensitive(el) || !visible(el)) return;
    var rec = fieldRecord(el);
    var prev = baseline[rec.name];
    var safe = safeValue(el);
    var after = safe.redacted ? null : safe.value;
    var unchanged = !!prev && prev.redacted === safe.redacted
      && String(prev.value) === String(after)
      && (prev.length || 0) === (safe.length || 0);
    baseline[rec.name] = safe;
    if (unchanged) return;
    var evt = {
      type: "field_changed",
      field: rec.name,
      label: rec.label,
      before: prev && !prev.redacted ? prev.value : null,
      after: after,
      kind: rec.kind,
      value_kind: rec.value_kind,
    };
    if (safe.redacted) {
      evt.redacted = true;
      evt.before_length = prev && prev.redacted ? prev.length : null;
      evt.after_length = safe.length;
    }
    emit(evt);
  }

  // ---------------------------------------------------------------- actions
  function actionOf(el) {
    var label = textOf(el) || norm(attr(el, "aria-label")) || norm(attr(el, "value")) || norm(attr(el, "title"));
    var name = norm(attr(el, "name")) || norm(attr(el, "id")) || slug(label, "action");
    return { name: name, label: label || name };
  }

  function buttonLike(el) {
    if (!el || !el.closest) return null;
    return el.closest('button,[role="button"],input[type="submit"],input[type="button"],input[type="reset"],a[role="button"]');
  }

  function clicked(evt) {
    var btn = buttonLike(evt.target);
    if (!btn || insideShadowUI(btn) || btn.disabled) return;
    if (attr(btn, "aria-disabled") === "true") return;
    var a = actionOf(btn);
    if (!a.name) return;
    var now = Date.now();
    if (a.name === lastClick.name && now - lastClick.t < 400) return; // double-fire guard
    lastClick = { name: a.name, t: now };
    emit({ type: "action", name: a.name, label: a.label });
  }

  function submitted(evt) {
    var form = evt.target;
    if (!form || !form.querySelector) return;
    var submitter = evt.submitter || form.querySelector('button[type="submit"],input[type="submit"]');
    if (submitter && !insideShadowUI(submitter)) {
      var a = actionOf(submitter);
      if (a.name) emit({ type: "action", name: a.name, label: a.label });
    }
  }

  // ------------------------------------------------------------ route change
  function patchHistory() {
    ["pushState", "replaceState"].forEach(function (key) {
      var original = history[key];
      if (typeof original !== "function") return;
      history[key] = function () {
        var out = original.apply(this, arguments);
        scheduleRouteCheck();
        return out;
      };
    });
  }

  function watchDom() {
    if (!window.MutationObserver || !document.documentElement) return;
    var mo = new MutationObserver(function () { scheduleRouteCheck(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ------------------------------------------------------------------ start
  function start() {
    patchHistory();
    watchDom();
    document.addEventListener("change", function (e) {
      if (e.target && /^(input|select|textarea)$/i.test(e.target.tagName || "")) fieldChanged(e.target);
    }, true);
    document.addEventListener("input", function (e) {
      var el = e.target;
      if (!el) return;
      var t = typeOf(el);
      // live-updating controls only; free text is captured on change/blur
      if (t === "checkbox" || t === "radio" || t === "range" || t === "date" || t === "time") fieldChanged(el);
    }, true);
    document.addEventListener("click", clicked, true);
    document.addEventListener("submit", submitted, true);
    window.addEventListener("popstate", scheduleRouteCheck, true);
    window.addEventListener("hashchange", scheduleRouteCheck, true);
    observe();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  window.shadowObserve = {
    NAME: NAME,
    snapshot: snapshot,
    on: on,
    observe: observe,
    refresh: observe,
    fields: fields,
  };
})();
