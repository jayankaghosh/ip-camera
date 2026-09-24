// Custom Next.js server that also hosts the WebRTC signaling WebSocket at /ws
// and the small admin session API at /api/admin/*.
//
// Media never passes through this server: the host's browser streams directly
// to each viewer over WebRTC (AV1/VP9 video + Opus audio, DTLS-SRTP encrypted).
// This server hands each host a unique room code, admits viewers who present a
// valid code (and password, if the host set one), relays SDP offers/answers and
// ICE candidates, and relays mic/camera and kick commands.
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { existsSync, readFileSync } from "node:fs";
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import next from "next";
import { WebSocketServer } from "ws";

const dev = process.env.NODE_ENV !== "production";

const port = parseInt(process.env.PORT || "8908", 10);
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
const MAX_PASSWORD_LENGTH = 64;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;
const ADMIN_COOKIE = "ipcam_admin";
const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;

const app = next({ dev });
const handle = app.getRequestHandler();

/**
 * @typedef {import("ws").WebSocket} WS
 * @typedef {{ ws: WS, name: string, isAdmin: boolean, joinedAt: number }} Viewer
 * @typedef {{ audio: boolean, video: boolean, changedBy: string | null }} MediaState
 * @typedef {{ ws: WS, password: string | null, createdAt: number, media: MediaState, viewers: Map<string, Viewer> }} Room
 * @type {Map<string, Room>} code -> room
 */
const rooms = new Map();
/** @type {Map<string, { count: number, until: number }>} ip -> failed attempts */
const failures = new Map();
/** @type {Map<string, number>} admin session token -> expiry */
const adminSessions = new Map();
/** @type {Set<WS>} admin dashboards receiving live room updates */
const adminSockets = new Set();

function generateCode() {
  let code;
  do {
    code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  } while (rooms.has(code));
  return code;
}

// Compare fixed-length digests so timing doesn't leak how much of a secret matched.
function safeEqual(a, b) {
  const digest = (s) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function clientIp(req) {
  return (trustProxy && req.headers["x-real-ip"]) || req.socket.remoteAddress || "unknown";
}

function isLockedOut(key) {
  const f = failures.get(key);
  return f && f.until > Date.now();
}

function recordFailure(key) {
  const f = failures.get(key) ?? { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= MAX_FAILED_ATTEMPTS) {
    f.until = Date.now() + LOCKOUT_MS;
    f.count = 0;
  }
  failures.set(key, f);
}

// ---------- Admin sessions ----------

function parseCookies(header = "") {
  return Object.fromEntries(
    header.split(";").flatMap((part) => {
      const i = part.indexOf("=");
      if (i === -1) return [];
      const value = part.slice(i + 1).trim();
      try {
        return [[part.slice(0, i).trim(), decodeURIComponent(value)]];
      } catch {
        return [[part.slice(0, i).trim(), value]]; // malformed %-escape in someone else's cookie
      }
    }),
  );
}

function isAdminRequest(req) {
  const token = parseCookies(req.headers.cookie)[ADMIN_COOKIE];
  const expiry = token && adminSessions.get(token);
  if (!expiry) return false;
  if (expiry < Date.now()) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

function adminCookie(req, token, maxAgeSeconds) {
  const secure = useHttps || (trustProxy && req.headers["x-forwarded-proto"] === "https");
  return `${ADMIN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

/** Returns true if the request was an admin API call and has been answered. */
async function handleAdminApi(req, res) {
  const path = req.url?.split("?")[0];
  if (path === "/api/admin/session" && req.method === "GET") {
    // Never 401: that status belongs to nginx's Basic auth, and browsers may drop the saved
    // nginx login when the app answers with it.
    json(res, 200, isAdminRequest(req) ? { loggedIn: true, username: adminUsername } : { loggedIn: false });
    return true;
  }
  if (path === "/api/admin/login" && req.method === "POST") {
    if (!adminUsername || !adminPassword) {
      json(res, 503, { error: "Admin is not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD in .env." });
      return true;
    }
    const lockKey = `admin:${clientIp(req)}`;
    if (isLockedOut(lockKey)) {
      json(res, 429, { error: "Too many wrong attempts. Try again in a minute." });
      return true;
    }
    const { username, password } = await readJson(req);
    // Evaluate both so a wrong username takes as long as a wrong password.
    const userOk = safeEqual(String(username ?? ""), adminUsername);
    const passOk = safeEqual(String(password ?? ""), adminPassword);
    if (!userOk || !passOk) {
      recordFailure(lockKey);
      console.warn(`> Admin login failed from ${clientIp(req)}: wrong ${userOk ? "password" : "username"}.`);
      json(res, 403, { error: "Wrong username or password." });
      return true;
    }
    failures.delete(lockKey);
    const token = randomBytes(32).toString("base64url");
    adminSessions.set(token, Date.now() + ADMIN_SESSION_MS);
    json(res, 200, { username: adminUsername }, { "Set-Cookie": adminCookie(req, token, ADMIN_SESSION_MS / 1000) });
    return true;
  }
  if (path === "/api/admin/logout" && req.method === "POST") {
    adminSessions.delete(parseCookies(req.headers.cookie)[ADMIN_COOKIE]);
    json(res, 200, { ok: true }, { "Set-Cookie": adminCookie(req, "", 0) });
    return true;
  }
  return false;
}

function roomsSnapshot() {
  return [...rooms].map(([code, room]) => ({
    code,
    password: room.password,
    createdAt: room.createdAt,
    media: room.media,
    viewers: [...room.viewers.values()].map((v) => ({ name: v.name, isAdmin: v.isAdmin, joinedAt: v.joinedAt })),
  }));
}

function notifyAdmins() {
  if (adminSockets.size === 0) return;
  const msg = { type: "rooms", rooms: roomsSnapshot() };
  for (const ws of adminSockets) send(ws, msg);
}

// ---------- Rooms ----------

function closeRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  rooms.delete(code);
  for (const { ws } of room.viewers.values()) {
    send(ws, { type: "host-left" });
    ws.close();
  }
  notifyAdmins();
}

function onConnection(ws, req) {
  const ip = clientIp(req);
  const isAdmin = isAdminRequest(req);
  /** @type {"host" | "viewer" | "admin" | null} */
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
      const password = String(msg.password ?? "").slice(0, MAX_PASSWORD_LENGTH);
      role = "host";
      code = generateCode();
      rooms.set(code, {
        ws,
        password: password || null,
        createdAt: Date.now(),
        media: { audio: true, video: true, changedBy: null },
        viewers: new Map(),
      });
      send(ws, { type: "host-ok", code });
      return notifyAdmins();
    }

    if (role === null && msg.type === "join") {
      const asAdmin = msg.asAdmin === true;
      if (asAdmin && !isAdmin) {
        return send(ws, { type: "error", message: "Admin session expired. Log in again at /admin." });
      }
      const name = asAdmin ? "Admin" : String(msg.name ?? "").trim().slice(0, MAX_NAME_LENGTH);
      if (!name) return send(ws, { type: "error", message: "Please enter your name." });
      if (!asAdmin && isLockedOut(ip)) {
        return send(ws, { type: "error", message: "Too many wrong attempts. Try again in a minute." });
      }
      const requested = String(msg.code ?? "").trim().toUpperCase();
      const room = rooms.get(requested);
      if (!room) {
        if (!asAdmin) recordFailure(ip);
        return send(ws, { type: "error", message: "No live camera with that code." });
      }
      if (room.password && !asAdmin) {
        const password = String(msg.password ?? "");
        if (!password) return send(ws, { type: "error", message: "This stream needs a password." });
        if (!safeEqual(password, room.password)) {
          recordFailure(ip);
          return send(ws, { type: "error", message: "Wrong password." });
        }
      }
      failures.delete(ip);
      role = "viewer";
      code = requested;
      viewerId = randomUUID();
      room.viewers.set(viewerId, { ws, name, isAdmin: asAdmin, joinedAt: Date.now() });
      send(ws, { type: "join-ok", media: room.media });
      send(room.ws, { type: "viewer-joined", viewerId, name, isAdmin: asAdmin });
      return notifyAdmins();
    }

    if (role === null && msg.type === "admin-subscribe") {
      if (!isAdmin) return send(ws, { type: "error", message: "Not logged in." });
      role = "admin";
      adminSockets.add(ws);
      return send(ws, { type: "rooms", rooms: roomsSnapshot() });
    }

    const room = code ? rooms.get(code) : undefined;
    if (!room) return;

    // Relay signaling: the host addresses a viewer by id; viewers always talk to their host.
    if (msg.type === "signal") {
      if (role === "host" && typeof msg.to === "string") {
        const target = room.viewers.get(msg.to);
        if (target) send(target.ws, { type: "signal", data: msg.data });
      } else if (role === "viewer") {
        send(room.ws, { type: "signal", from: viewerId, data: msg.data });
      }
      return;
    }

    // A viewer asks the host device to turn its mic/camera on or off; the host applies it.
    if (msg.type === "set-media" && role === "viewer" && (msg.kind === "audio" || msg.kind === "video")) {
      const viewer = room.viewers.get(viewerId);
      return send(room.ws, { type: "set-media", kind: msg.kind, enabled: msg.enabled === true, by: viewer?.name });
    }

    // The host reports what its mic/camera are actually doing now.
    if (msg.type === "media-state" && role === "host") {
      room.media = {
        audio: msg.audio === true,
        video: msg.video === true,
        changedBy: typeof msg.changedBy === "string" ? msg.changedBy.slice(0, MAX_NAME_LENGTH) : null,
      };
      for (const v of room.viewers.values()) send(v.ws, { type: "media-state", media: room.media });
      return notifyAdmins();
    }

    if (msg.type === "kick" && role === "host" && typeof msg.viewerId === "string") {
      const target = room.viewers.get(msg.viewerId);
      if (!target) return;
      room.viewers.delete(msg.viewerId);
      send(target.ws, { type: "kicked" });
      target.ws.close();
      send(ws, { type: "viewer-left", viewerId: msg.viewerId });
      return notifyAdmins();
    }
  });

  ws.on("close", () => {
    if (role === "admin") return void adminSockets.delete(ws);
    if (!code) return;
    const room = rooms.get(code);
    if (role === "host" && room?.ws === ws) {
      closeRoom(code);
    } else if (role === "viewer" && room && viewerId && room.viewers.delete(viewerId)) {
      send(room.ws, { type: "viewer-left", viewerId });
      notifyAdmins();
    }
  });
}

await app.prepare();

// Read after prepare(): Next loads .env / .env.local / .env.production into process.env there.
const adminUsername = process.env.ADMIN_USERNAME || "";
const adminPassword = process.env.ADMIN_PASSWORD || "";

// Next's .env loader expands "$NAME" (even inside quotes) and treats an unquoted "#" as a comment,
// which silently changes passwords. Compare against the raw file so that's reported, not guessed at.
function warnIfEnvValueChanged(key, loaded) {
  const mode = dev ? "development" : "production";
  for (const file of [`.env.${mode}.local`, ".env.local", `.env.${mode}`, ".env"]) {
    if (!existsSync(file)) continue;
    const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.trim().startsWith(`${key}=`));
    if (!line) continue;
    const raw = line.slice(line.indexOf("=") + 1).trim().replace(/^(["'])(.*)\1$/, "$2").replace(/\\\$/g, "$$");
    if (raw !== loaded) {
      console.warn(
        `> WARNING: ${key} in ${file} was loaded differently from how it is written ` +
          `(${raw.length} characters written, ${loaded.length} loaded). ` +
          `Write every "$" as "\\$", and wrap the value in double quotes if it contains "#".`,
      );
    }
    return;
  }
}
warnIfEnvValueChanged("ADMIN_USERNAME", adminUsername);
warnIfEnvValueChanged("ADMIN_PASSWORD", adminPassword);

const requestListener = async (req, res) => {
  if (req.url?.startsWith("/api/admin/") && (await handleAdminApi(req, res))) return;
  handle(req, res);
};
const server = useHttps
  ? createHttpsServer({ cert: readFileSync(certFile), key: readFileSync(keyFile) }, requestListener)
  : createHttpServer(requestListener);

const wss = new WebSocketServer({ noServer: true });
wss.on("connection", onConnection);

// Only accept WebSockets opened by pages on this same site, so another website can't
// open one with a visitor's admin cookie.
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients don't send Origin and carry no cookies
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// Keep Next's own upgrade handling (HMR in dev) working for every other path.
const nextUpgrade = app.getUpgradeHandler();
server.on("upgrade", (req, socket, head) => {
  if (req.url?.startsWith("/ws")) {
    if (!isSameOrigin(req)) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  } else {
    nextUpgrade(req, socket, head);
  }
});

server.listen(port, hostname, () => {
  const scheme = useHttps ? "https" : "http";
  console.log(`> Ready on ${scheme}://localhost:${port} (${dev ? "development" : "production"})`);
  if (!adminUsername || !adminPassword) {
    console.log("> Admin disabled: set ADMIN_USERNAME and ADMIN_PASSWORD in .env to enable /admin.");
  } else {
    console.log(`> Admin enabled for "${adminUsername}" (password is ${adminPassword.length} characters).`);
  }
  if (!useHttps && !trustProxy) {
    console.log("> Camera access on other devices needs HTTPS: run `npm run cert` and restart.");
  }
});
