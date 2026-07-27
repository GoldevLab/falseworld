/** False World — realtime presence client (WebSocket room per world seed). */
(function () {
  const POSE_HZ = 30;
  const POSE_MS = 1000 / POSE_HZ;
  const STORAGE_ID = "fw_guest_id";
  const STORAGE_NAME = "fw_guest_name";

  function uuid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "g-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function loadGuest() {
    // Id must be unique per page load. sessionStorage is COPIED when the user
    // "Duplicates tab", so two tabs would share one id and the server would
    // replace peer A with B — one side then sees nobody.
    let name = null;
    try {
      name = localStorage.getItem(STORAGE_NAME) || sessionStorage.getItem(STORAGE_NAME);
    } catch (_) {}
    // Reuse id stamped earlier this page load (index boots guest before mp.create)
    let id = null;
    try {
      if (window.__fw && window.__fw.playerId) id = String(window.__fw.playerId);
    } catch (_) {}
    if (!id) id = uuid();
    try { sessionStorage.setItem(STORAGE_ID, id); } catch (_) {}
    if (!name || !String(name).trim()) {
      name = "Guest-" + id.replace(/-/g, "").slice(0, 4);
      try { localStorage.setItem(STORAGE_NAME, name); } catch (_) {}
    }
    return { id, name: String(name).slice(0, 24) };
  }

  function saveName(name) {
    const n = String(name || "").trim().slice(0, 24) || "Guest";
    try { localStorage.setItem(STORAGE_NAME, n); } catch (_) {}
    return n;
  }

  function create() {
    const guest = loadGuest();
    let ws = null;
    let selfId = guest.id;
    let seed = 42;
    let name = guest.name;
    let peers = Object.create(null);
    let listeners = [];
    let worldListeners = [];
    let reconnectAt = 0;
    let reconnectAttempt = 0;
    let alive = true;
    let lastSend = 0;
    let poseRaf = 0;
    let getPoseFn = null;
    let connected = false;
    let syncTimer = 0;
    let lastPing = 0;

    function emit() {
      const list = Object.keys(peers).map((k) => peers[k]);
      for (let i = 0; i < listeners.length; i++) {
        try { listeners[i](list, selfId); } catch (e) {
          console.warn("[FW mp] onPeers", e);
        }
      }
    }

    function emitWorld(msg) {
      for (let i = 0; i < worldListeners.length; i++) {
        try { worldListeners[i](msg); } catch (e) {
          console.warn("[FW mp] onWorld", e);
        }
      }
    }

    function applyRoster(arr) {
      const list = Array.isArray(arr) ? arr : [];
      // Ignore empty roster flashes while we still have live peers (race with sync).
      if (list.length === 0 && Object.keys(peers).length > 0) {
        const newest = Object.keys(peers).reduce((m, k) => Math.max(m, peers[k]._t || 0), 0);
        if (performance.now() - newest < 4000) return;
      }
      const next = Object.create(null);
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p && p.id && p.id !== selfId) next[p.id] = normalizePeer(p);
      }
      peers = next;
      connected = true;
      emit();
    }

    function requestSync() {
      if (!ws || ws.readyState !== 1) return;
      try { ws.send(JSON.stringify({ t: "sync" })); } catch (_) {}
    }

    function sendPing() {
      if (!ws || ws.readyState !== 1) return;
      const now = performance.now();
      if (now - lastPing < 1500) return;
      lastPing = now;
      try { ws.send(JSON.stringify({ t: "ping" })); } catch (_) {}
    }

    function wsUrl() {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      return proto + "://" + location.host
        + "/_fw/mp/ws?seed=" + encodeURIComponent(String(seed))
        + "&name=" + encodeURIComponent(name)
        + "&id=" + encodeURIComponent(selfId);
    }

    function handleMsg(raw) {
      let msg;
      try { msg = JSON.parse(raw); } catch (_) { return; }
      if (!msg || !msg.t) return;
      // Inbound WS traffic still runs in background tabs — reply so the server
      // does not mark us stale when pose timers are throttled.
      sendPing();
      if (msg.t === "welcome") {
        selfId = msg.selfId || selfId;
        window.__fw = window.__fw || {};
        window.__fw.playerId = selfId;
        applyRoster(msg.peers || []);
        setTimeout(requestSync, 200);
        setTimeout(requestSync, 1000);
        return;
      }
      if (msg.t === "roster") {
        applyRoster(msg.peers || []);
        return;
      }
      if (msg.t === "peer") {
        if (!msg.id || msg.id === selfId) return;
        peers[msg.id] = normalizePeer(msg);
        emit();
        return;
      }
      if (msg.t === "left") {
        if (msg.id && peers[msg.id]) {
          delete peers[msg.id];
          emit();
        }
        return;
      }
      if (msg.t === "world" || msg.t === "place" || msg.t === "remove") {
        emitWorld(msg);
      }
    }

    function normalizePeer(p) {
      return {
        id: p.id,
        name: p.name || "Guest",
        x: +p.x || 0,
        y: +p.y || 0,
        z: +p.z || 0,
        yaw: +p.yaw || 0,
        moving: !!p.moving,
        sprinting: !!p.sprinting,
        crouching: !!p.crouching,
        _t: performance.now(),
      };
    }

    function connect() {
      if (!alive) return;
      if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
      try {
        ws = new WebSocket(wsUrl());
      } catch (e) {
        console.warn("[FW mp] connect", e);
        scheduleReconnect();
        return;
      }
      ws.addEventListener("open", () => {
        reconnectAttempt = 0;
        try {
          ws.send(JSON.stringify({ t: "hello", name }));
        } catch (_) {}
      });
      ws.addEventListener("message", (ev) => handleMsg(ev.data));
      ws.addEventListener("close", () => {
        connected = false;
        ws = null;
        scheduleReconnect();
      });
      ws.addEventListener("error", () => {
        try { ws && ws.close(); } catch (_) {}
      });
    }

    function scheduleReconnect() {
      if (!alive) return;
      const delay = Math.min(8000, 400 * Math.pow(1.6, reconnectAttempt++));
      reconnectAt = performance.now() + delay;
      setTimeout(() => {
        if (alive && performance.now() >= reconnectAt) connect();
      }, delay);
    }

    function sendPose(pose, force) {
      if (!ws || ws.readyState !== 1 || !pose) return;
      const now = performance.now();
      if (!force && now - lastSend < POSE_MS) return;
      lastSend = now;
      try {
        ws.send(JSON.stringify({
          t: "pose",
          x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw,
          moving: !!pose.moving,
          sprinting: !!pose.sprinting,
          crouching: !!pose.crouching,
        }));
      } catch (_) {}
    }

    function tickPose(ts) {
      if (!alive) return;
      poseRaf = requestAnimationFrame(tickPose);
      const now = typeof ts === "number" ? ts : performance.now();
      if (typeof getPoseFn === "function" && now - lastSend >= POSE_MS) {
        try { sendPose(getPoseFn(), true); } catch (_) {}
      }
      if (now - lastPing >= 2000) sendPing();
    }

    function onVisibility() {
      if (!alive) return;
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        requestSync();
        if (typeof getPoseFn === "function") {
          try { sendPose(getPoseFn(), true); } catch (_) {}
        }
      }
    }

    return {
      connect(opts) {
        opts = opts || {};
        if (opts.seed != null) seed = opts.seed | 0;
        if (opts.name) name = saveName(opts.name);
        if (typeof opts.getPose === "function") getPoseFn = opts.getPose;
        if (typeof opts.onPeers === "function") listeners.push(opts.onPeers);
        if (typeof opts.onWorld === "function") worldListeners.push(opts.onWorld);
        window.__fw = window.__fw || {};
        window.__fw.playerId = selfId;
        window.__fw.playerName = name;
        connect();
        if (!poseRaf) poseRaf = requestAnimationFrame(tickPose);
        if (!syncTimer) {
          syncTimer = setInterval(() => {
            if (alive && connected) requestSync();
          }, 2500);
        }
        try {
          document.addEventListener("visibilitychange", onVisibility);
        } catch (_) {}
        return this;
      },
      setName(n) {
        name = saveName(n);
        window.__fw = window.__fw || {};
        window.__fw.playerName = name;
        if (ws && ws.readyState === 1) {
          try { ws.send(JSON.stringify({ t: "hello", name })); } catch (_) {}
        }
      },
      onPeers(fn) {
        if (typeof fn === "function") {
          listeners.push(fn);
          try { fn(Object.keys(peers).map((k) => peers[k]), selfId); } catch (_) {}
        }
      },
      requestSync,
      sendPose,
      sendPlace(piece) {
        if (!ws || ws.readyState !== 1 || !piece || !piece.id) return;
        try { ws.send(JSON.stringify({ t: "place", piece })); } catch (_) {}
      },
      sendRemove(id) {
        if (!ws || ws.readyState !== 1 || id == null) return;
        try { ws.send(JSON.stringify({ t: "remove", id: String(id) })); } catch (_) {}
      },
      onWorld(fn) {
        if (typeof fn === "function") worldListeners.push(fn);
      },
      getSelfId() { return selfId; },
      getName() { return name; },
      getPeers() { return Object.keys(peers).map((k) => peers[k]); },
      isConnected() { return connected; },
      destroy() {
        alive = false;
        if (poseRaf) cancelAnimationFrame(poseRaf);
        poseRaf = 0;
        if (syncTimer) {
          clearInterval(syncTimer);
          syncTimer = 0;
        }
        try { document.removeEventListener("visibilitychange", onVisibility); } catch (_) {}
        listeners = [];
        worldListeners = [];
        try { ws && ws.close(); } catch (_) {}
        ws = null;
        peers = Object.create(null);
      },
    };
  }

  window.FalseWorldMp = {
    create,
    loadGuest,
  };
})();
