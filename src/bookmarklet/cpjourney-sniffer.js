(function () {
  "use strict";

  if (window.__cpjSniffer) {
    window.__cpjSniffer.panel.style.display = "block";
    return;
  }

  var MAX_ENTRIES = 300;
  var NOISY_ACTIONS = { cpj_ping: true, send_position: true };
  var entries = [];
  var paused = false;
  var hideNoisy = true;
  var autoExpand = false;
  var autoScroll = false;
  var filterText = "";

  // --- Minimal msgpack decoder ---
  // Handles: null, bool, int, uint, float, str, bin, array, map
  // Enough for Socket.IO + CPJourney packet payloads

  function msgDecode(data) {
    var buf;
    if (data instanceof ArrayBuffer) buf = new Uint8Array(data);
    else if (ArrayBuffer.isView(data)) buf = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    else return null;
    var dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    var p = { v: 0 };
    return _d(buf, dv, p);
  }

  function _d(b, dv, p) {
    var c = b[p.v++];
    if (c <= 0x7f) return c;
    if (c >= 0xe0) return c - 256;
    if ((c & 0xf0) === 0x80) return _map(b, dv, p, c & 0x0f);
    if ((c & 0xf0) === 0x90) return _arr(b, dv, p, c & 0x0f);
    if ((c & 0xe0) === 0xa0) return _str(b, p, c & 0x1f);
    switch (c) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xc4: { var n = b[p.v++]; p.v += n; return null; }
      case 0xc5: { var n = dv.getUint16(p.v); p.v += 2 + n; return null; }
      case 0xc6: { var n = dv.getUint32(p.v); p.v += 4 + n; return null; }
      case 0xca: { var v = dv.getFloat32(p.v); p.v += 4; return v; }
      case 0xcb: { var v = dv.getFloat64(p.v); p.v += 8; return v; }
      case 0xcc: return b[p.v++];
      case 0xcd: { var v = dv.getUint16(p.v); p.v += 2; return v; }
      case 0xce: { var v = dv.getUint32(p.v); p.v += 4; return v; }
      case 0xcf: { var hi = dv.getUint32(p.v), lo = dv.getUint32(p.v + 4); p.v += 8; return hi * 4294967296 + lo; }
      case 0xd0: { var v = dv.getInt8(p.v); p.v += 1; return v; }
      case 0xd1: { var v = dv.getInt16(p.v); p.v += 2; return v; }
      case 0xd2: { var v = dv.getInt32(p.v); p.v += 4; return v; }
      case 0xd3: { var hi = dv.getInt32(p.v), lo = dv.getUint32(p.v + 4); p.v += 8; return hi * 4294967296 + lo; }
      case 0xd9: { var n = b[p.v++]; return _str(b, p, n); }
      case 0xda: { var n = dv.getUint16(p.v); p.v += 2; return _str(b, p, n); }
      case 0xdb: { var n = dv.getUint32(p.v); p.v += 4; return _str(b, p, n); }
      case 0xdc: { var n = dv.getUint16(p.v); p.v += 2; return _arr(b, dv, p, n); }
      case 0xdd: { var n = dv.getUint32(p.v); p.v += 4; return _arr(b, dv, p, n); }
      case 0xde: { var n = dv.getUint16(p.v); p.v += 2; return _map(b, dv, p, n); }
      case 0xdf: { var n = dv.getUint32(p.v); p.v += 4; return _map(b, dv, p, n); }
      // fixext 1/2/4/8/16 — skip type byte + data
      case 0xd4: p.v += 2; return null;
      case 0xd5: p.v += 3; return null;
      case 0xd6: p.v += 5; return null;
      case 0xd7: p.v += 9; return null;
      case 0xd8: p.v += 17; return null;
      // ext 8/16/32
      case 0xc7: { var n = b[p.v++]; p.v += 1 + n; return null; }
      case 0xc8: { var n = dv.getUint16(p.v); p.v += 3 + n; return null; }
      case 0xc9: { var n = dv.getUint32(p.v); p.v += 5 + n; return null; }
      default: return undefined;
    }
  }

  function _str(b, p, len) {
    var s = new TextDecoder().decode(b.subarray(p.v, p.v + len));
    p.v += len;
    return s;
  }

  function _arr(b, dv, p, len) {
    var a = new Array(len);
    for (var i = 0; i < len; i++) a[i] = _d(b, dv, p);
    return a;
  }

  function _map(b, dv, p, len) {
    var m = {};
    for (var i = 0; i < len; i++) { var k = _d(b, dv, p); m[k] = _d(b, dv, p); }
    return m;
  }

  // --- Decode raw WebSocket frame into CPJ packet ---

  function tryDecode(raw, dir) {
    if (typeof raw === "string") return;
    try {
      var pkt = msgDecode(raw);
      // Socket.IO EVENT packet: { type: 2, nsp: "...", data: ["message", { action, args }] }
      if (pkt && pkt.type === 2 && Array.isArray(pkt.data) && pkt.data[0] === "message") {
        var payload = pkt.data[1];
        if (payload && payload.action) addEntry(dir, payload);
      }
    } catch (e) { /* ignore decode errors */ }
  }

  // --- UI ---

  var panel = document.createElement("div");
  panel.id = "cpj-sniffer";
  panel.innerHTML = [
    '<div id="cpjs-header" style="display:flex;align-items:center;gap:6px;padding:6px 10px;cursor:move;background:#1a1a2e;border-bottom:1px solid #333;user-select:none">',
    '  <b style="flex:1;font-size:13px;color:#8be9fd">CPJ Packets</b>',
    '  <input id="cpjs-filter" placeholder="filter..." style="width:100px;padding:2px 6px;font-size:11px;background:#0d0d1a;color:#f8f8f2;border:1px solid #444;border-radius:3px;font-family:monospace">',
    '  <span id="cpjs-noisy" style="cursor:pointer;color:#888;font-size:11px">Show Noisy</span>',
    '  <span id="cpjs-expand" style="cursor:pointer;color:#888;font-size:11px">Auto Expand</span>',
    '  <span id="cpjs-scroll" style="cursor:pointer;color:#888;font-size:11px">Auto Scroll</span>',
    '  <span id="cpjs-min" style="cursor:pointer;color:#888;font-size:15px" title="Minimize">&#x2013;</span>',
    '  <span id="cpjs-close" style="cursor:pointer;color:#888;font-size:15px" title="Close">&#x2715;</span>',
    "</div>",
    '<div id="cpjs-log" style="flex:1;overflow-y:auto;padding:4px 8px;font-size:11px;line-height:1.5"></div>',
    '<div id="cpjs-footer" style="display:flex;align-items:center;gap:8px;padding:4px 10px;border-top:1px solid #333;font-size:11px;color:#888">',
    '  <span id="cpjs-pause" style="cursor:pointer;color:#bd93f9">Pause</span>',
    '  <span id="cpjs-clear" style="cursor:pointer;color:#ff79c6">Clear</span>',
    '  <span style="flex:1"></span>',
    '  <span id="cpjs-count">0</span> entries',
    '  <span id="cpjs-status" style="color:#ffb86c">waiting...</span>',
    "</div>",
  ].join("");

  Object.assign(panel.style, {
    position: "fixed",
    top: "10px",
    right: "10px",
    width: "420px",
    height: "360px",
    zIndex: "999999",
    background: "#0d0d1a",
    color: "#f8f8f2",
    fontFamily: "Menlo, Monaco, Consolas, monospace",
    fontSize: "12px",
    borderRadius: "8px",
    border: "1px solid #333",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
    resize: "both",
    overflow: "hidden",
  });

  document.body.appendChild(panel);

  var logEl = panel.querySelector("#cpjs-log");
  var countEl = panel.querySelector("#cpjs-count");
  var statusEl = panel.querySelector("#cpjs-status");
  var filterEl = panel.querySelector("#cpjs-filter");
  var noisyEl = panel.querySelector("#cpjs-noisy");
  var expandEl = panel.querySelector("#cpjs-expand");
  var scrollEl = panel.querySelector("#cpjs-scroll");

  // Drag
  var header = panel.querySelector("#cpjs-header");
  var dragX, dragY;
  header.addEventListener("mousedown", function (e) {
    if (e.target.tagName === "INPUT" || e.target.tagName === "LABEL" || e.target.tagName === "SPAN") return;
    dragX = e.clientX - panel.offsetLeft;
    dragY = e.clientY - panel.offsetTop;
    function onMove(ev) {
      panel.style.left = ev.clientX - dragX + "px";
      panel.style.top = ev.clientY - dragY + "px";
      panel.style.right = "auto";
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  // Minimize
  var minimized = false;
  panel.querySelector("#cpjs-min").addEventListener("click", function () {
    minimized = !minimized;
    logEl.style.display = minimized ? "none" : "block";
    panel.querySelector("#cpjs-footer").style.display = minimized ? "none" : "flex";
    panel.style.height = minimized ? "auto" : "360px";
    panel.style.resize = minimized ? "none" : "both";
  });

  // Close
  panel.querySelector("#cpjs-close").addEventListener("click", function () {
    panel.style.display = "none";
  });

  // Pause
  panel.querySelector("#cpjs-pause").addEventListener("click", function () {
    paused = !paused;
    this.textContent = paused ? "Resume" : "Pause";
    this.style.color = paused ? "#50fa7b" : "#bd93f9";
  });

  // Clear
  panel.querySelector("#cpjs-clear").addEventListener("click", function () {
    entries = [];
    renderLog();
  });

  // Filter
  filterEl.addEventListener("input", function () {
    filterText = this.value.toLowerCase();
    renderLog();
  });

  // Hide noisy toggle
  noisyEl.addEventListener("click", function () {
    hideNoisy = !hideNoisy;
    this.textContent = hideNoisy ? "Show Noisy" : "Hide Noisy";
    this.style.color = hideNoisy ? "#888" : "#50fa7b";
    renderLog();
  });

  // Auto scroll toggle
  scrollEl.addEventListener("click", function () {
    autoScroll = !autoScroll;
    this.textContent = autoScroll ? "Stop Scroll" : "Auto Scroll";
    this.style.color = autoScroll ? "#50fa7b" : "#888";
    if (autoScroll) logEl.scrollTop = logEl.scrollHeight;
  });

  // Auto expand toggle
  expandEl.addEventListener("click", function () {
    autoExpand = !autoExpand;
    this.textContent = autoExpand ? "Collapse Args" : "Auto Expand";
    this.style.color = autoExpand ? "#50fa7b" : "#888";
    renderLog();
  });

  // --- Rendering ---

  function renderLog() {
    var html = "";
    var visible = 0;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (hideNoisy && NOISY_ACTIONS[e.action]) continue;
      if (filterText && e.action.toLowerCase().indexOf(filterText) === -1) continue;
      visible++;
      var dirColor = e.dir === "IN" ? "#50fa7b" : "#ffb86c";
      var dirLabel = e.dir === "IN" ? "IN " : "OUT";
      var argsStr = JSON.stringify(e.args, null, 2);
      html +=
        '<div style="border-bottom:1px solid #1a1a2e;padding:2px 0">' +
        '<span style="color:#6272a4">' + e.time + "</span> " +
        '<span style="color:' + dirColor + ';font-weight:bold">' + dirLabel + "</span> " +
        '<b style="color:#f1fa8c">' + e.action + "</b>" +
        '<details' + (autoExpand ? ' open' : '') + ' style="margin-left:20px;color:#ccc"><summary style="cursor:pointer;color:#888;font-size:10px">args</summary>' +
        '<pre style="margin:2px 0;white-space:pre-wrap;word-break:break-all;font-size:10px">' + escapeHtml(argsStr) + "</pre></details>" +
        "</div>";
    }
    logEl.innerHTML = html;
    countEl.textContent = visible;
    if (autoScroll) logEl.scrollTop = logEl.scrollHeight;
  }

  function addEntry(dir, msg) {
    if (paused) return;
    var now = new Date();
    var time =
      pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds()) + "." + pad3(now.getMilliseconds());
    entries.push({ dir: dir, action: msg.action, args: msg.args || {}, time: time });
    if (entries.length > MAX_ENTRIES) entries.shift();
    renderLog();
  }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function pad3(n) { return n < 10 ? "00" + n : n < 100 ? "0" + n : "" + n; }
  function truncate(s, max) { return s.length > max ? s.slice(0, max) + "..." : s; }
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // --- WebSocket interception ---
  // Intercepts at the native WebSocket level — works regardless of whether
  // the Socket.IO instance is in a closure, webpack bundle, etc.
  // Binary frames from cpjourney.net are msgpack-encoded Socket.IO packets.

  var hookedWS = new WeakSet();
  var NativeWS = window.WebSocket;
  var nativeSend = NativeWS.prototype.send;

  function hookWSInstance(ws) {
    if (hookedWS.has(ws)) return;
    hookedWS.add(ws);
    ws.addEventListener("message", function (ev) {
      if (ev.data instanceof ArrayBuffer) {
        tryDecode(ev.data, "IN");
      } else if (ev.data instanceof Blob) {
        ev.data.arrayBuffer().then(function (buf) { tryDecode(buf, "IN"); });
      }
    });
    statusEl.textContent = "hooked";
    statusEl.style.color = "#50fa7b";
  }

  // Patch prototype.send — catches ALL WebSocket instances (existing + future)
  NativeWS.prototype.send = function (data) {
    if (this.url && this.url.indexOf("cpjourney.net") !== -1) {
      if (!hookedWS.has(this)) hookWSInstance(this);
      tryDecode(data, "OUT");
    }
    return nativeSend.apply(this, arguments);
  };

  // Proxy constructor — hooks incoming listener immediately on new connections
  window.WebSocket = function (url, protocols) {
    var ws = arguments.length > 1 ? new NativeWS(url, protocols) : new NativeWS(url);
    if (typeof url === "string" && url.indexOf("cpjourney.net") !== -1) {
      hookWSInstance(ws);
    }
    return ws;
  };
  window.WebSocket.prototype = NativeWS.prototype;
  window.WebSocket.CONNECTING = 0;
  window.WebSocket.OPEN = 1;
  window.WebSocket.CLOSING = 2;
  window.WebSocket.CLOSED = 3;

  window.__cpjSniffer = { panel: panel };
})();
