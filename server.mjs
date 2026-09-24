// Custom Next.js server that also hosts the WebRTC signaling WebSocket at /ws.
//
// Media never passes through this server: the host's browser streams directly
// to each viewer over WebRTC (AV1/VP9 video + Opus audio, DTLS-SRTP encrypted).
// This server hands each host a unique room code, admits viewers who present a
// valid code, and relays SDP offers/answers and ICE candidates between them.
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { existsSync, readFileSync } from "node:fs";
import { randomInt, randomUUID } from "node:crypto";
import next from "next";
import { WebSocketServer } from "ws";

const port = parseInt(process.env.PORT || "3000", 10);
const dev = process.env.NODE_ENV !== "production";
const certFile = process.env.CERT_FILE || "certs/cert.pem";
const keyFile = process.env.KEY_FILE || "certs/key.pem";
const useHttps = existsSync(certFile) && existsSync(keyFile);
// Behind a reverse proxy (nginx), trust its X-Real-IP header and only listen on loopback so
// clients can't bypass the proxy and spoof that header.
const trustProxy = process.env.TRUST_PROXY === "1";
const hostname = process.env.HOST || (trustProxy ? "127.0.0.1" : undefined);

// No 0/O or 1/I/L so codes can be read aloud and typed without mistakes.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const MAX_NAME_LENGTH = 40;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

const app = next({ dev });
const handle = app.getRequestHandler();

/**
 * @typedef {{ ws: import("ws").WebSocket, name: string }} Viewer
 * @typedef {{ ws: import("ws").WebSocket, viewers: Map<string, Viewer> }} Room
 * @type {Map<string, Room>} code -> room
 */
const rooms = new Map();
/** @type {Map<string, { count: number, until: number }>} ip -> failed attempts */
const failures = new Map();

function generateCode() {
  let code;
  do {
    code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function isLockedOut(ip) {
  const f = failures.get(ip);
  return f && f.until > Date.now();
}

function recordFailure(ip) {
  const f = failures.get(ip) ?? { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= MAX_FAILED_ATTEMPTS) {
    f.until = Date.now() + LOCKOUT_MS;
    f.count = 0;
  }
  failures.set(ip, f);
}

function closeRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  rooms.delete(code);
  for (const { ws } of room.viewers.values()) {
    send(ws, { type: "host-left" });
    ws.close();
  }
}

function onConnection(ws, req) {
  const ip = (trustProxy && req.headers["x-real-ip"]) || req.socket.remoteAddress || "unknown";
  /** @type {"host" | "viewer" | null} */
  let role = null;
  /** @type {string | null} */
  let code = null;
  /** @type {string | null} */
  let viewerId = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (role === null && msg.type === "host") {
      role = "host";
      code = generateCode();
      rooms.set(code, { ws, viewers: new Map() });
      return send(ws, { type: "host-ok", code });
    }

    if (role === null && msg.type === "join") {
      const name = String(msg.name ?? "").trim().slice(0, MAX_NAME_LENGTH);
      if (!name) return send(ws, { type: "error", message: "Please enter your name." });
      if (isLockedOut(ip)) {
        return send(ws, { type: "error", message: "Too many wrong codes. Try again in a minute." });
      }
      const requested = String(msg.code ?? "").trim().toUpperCase();
      const room = rooms.get(requested);
      if (!room) {
        recordFailure(ip);
        return send(ws, { type: "error", message: "No live camera with that code." });
      }
      failures.delete(ip);
      role = "viewer";
      code = requested;
      viewerId = randomUUID();
      room.viewers.set(viewerId, { ws, name });
      send(ws, { type: "join-ok" });
      return send(room.ws, { type: "viewer-joined", viewerId, name });
    }

    // Relay signaling: the host addresses a viewer by id; viewers always talk to their host.
    const room = code ? rooms.get(code) : undefined;
    if (msg.type === "signal" && room) {
      if (role === "host" && typeof msg.to === "string") {
        const target = room.viewers.get(msg.to);
        if (target) send(target.ws, { type: "signal", data: msg.data });
      } else if (role === "viewer") {
        send(room.ws, { type: "signal", from: viewerId, data: msg.data });
      }
    }
  });

  ws.on("close", () => {
    if (!code) return;
    const room = rooms.get(code);
    if (role === "host" && room?.ws === ws) {
      closeRoom(code);
    } else if (role === "viewer" && room && viewerId) {
      room.viewers.delete(viewerId);
      send(room.ws, { type: "viewer-left", viewerId });
    }
  });
}

await app.prepare();

const requestListener = (req, res) => handle(req, res);
const server = useHttps
  ? createHttpsServer({ cert: readFileSync(certFile), key: readFileSync(keyFile) }, requestListener)
  : createHttpServer(requestListener);

const wss = new WebSocketServer({ noServer: true });
wss.on("connection", onConnection);

// Keep Next's own upgrade handling (HMR in dev) working for every other path.
const nextUpgrade = app.getUpgradeHandler();
server.on("upgrade", (req, socket, head) => {
  if (req.url?.startsWith("/ws")) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  } else {
    nextUpgrade(req, socket, head);
  }
});

server.listen(port, hostname, () => {
  const scheme = useHttps ? "https" : "http";
  console.log(`> Ready on ${scheme}://localhost:${port} (${dev ? "development" : "production"})`);
  if (!useHttps && !trustProxy) {
    console.log("> Camera access on other devices needs HTTPS: run `npm run cert` and restart.");
  }
});
