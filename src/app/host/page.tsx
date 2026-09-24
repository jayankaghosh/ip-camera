"use client";

import { useEffect, useRef, useState } from "react";
import { MediaButton } from "@/components/MediaButton";
import {
  createQueue,
  openSignaling,
  preferEfficientCodecs,
  rtcConfig,
  type MediaKind,
  type MediaState,
  type ServerMessage,
} from "@/lib/rtc";

type Peer = { pc: RTCPeerConnection; enqueue: ReturnType<typeof createQueue>; senders: Record<MediaKind, RTCRtpSender> };
type ViewerInfo = { id: string; name: string; isAdmin: boolean; joinedAt: number };

const KINDS: MediaKind[] = ["audio", "video"];
const CONSTRAINTS: Record<MediaKind, MediaTrackConstraints> = {
  video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
  audio: { echoCancellation: true, noiseSuppression: true },
};

export default function HostPage() {
  const [status, setStatus] = useState<"setup" | "starting" | "live">("setup");
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewers, setViewers] = useState<ViewerInfo[]>([]);
  const [media, setMedia] = useState<MediaState>({ audio: true, video: true, changedBy: null });
  const videoRef = useRef<HTMLVideoElement>(null);
  // Always the same MediaStream object: tracks are added/removed as the mic/camera turn on and off,
  // and every peer's transceivers stay tied to it, so turning a device back on needs no renegotiation.
  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const peersRef = useRef(new Map<string, Peer>());
  const mediaQueueRef = useRef(createQueue());
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  function stopAll() {
    wsRef.current?.close();
    wsRef.current = null;
    for (const { pc } of peersRef.current.values()) pc.close();
    peersRef.current.clear();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }

  useEffect(() => stopAll, []);

  // Only the camera goes to the preview (it's muted anyway); a fresh MediaStream makes the <video> re-render.
  function refreshPreview() {
    const stream = streamRef.current;
    if (videoRef.current) videoRef.current.srcObject = stream ? new MediaStream(stream.getVideoTracks()) : null;
  }

  useEffect(() => {
    if (status === "live") refreshPreview();
  }, [status]);

  function trackOf(kind: MediaKind) {
    return streamRef.current?.getTracks().find((t) => t.kind === kind) ?? null;
  }

  function watchTrack(track: MediaStreamTrack) {
    // Camera unplugged or permission revoked: report it as turned off.
    track.onended = () => setDevice(track.kind as MediaKind, false, null);
  }

  /**
   * Turns the host's mic or camera on or off. "Off" stops the hardware completely (camera light off,
   * no encoding, no data sent) but keeps every peer connection open, so "on" resumes instantly.
   */
  function setDevice(kind: MediaKind, enabled: boolean, by: string | null) {
    mediaQueueRef.current(async () => {
      const stream = streamRef.current;
      if (!stream) return;
      const current = trackOf(kind);
      let failed = false;
      if (enabled && !current) {
        try {
          const [track] = (await navigator.mediaDevices.getUserMedia({ [kind]: CONSTRAINTS[kind] })).getTracks();
          if (!streamRef.current) return void track.stop(); // stopped broadcasting meanwhile
          watchTrack(track);
          stream.addTrack(track);
          await Promise.all([...peersRef.current.values()].map((p) => p.senders[kind].replaceTrack(track)));
        } catch {
          failed = true;
        }
      } else if (!enabled && current) {
        current.onended = null;
        current.stop();
        stream.removeTrack(current);
        await Promise.all([...peersRef.current.values()].map((p) => p.senders[kind].replaceTrack(null)));
      }
      const next: MediaState = { audio: !!trackOf("audio"), video: !!trackOf("video"), changedBy: by };
      setMedia(next);
      setError(failed ? `Couldn't turn the ${kind === "audio" ? "mic" : "camera"} back on.` : null);
      if (kind === "video") refreshPreview();
      wsRef.current?.send(JSON.stringify({ type: "media-state", ...next }));
    });
  }

  function removePeer(viewerId: string) {
    peersRef.current.get(viewerId)?.pc.close();
    peersRef.current.delete(viewerId);
    setViewers((v) => v.filter((x) => x.id !== viewerId));
  }

  function addViewer(ws: WebSocket, viewer: Omit<ViewerInfo, "joinedAt">) {
    const stream = streamRef.current!;
    const pc = new RTCPeerConnection(rtcConfig);
    const enqueue = createQueue();
    const senders = {} as Record<MediaKind, RTCRtpSender>;
    // One transceiver per kind even when that device is off, so it can be switched on later.
    for (const kind of KINDS) {
      const transceiver = pc.addTransceiver(trackOf(kind) ?? kind, { direction: "sendonly", streams: [stream] });
      preferEfficientCodecs(transceiver, kind);
      senders[kind] = transceiver.sender;
    }
    peersRef.current.set(viewer.id, { pc, enqueue, senders });
    setViewers((v) => [...v, { ...viewer, joinedAt: Date.now() }]);

    pc.onicecandidate = (e) => {
      if (e.candidate) ws.send(JSON.stringify({ type: "signal", to: viewer.id, data: { candidate: e.candidate } }));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") removePeer(viewer.id);
    };

    enqueue(async () => {
      await pc.setLocalDescription(await pc.createOffer());
      ws.send(JSON.stringify({ type: "signal", to: viewer.id, data: { sdp: pc.localDescription } }));
    });
  }

  function handleMessage(msg: ServerMessage) {
    const ws = wsRef.current;
    if (!ws) return;
    if (msg.type === "viewer-joined") {
      addViewer(ws, { id: msg.viewerId, name: msg.name, isAdmin: msg.isAdmin });
    } else if (msg.type === "viewer-left") {
      removePeer(msg.viewerId);
    } else if (msg.type === "set-media") {
      setDevice(msg.kind, msg.enabled, msg.by ?? null);
    } else if (msg.type === "signal" && msg.from) {
      const peer = peersRef.current.get(msg.from);
      if (!peer) return;
      const { data } = msg;
      peer.enqueue(() =>
        "sdp" in data ? peer.pc.setRemoteDescription(data.sdp) : peer.pc.addIceCandidate(data.candidate),
      );
    }
  }

  async function start() {
    setError(null);
    setStatus("starting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access needs HTTPS (or localhost). See the README.");
      }
      streamRef.current = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
      streamRef.current.getTracks().forEach(watchTrack);
      setMedia({ audio: true, video: true, changedBy: null });

      const ws = await openSignaling((msg) => {
        if (msg.type === "host-ok") {
          setCode(msg.code);
          setStatus("live");
          navigator.wakeLock?.request("screen").then((l) => (wakeLockRef.current = l), () => {});
        } else if (msg.type === "error") {
          stopAll();
          setError(msg.message);
          setStatus("setup");
        } else {
          handleMessage(msg);
        }
      });
      wsRef.current = ws;
      ws.onclose = () => {
        if (wsRef.current === ws) {
          stopAll();
          setError("Lost connection to the server.");
          setStatus("setup");
        }
      };
      ws.send(JSON.stringify({ type: "host", password: password.trim() }));
    } catch (err) {
      stopAll();
      const denied = err instanceof DOMException && err.name === "NotAllowedError";
      setError(denied ? "Camera/microphone permission was denied." : (err as Error).message);
      setStatus("setup");
    }
  }

  function stop() {
    stopAll();
    setViewers([]);
    setCode(null);
    setStatus("setup");
  }

  if (status !== "live") {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <form
          className="w-full max-w-sm flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
        >
          <div>
            <h1 className="text-2xl font-semibold">Host a camera</h1>
            <p className="text-sm text-neutral-500 mt-1">
              You&apos;ll get a 6-character code. Share it with the people who should watch.
            </p>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm">
              Password <span className="text-neutral-500">(optional)</span>
            </span>
            <input
              type="password"
              autoComplete="new-password"
              maxLength={64}
              placeholder="Leave empty for code only"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-3 outline-none focus:border-blue-500"
            />
          </label>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={status === "starting"}
            className="rounded-lg bg-blue-600 text-white py-3 font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {status === "starting" ? "Please wait…" : "Start camera"}
          </button>
        </form>
      </main>
    );
  }

  const hasPassword = password.trim() !== "";

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
      <div className="flex w-full max-w-4xl flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" /> LIVE
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              navigator.clipboard?.writeText(code ?? "").then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            title="Copy code"
            className="flex items-center gap-3 rounded-lg border border-neutral-300 dark:border-neutral-700 px-4 py-2 hover:border-blue-500"
          >
            <span className="text-xs text-neutral-500">Code</span>
            <span className="font-mono text-2xl font-semibold tracking-[0.3em]">{code}</span>
            <span className="text-xs text-neutral-500 w-10">{copied ? "Copied" : "Copy"}</span>
          </button>
          {hasPassword && (
            <button
              onClick={() => setShowPassword((s) => !s)}
              title={showPassword ? "Hide password" : "Show password"}
              className="flex items-center gap-3 rounded-lg border border-neutral-300 dark:border-neutral-700 px-4 py-2 hover:border-blue-500"
            >
              <span className="text-xs text-neutral-500">Password</span>
              <span className="font-mono">{showPassword ? password.trim() : "••••••"}</span>
            </button>
          )}
        </div>
      </div>
      <div className="flex w-full max-w-4xl flex-col gap-4 md:flex-row md:items-start">
        <div className="relative min-w-0 flex-1">
          <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-xl bg-black aspect-video object-contain" />
          {!media.video && (
            <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-neutral-900 text-neutral-400">
              <span>Camera is off</span>
              {media.changedBy && <span className="text-xs mt-1">Turned off by {media.changedBy}</span>}
            </div>
          )}
          {!media.audio && (
            <span className="absolute left-3 top-3 rounded-md bg-red-600 px-2 py-1 text-xs text-white">
              Mic off{media.changedBy ? ` · ${media.changedBy}` : ""}
            </span>
          )}
        </div>
        <aside className="md:w-64 shrink-0 rounded-xl border border-neutral-300 dark:border-neutral-700 p-4">
          <h2 className="text-sm font-medium">
            Watching now <span className="text-neutral-500">({viewers.length})</span>
          </h2>
          {viewers.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">No one yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {viewers.map((v) => (
                <li key={v.id} className="group flex items-center justify-between gap-2 text-sm py-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{v.name}</span>
                    {v.isAdmin && (
                      <span className="shrink-0 rounded bg-amber-500/20 px-1.5 text-[10px] font-medium uppercase text-amber-600 dark:text-amber-400">
                        admin
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-neutral-500">
                      {new Date(v.joinedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <button
                      onClick={() => wsRef.current?.send(JSON.stringify({ type: "kick", viewerId: v.id }))}
                      title={`Remove ${v.name}`}
                      className="rounded px-2 py-0.5 text-xs text-red-500 hover:bg-red-500/10"
                    >
                      Remove
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex items-center gap-3">
        <MediaButton kind="audio" enabled={media.audio} onToggle={() => setDevice("audio", !media.audio, "Host")} />
        <MediaButton kind="video" enabled={media.video} onToggle={() => setDevice("video", !media.video, "Host")} />
        <button onClick={stop} className="rounded-lg bg-neutral-800 text-white px-6 py-3 hover:bg-neutral-700">
          Stop broadcasting
        </button>
      </div>
    </main>
  );
}
