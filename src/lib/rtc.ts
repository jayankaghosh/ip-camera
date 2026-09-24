export type MediaKind = "audio" | "video";
/** Whether the host device's mic/camera are on, and who changed them last. */
export type MediaState = { audio: boolean; video: boolean; changedBy: string | null };

export type RoomSummary = {
  code: string;
  password: string | null;
  createdAt: number;
  media: MediaState;
  viewers: { name: string; isAdmin: boolean; joinedAt: number }[];
};

export type ServerMessage =
  | { type: "error"; message: string }
  | { type: "host-ok"; code: string }
  | { type: "join-ok"; media: MediaState }
  | { type: "host-left" }
  | { type: "kicked" }
  | { type: "viewer-joined"; viewerId: string; name: string; isAdmin: boolean }
  | { type: "viewer-left"; viewerId: string }
  | { type: "set-media"; kind: MediaKind; enabled: boolean; by?: string }
  | { type: "media-state"; media: MediaState }
  | { type: "rooms"; rooms: RoomSummary[] }
  | { type: "signal"; from?: string; data: SignalData };

export type SignalData =
  | { sdp: RTCSessionDescriptionInit }
  | { candidate: RTCIceCandidateInit };

// Override with NEXT_PUBLIC_ICE_SERVERS='[{"urls":"turn:...","username":"...","credential":"..."}]'
// when host and viewer are on networks that STUN alone can't traverse.
export const rtcConfig: RTCConfiguration = {
  iceServers: process.env.NEXT_PUBLIC_ICE_SERVERS
    ? JSON.parse(process.env.NEXT_PUBLIC_ICE_SERVERS)
    : [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }],
};

export function openSignaling(onMessage: (msg: ServerMessage) => void): Promise<WebSocket> {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${scheme}://${location.host}/ws`);
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error("Could not reach the server."));
  });
}

// Most efficient codec first; the viewer's browser picks the first one it also supports.
const VIDEO_CODEC_ORDER = ["video/AV1", "video/VP9", "video/H264", "video/VP8"];

export function preferEfficientCodecs(transceiver: RTCRtpTransceiver, kind: "audio" | "video") {
  const caps = RTCRtpSender.getCapabilities(kind);
  if (!caps || typeof transceiver.setCodecPreferences !== "function") return;
  const order = kind === "video" ? VIDEO_CODEC_ORDER : ["audio/opus"];
  const rank = (c: RTCRtpCodec) => {
    const i = order.indexOf(c.mimeType);
    return i === -1 ? order.length : i;
  };
  transceiver.setCodecPreferences([...caps.codecs].sort((a, b) => rank(a) - rank(b)));
}

/** Serializes async work so ICE candidates are never applied before the SDP they belong to. */
export function createQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return (task: () => Promise<unknown>) => {
    tail = tail.then(task).catch((err) => console.error(err));
  };
}
