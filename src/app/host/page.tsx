"use client";

import { useEffect, useRef, useState } from "react";
import { createQueue, openSignaling, preferEfficientCodecs, rtcConfig, type ServerMessage } from "@/lib/rtc";

type Peer = { pc: RTCPeerConnection; enqueue: ReturnType<typeof createQueue> };
type ViewerInfo = { id: string; name: string; joinedAt: number };

export default function HostPage() {
  const [status, setStatus] = useState<"setup" | "starting" | "live">("setup");
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewers, setViewers] = useState<ViewerInfo[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const peersRef = useRef(new Map<string, Peer>());
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

  useEffect(() => {
    if (status === "live" && videoRef.current) videoRef.current.srcObject = streamRef.current;
  }, [status]);

  function removePeer(viewerId: string) {
    peersRef.current.get(viewerId)?.pc.close();
    peersRef.current.delete(viewerId);
    setViewers((v) => v.filter((x) => x.id !== viewerId));
  }

  function addViewer(ws: WebSocket, viewerId: string, name: string) {
    const stream = streamRef.current!;
    const pc = new RTCPeerConnection(rtcConfig);
    const enqueue = createQueue();
    peersRef.current.set(viewerId, { pc, enqueue });
    setViewers((v) => [...v, { id: viewerId, name, joinedAt: Date.now() }]);

    for (const track of stream.getTracks()) {
      const transceiver = pc.addTransceiver(track, { direction: "sendonly", streams: [stream] });
      preferEfficientCodecs(transceiver, track.kind as "audio" | "video");
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) ws.send(JSON.stringify({ type: "signal", to: viewerId, data: { candidate: e.candidate } }));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") removePeer(viewerId);
    };

    enqueue(async () => {
      await pc.setLocalDescription(await pc.createOffer());
      ws.send(JSON.stringify({ type: "signal", to: viewerId, data: { sdp: pc.localDescription } }));
    });
  }

  function handleMessage(msg: ServerMessage) {
    const ws = wsRef.current;
    if (!ws) return;
    if (msg.type === "viewer-joined") {
      addViewer(ws, msg.viewerId, msg.name);
    } else if (msg.type === "viewer-left") {
      removePeer(msg.viewerId);
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
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });

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
      ws.send(JSON.stringify({ type: "host" }));
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
        <div className="w-full max-w-sm flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Host a camera</h1>
            <p className="text-sm text-neutral-500 mt-1">
              You&apos;ll get a 6-character code. Share it with the people who should watch.
            </p>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            onClick={start}
            disabled={status === "starting"}
            className="rounded-lg bg-blue-600 text-white py-3 font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {status === "starting" ? "Please wait…" : "Start camera"}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
      <div className="flex w-full max-w-4xl flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" /> LIVE
        </span>
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
      </div>
      <div className="flex w-full max-w-4xl flex-col gap-4 md:flex-row">
        <video ref={videoRef} autoPlay playsInline muted className="w-full min-w-0 flex-1 rounded-xl bg-black" />
        <aside className="md:w-60 shrink-0 rounded-xl border border-neutral-300 dark:border-neutral-700 p-4">
          <h2 className="text-sm font-medium">
            Watching now <span className="text-neutral-500">({viewers.length})</span>
          </h2>
          {viewers.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">No one yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {viewers.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{v.name}</span>
                  <span className="shrink-0 text-xs text-neutral-500">
                    {new Date(v.joinedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
      <button onClick={stop} className="rounded-lg bg-neutral-800 text-white px-6 py-3 hover:bg-neutral-700">
        Stop broadcasting
      </button>
    </main>
  );
}
