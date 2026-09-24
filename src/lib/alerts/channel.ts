// Host → viewer alert delivery over a WebRTC data channel on the existing peer connection.
// Each alert is a JSON header followed by its JPEG in 16 KB binary chunks (data channel messages
// have a size limit). The channel is ordered, so chunks arrive in sequence after their header.
import type { AlertRecord, AlertType } from "@/lib/alerts/types";

export const ALERT_CHANNEL = "alerts";
const CHUNK = 16 * 1024;
const HIGH_WATER = 1024 * 1024; // pause sending while more than 1 MB is queued

type Header =
  | { t: "hello"; maxAlerts: number }
  | { t: "alert"; id: string; type: AlertType; ts: number; streamCode: string; detail: string; bytes: number; mime: string }
  | { t: "removed"; ids: string[] }
  | { t: "max"; maxAlerts: number };

/** An alert as the viewer holds it: the snapshot is an object URL for <img>, plus the blob for export. */
export type ReceivedAlert = Omit<AlertRecord, "account" | "image"> & { image: Blob | null; url: string | null };

function drain(channel: RTCDataChannel) {
  if (channel.bufferedAmount < HIGH_WATER) return Promise.resolve();
  channel.bufferedAmountLowThreshold = HIGH_WATER / 4;
  return new Promise<void>((resolve) => {
    const done = () => {
      channel.removeEventListener("bufferedamountlow", done);
      channel.removeEventListener("close", done);
      resolve();
    };
    channel.addEventListener("bufferedamountlow", done);
    channel.addEventListener("close", done);
  });
}

/** Host side: one sender per viewer. Calls are queued so history and live alerts never interleave. */
export function createAlertSender(channel: RTCDataChannel) {
  let tail = Promise.resolve();
  const enqueue = (task: () => Promise<void>) => {
    tail = tail.then(task).catch(() => {}); // a closed channel just stops sending
  };
  const sendJson = (h: Header) => channel.readyState === "open" && channel.send(JSON.stringify(h));

  async function sendAlert(a: AlertRecord) {
    if (channel.readyState !== "open") return;
    const bytes = a.image ? new Uint8Array(await a.image.arrayBuffer()) : new Uint8Array(0);
    sendJson({ t: "alert", id: a.id, type: a.type, ts: a.ts, streamCode: a.streamCode, detail: a.detail, bytes: bytes.length, mime: a.image?.type ?? "" });
    for (let off = 0; off < bytes.length; off += CHUNK) {
      await drain(channel);
      if (channel.readyState !== "open") return;
      channel.send(bytes.slice(off, off + CHUNK));
    }
  }

  return {
    /** Everything saved so far (oldest first), then the limit so the viewer trims the same way. */
    sendHistory: (alerts: AlertRecord[], maxAlerts: number) =>
      enqueue(async () => {
        sendJson({ t: "hello", maxAlerts });
        for (const a of alerts) await sendAlert(a);
      }),
    sendAlert: (a: AlertRecord) => enqueue(() => sendAlert(a)),
    sendRemoved: (ids: string[]) => ids.length && enqueue(async () => void sendJson({ t: "removed", ids })),
    sendMax: (maxAlerts: number) => enqueue(async () => void sendJson({ t: "max", maxAlerts })),
  };
}

/** Viewer side: reassembles alerts and reports the full, trimmed list after every change. */
export function receiveAlerts(channel: RTCDataChannel, onChange: (alerts: ReceivedAlert[]) => void) {
  channel.binaryType = "arraybuffer";
  let alerts: ReceivedAlert[] = [];
  let maxAlerts = Infinity;
  let pending: { header: Extract<Header, { t: "alert" }>; parts: ArrayBuffer[]; received: number } | null = null;

  const publish = () => {
    // Keep the newest `maxAlerts`, like the host does, and free the images we drop.
    const excess = alerts.length - maxAlerts;
    if (excess > 0) {
      alerts.slice(0, excess).forEach((a) => a.url && URL.revokeObjectURL(a.url));
      alerts = alerts.slice(excess);
    }
    onChange(alerts);
  };

  const finish = (header: Extract<Header, { t: "alert" }>, parts: ArrayBuffer[]) => {
    const image = header.bytes ? new Blob(parts, { type: header.mime || "image/jpeg" }) : null;
    const { id, type, ts, streamCode, detail } = header;
    alerts = [...alerts.filter((a) => a.id !== id), { id, type, ts, streamCode, detail, image, url: image && URL.createObjectURL(image) }];
    alerts.sort((a, b) => a.ts - b.ts);
    publish();
  };

  channel.onmessage = (e) => {
    if (typeof e.data !== "string") {
      if (!pending) return;
      pending.parts.push(e.data as ArrayBuffer);
      pending.received += (e.data as ArrayBuffer).byteLength;
      if (pending.received >= pending.header.bytes) {
        finish(pending.header, pending.parts);
        pending = null;
      }
      return;
    }
    const h = JSON.parse(e.data) as Header;
    if (h.t === "hello" || h.t === "max") {
      maxAlerts = h.maxAlerts;
      publish();
    } else if (h.t === "removed") {
      const gone = new Set(h.ids);
      alerts.filter((a) => gone.has(a.id)).forEach((a) => a.url && URL.revokeObjectURL(a.url));
      alerts = alerts.filter((a) => !gone.has(a.id));
      publish();
    } else if (h.t === "alert") {
      if (h.bytes === 0) finish(h, []);
      else pending = { header: h, parts: [], received: 0 };
    }
  };

  return () => alerts.forEach((a) => a.url && URL.revokeObjectURL(a.url));
}
