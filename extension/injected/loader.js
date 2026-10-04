/* Tacet bootstrap (MAIN world). The companion owns observer routing, watch
 * mode and its pinned socket; no page WebSocket constructors are replaced. */
(function () {
  if (window.__shadowGlue) return;
  window.__shadowGlue = true;
  window.__shadowHadCapture = !!window.__shadowCapture;
})();
