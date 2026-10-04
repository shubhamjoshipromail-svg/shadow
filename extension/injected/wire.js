/* Tacet observer wiring (MAIN world) — runs after vendor/observe.js.
 *
 * observe.js emits page schema and safe field/action events. On pages without their own
 * companion these are forwarded into the companion's capture socket (see loader.js).
 * On a page that already loaded capture.js itself, observe.js is left unwired so the app's
 * own, richer observer is not duplicated.
 */
(function () {
  if (window.__shadowWired) return;
  window.__shadowWired = true;

  if (window.__shadowHadCapture) return; // the page runs its own observer/companion
  if (!window.shadowObserve || typeof window.shadowObserve.on !== "function") return;
  if (!window.__shadowBridge) return;

  // observe.js emits its first "observe" before the global is assigned, so send the current
  // snapshot once; later route changes and field changes arrive through on().
  try {
    var snap = window.shadowObserve.snapshot();
    window.__shadowBridge.send({ type: "observe", url: snap.url, title: snap.title, fields: snap.fields });
  } catch (e) { /* snapshot is best effort */ }

  window.shadowObserve.on(function (evt) {
    window.__shadowBridge.send(evt);
  });
})();
