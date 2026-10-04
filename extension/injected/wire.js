/* Tacet observer wiring (MAIN world) — runs after vendor/observe.js.
 *
 * observe.js emits page schema and safe field/action events. On pages without their own
 * companion these are handed to the companion's watch mode and pinned capture socket.
 * On a page that already loaded capture.js itself, observe.js is left unwired so the app's
 * own, richer observer is not duplicated.
 */
(function () {
  if (window.__shadowWired) return;
  window.__shadowWired = true;

  if (window.__shadowHadCapture) return; // the page runs its own observer/companion
  if (!window.shadowObserve || typeof window.shadowObserve.on !== "function") return;
  // The companion owns watch mode, session identity and privacy pauses. Never
  // bypass it by forwarding unpinned events straight to the latest session.
  if (typeof window.__shadowWireObserver === "function") window.__shadowWireObserver();
})();
