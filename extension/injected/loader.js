/* Tacet bootstrap (MAIN world) — runs before the bundled companion and observer.
 *
 * It records whether the page already ships its own companion (our ERP loads capture.js
 * itself, and must never be double-injected), then exposes a tiny bridge that the generic
 * observer can use to send its events through the companion's own capture socket.
 *
 * capture.js owns its WebSocket and does not export a send(); the bridge captures that socket
 * by wrapping the WebSocket constructor for the single injection window, so the observer's
 * events travel on the companion's connection rather than opening a second one.
 */
(function () {
  if (window.__shadowGlue) return;
  window.__shadowGlue = true;

  // Set before vendor/capture.js runs: did this page already load its own companion?
  window.__shadowHadCapture = !!window.__shadowCapture;

  var socket = null;
  var queue = [];
  var MAX_QUEUE = 200;

  function flush() {
    if (!socket || socket.readyState !== 1) return;
    var pending = queue;
    queue = [];
    for (var i = 0; i < pending.length; i++) {
      try { socket.send(pending[i]); } catch (e) { /* keep going */ }
    }
  }

  window.__shadowBridge = {
    connected: function () { return !!socket && socket.readyState === 1; },
    send: function (evt) {
      if (!evt || !evt.type) return;
      var msg;
      try {
        evt.client_ts = Date.now() / 1000;
        msg = JSON.stringify(evt);
      } catch (e) { return; }
      if (socket && socket.readyState === 1) {
        try { socket.send(msg); return; } catch (e) { /* fall through to the queue */ }
      }
      queue.push(msg);
      if (queue.length > MAX_QUEUE) queue.shift();
    },
  };

  // The page's own companion already owns a socket we cannot see; never hijack the page's WebSocket.
  if (window.__shadowHadCapture) return;

  var Native = window.WebSocket;
  if (typeof Native !== "function") return;

  function BridgeSocket(url, protocols) {
    var ws = protocols === undefined ? new Native(url) : new Native(url, protocols);
    try {
      if (!socket && String(url).indexOf("/ws/capture") >= 0) {
        socket = ws;
        ws.addEventListener("open", flush);
        ws.addEventListener("close", function () { if (socket === ws) socket = null; });
      }
    } catch (e) { /* never break the page over a socket we could not read */ }
    return ws;
  }
  BridgeSocket.prototype = Native.prototype;
  for (var k in Native) {
    try { BridgeSocket[k] = Native[k]; } catch (e) { /* non-enumerable statics */ }
  }
  window.WebSocket = BridgeSocket;
})();
