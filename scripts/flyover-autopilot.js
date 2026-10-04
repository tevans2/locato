/*
 * Flyover solo and multiplayer autopilot reproduction.
 * Paste this file into the browser console before Take off or joining a room.
 * It reads the public map and minimap/outgoing plane telemetry, then holds normal
 * pointer steering and boost controls. The game itself sends every arrival.
 * Stop and remove the hooks with: flyoverAutopilot.stop()
 */
(async () => {
  const host = location.hostname;
  if (!["locato.quest", "localhost", "127.0.0.1", "[::1]"].includes(host) && !host.endsWith(".locato.quest")) {
    throw new Error("Open your Locato site or local development server first.");
  }
  window.flyoverAutopilot?.stop();
  const response = await fetch("/assets/world-map.json");
  if (!response.ok) throw new Error(`Map request failed: ${response.status}`);
  const features = await response.json();
  if (!Array.isArray(features)) throw new Error("Unexpected world map format.");

  const project = ([lng, lat]) => [
    (Math.max(-180, Math.min(180, lng)) + 180) / 360 * 1000,
    (85 - Math.max(-60, Math.min(85, lat))) / 145 * 500,
  ];
  const countries = new Map(features.map((f) => [f.code, {
    name: f.name,
    polygons: (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates)
      .map((polygon) => polygon.map((ring) => ring.map(project))),
  }]));
  const byName = new Map([...countries.values()].map((c) => [c.name, c]));
  const wrap = (x) => ((x % 1000) + 1000) % 1000;
  const delta = (from, to) => ((to - from + 1500) % 1000) - 500;
  const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const insideRing = (x, y, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const contains = (country, x, y) => country.polygons.some(([outer, ...holes]) =>
    insideRing(wrap(x), y, outer) && !holes.some((hole) => insideRing(wrap(x), y, hole)));

  // Find a near-border interior destination, using real polygons rather than
  // bounding boxes or centroids (a centroid may sit outside an island country).
  function destination(country, plane) {
    if (contains(country, plane.x, plane.y)) return [plane.x, plane.y];
    let best = null, bestDistance = Infinity;
    for (const [ring] of country.polygons) {
      for (let i = 1; i < ring.length; i++) {
        const [ax, ay] = ring[i - 1], [bx, by] = ring[i];
        const vx = bx - ax, vy = by - ay, lengthSquared = vx * vx + vy * vy;
        if (!lengthSquared) continue;
        for (const copy of [-1000, 0, 1000]) {
          const t = Math.max(0, Math.min(1, ((plane.x - ax - copy) * vx + (plane.y - ay) * vy) / lengthSquared));
          const edgeX = ax + copy + t * vx, edgeY = ay + t * vy;
          const length = Math.sqrt(lengthSquared);
          for (const side of [-1, 1]) {
            const x = wrap(edgeX - side * vy / length * 0.25);
            const y = edgeY + side * vx / length * 0.25;
            const distance = Math.hypot(delta(plane.x, x), y - plane.y);
            if (distance >= bestDistance || y < 6 || y > 494 || !contains(country, x, y)) continue;
            bestDistance = distance;
            best = [x, y];
          }
        }
      }
    }
    return best;
  }

  const originalSend = WebSocket.prototype.send;
  const canvasPrototype = CanvasRenderingContext2D.prototype;
  const originalArc = canvasPrototype.arc;
  const originalRotate = canvasPrototype.rotate;
  const sockets = new Map();
  let telemetry = null;
  let renderedTelemetry = null;
  let renderedStage = null;
  const drawnHeadings = new WeakMap();
  let mode = null;
  let activeCanvas = null;
  let pointerStarted = false;
  let boost = false;
  let stopped = false;
  let timer = null;
  let desiredHeading = null;
  let route = [];
  let targetName = null;
  let claims = 0;
  let lastDriveAt = -Infinity;
  const pointerId = 987654;

  // Read the own-plane dot and rotation each rendered frame in either mode.
  // This avoids waiting for the multiplayer client's 200ms position report.
  function hookedRotate(angle) {
    const stage = this.canvas.closest(".flyover-stage");
    if (stage && this.canvas.matches(".flyover-canvas")) {
      drawnHeadings.set(stage, angleDiff(angle - Math.PI / 4, 0));
    }
    return originalRotate.call(this, angle);
  }

  function hookedArc(x, y, radius, ...rest) {
    const result = originalArc.call(this, x, y, radius, ...rest);
    if (radius === 5 && this.canvas.matches(".flyover-minimap")) {
      renderedStage = this.canvas.closest(".flyover-stage");
      renderedTelemetry = { x: x / this.canvas.width * 1000, y: y / this.canvas.height * 500, heading: drawnHeadings.get(renderedStage) ?? 0, at: performance.now() };
      runTick();
    }
    return result;
  }

  function release() {
    if (pointerStarted && activeCanvas) activeCanvas.dispatchEvent(new PointerEvent("pointerup", { pointerId, pointerType: "mouse", bubbles: true }));
    pointerStarted = false;
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowUp", code: "ArrowUp", bubbles: true }));
    boost = false;
    desiredHeading = null;
  }

  function listen(socket) {
    if (sockets.has(socket)) return;
    const listener = (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      const round = message.round ?? message.room?.round;
      if (round?.prompt?.kind === "flyover-flight") {
        try {
          const prompt = JSON.parse(round.prompt.value);
          route = prompt.route;
          console.info(`[Flyover test] Server supplied the full route: ${route.length} targets.`, [...route]);
        } catch { /* Non-Flyover data never drives the bot. */ }
      }
      if (message.type === "GAME_COMPLETED" || (message.type === "ROOM_SNAPSHOT" && message.room.status !== "playing")) {
        telemetry = null;
        release();
      }
    };
    sockets.set(socket, listener);
    socket.addEventListener("message", listener);
  }

  function hookedSend(data) {
    const url = new URL(this.url, location.href);
    if (url.host !== location.host || url.pathname !== "/ws") return originalSend.call(this, data);
    listen(this);
    // Always forward the game's message unchanged. No forged reaches or extra
    // position messages are generated by this script.
    const result = originalSend.call(this, data);
    try {
      const message = typeof data === "string" ? JSON.parse(data) : null;
      if (message?.type === "FLYOVER_POSITION") {
        telemetry = { x: message.x, y: message.y, heading: message.heading, at: performance.now() };
      } else if (message?.type === "FLYOVER_REACHED") {
        claims++;
        telemetry = { x: message.x, y: message.y, heading: telemetry?.heading ?? 0, at: performance.now() };
      }
    } catch { /* Preserve unrelated traffic. */ }
    return result;
  }

  function predictedPlane(latest) {
    const plane = { ...latest };
    let left = Math.min(0.25, Math.max(0, (performance.now() - latest.at) / 1000));
    while (left > 0.000001) {
      const dt = Math.min(0.01, left);
      if (desiredHeading !== null) {
        const diff = angleDiff(desiredHeading, plane.heading);
        plane.heading += Math.max(-Math.PI * 0.95 * dt, Math.min(Math.PI * 0.95 * dt, diff));
      }
      const speed = 42 * (boost ? 1.9 : 1);
      plane.x = wrap(plane.x + Math.cos(plane.heading) * speed * dt);
      plane.y += Math.sin(plane.heading) * speed * dt;
      if (plane.y < 6 || plane.y > 494) {
        plane.y = Math.max(6, Math.min(494, plane.y));
        plane.heading = -plane.heading;
      }
      left -= dt;
    }
    return plane;
  }

  function tick() {
    const stage = document.querySelector(".multiplayer-flyover-view .flyover-stage.is-flying, .flyover-screen .flyover-stage.is-flying");
    mode = stage?.closest(".flyover-screen") ? "solo" : stage ? "multiplayer" : null;
    const latest = renderedStage === stage ? renderedTelemetry : mode === "multiplayer" ? telemetry : null;
    const canvas = stage?.querySelector(".flyover-canvas");
    const name = stage?.querySelector(".flyover-target-name")?.textContent?.trim();
    const country = byName.get(name);
    if (!stage || !canvas || !country || !latest || performance.now() - latest.at > 1000) {
      release();
      return;
    }
    if (canvas !== activeCanvas) { release(); activeCanvas = canvas; }
    const clockNow = performance.now();
    if (clockNow - lastDriveAt < 12 && targetName === name) return;
    lastDriveAt = clockNow;
    const plane = predictedPlane(latest);
    const goal = destination(country, plane);
    if (!goal) { release(); return; }
    const dx = delta(plane.x, goal[0]), dy = goal[1] - plane.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.01) return;
    desiredHeading = Math.atan2(dy, dx);
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) { release(); return; }
    const radius = Math.max(24, Math.min(rect.width, rect.height) * 0.35);
    const init = {
      pointerId, pointerType: "mouse", button: 0, buttons: 1, bubbles: true, cancelable: true,
      clientX: rect.left + rect.width / 2 + Math.cos(desiredHeading) * radius,
      clientY: rect.top + rect.height / 2 + Math.sin(desiredHeading) * radius,
    };
    if (!pointerStarted) {
      // Synthetic pointers have no native capture target. Avoid the browser's
      // capture exception just for this synthetic down event, then restore it.
      const ownCapture = Object.getOwnPropertyDescriptor(canvas, "setPointerCapture");
      const capture = canvas.setPointerCapture;
      canvas.setPointerCapture = function (id) { if (id !== pointerId) capture?.call(this, id); };
      try { canvas.dispatchEvent(new PointerEvent("pointerdown", init)); }
      finally {
        if (ownCapture) Object.defineProperty(canvas, "setPointerCapture", ownCapture);
        else delete canvas.setPointerCapture;
      }
      pointerStarted = true;
    } else {
      canvas.dispatchEvent(new PointerEvent("pointermove", init));
    }
    // Retain boost closer to a border while still allowing tight turns.
    // Keep a little more approach margin for solo's changing target sequence.
    const slowdownDistance = mode === "solo" ? 6 : 4;
    boost = Math.abs(angleDiff(desiredHeading, plane.heading)) < 0.6 && distance > slowdownDistance;
    window.dispatchEvent(new KeyboardEvent(boost ? "keydown" : "keyup", { key: "ArrowUp", code: "ArrowUp", bubbles: true }));
    if (targetName !== name) { targetName = name; console.info(`[Flyover test] Steering to ${name}.`); }
  }

  const api = {
    status: () => {
      const latest = renderedTelemetry ?? telemetry;
      return { version: 2, running: !stopped, mode, target: targetName, arrivalClaims: claims, soloScore: mode === "solo" ? Number(document.querySelector(".flyover-screen .flyover-score-value")?.textContent ?? 0) : null, route: [...route], plane: latest && { x: latest.x, y: latest.y, heading: latest.heading } };
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      release();
      if (WebSocket.prototype.send === hookedSend) WebSocket.prototype.send = originalSend;
      if (canvasPrototype.arc === hookedArc) canvasPrototype.arc = originalArc;
      if (canvasPrototype.rotate === hookedRotate) canvasPrototype.rotate = originalRotate;
      for (const [socket, listener] of sockets) socket.removeEventListener("message", listener);
      sockets.clear();
      console.info("[Flyover test] Stopped; normal controls restored.");
    },
  };
  WebSocket.prototype.send = hookedSend;
  canvasPrototype.arc = hookedArc;
  canvasPrototype.rotate = hookedRotate;
  window.flyoverAutopilot = api;
  function runTick() {
    if (stopped) return;
    try { tick(); }
    catch (error) { api.stop(); console.error("[Flyover test] Stopped after an error.", error); }
  }
  timer = setInterval(runTick, 50);
  console.info("[Flyover test] Installed. Click Take off in solo, or join a Flyover test room and start a round. Keep this tab active. Stop with flyoverAutopilot.stop().");
  return api;
})();
