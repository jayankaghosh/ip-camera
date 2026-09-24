"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { JoinForm } from "@/components/JoinForm";
import { MediaButton } from "@/components/MediaButton";
import { createQueue, openSignaling, rtcConfig, type MediaKind, type MediaState } from "@/lib/rtc";

type Stats = { codec: string; resolution: string; fps: number; kbps: number };

export default function ViewPage() {
  return (
    <Suspense fallback={null}>
      <Viewer />
    </Suspense>
  );
}

function Viewer() {
  const params = useSearchParams();
  const initialCode = (params.get("code") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  const asAdmin = params.get("admin") === "1" && initialCode.length === 6;

  const [status, setStatus] = useState<"login" | "joining" | "connecting" | "watching">("login");
  const [error, setError] = useState<string | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [media, setMedia] = useState<MediaState>({ audio: true, video: true, changedBy: null });
  const [pending, setPending] = useState<MediaKind | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  function stopAll() {
    wsRef.current?.close();
    wsRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    remoteStreamRef.current = null;
  }

  useEffect(() => stopAll, []);

  function fail(message: string) {
    stopAll();
    setError(message);
    setStats(null);
    setPending(null);
    setStatus("login");
  }

  // Attach the stream once the <video> element is on screen; retry muted if autoplay with sound is blocked.
  useEffect(() => {
    const video = videoRef.current;
    if (status !== "watching" || !video || !remoteStreamRef.current) return;
    video.srcObject = remoteStreamRef.current;
    video.play().catch(() => {
      video.muted = true;
      setNeedsTap(true);
      video.play().catch(() => {});
    });
  }, [status]);

  // Show which codec was negotiated plus live bitrate/resolution.
  useEffect(() => {
    if (status !== "watching") return;
    let lastBytes = 0;
    let lastTime = 0;
    const timer = setInterval(async () => {
      const pc = pcRef.current;
      if (!pc) return;
      const report = await pc.getStats();
      report.forEach((s) => {
        if (s.type !== "inbound-rtp" || s.kind !== "video") return;
        const codec = s.codecId ? report.get(s.codecId)?.mimeType?.replace("video/", "") : "?";
        const kbps = lastTime ? ((s.bytesReceived - lastBytes) * 8) / (s.timestamp - lastTime) : 0;
        lastBytes = s.bytesReceived;
        lastTime = s.timestamp;
        setStats({
          codec: codec ?? "?",
          resolution: s.frameWidth ? `${s.frameWidth}×${s.frameHeight}` : "—",
          fps: Math.round(s.framesPerSecond ?? 0),
          kbps: Math.round(kbps),
        });
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [status]);

  async function join(name: string, code: string, password: string) {
    setError(null);
    setStatus("joining");
    const enqueue = createQueue();
    try {
      const ws = await openSignaling((msg) => {
        if (msg.type === "error") return fail(msg.message);
        if (msg.type === "host-left") return fail("The host stopped broadcasting.");
        if (msg.type === "kicked") return fail("The host removed you from this stream.");
        if (msg.type === "join-ok") {
          setMedia(msg.media);
          return setStatus("connecting");
        }
        if (msg.type === "media-state") {
          setMedia(msg.media);
          return setPending(null);
        }
        if (msg.type !== "signal") return;

        const { data } = msg;
        if ("sdp" in data) {
          pcRef.current?.close();
          const pc = new RTCPeerConnection(rtcConfig);
          pcRef.current = pc;
          pc.onicecandidate = (e) => {
            if (e.candidate) ws.send(JSON.stringify({ type: "signal", data: { candidate: e.candidate } }));
          };
          pc.ontrack = (e) => {
            remoteStreamRef.current = e.streams[0];
            setStatus("watching");
          };
          pc.onconnectionstatechange = () => {
            if (pc.connectionState === "failed") fail("Could not connect to the camera (network blocked?).");
          };
          enqueue(async () => {
            await pc.setRemoteDescription(data.sdp);
            await pc.setLocalDescription(await pc.createAnswer());
            ws.send(JSON.stringify({ type: "signal", data: { sdp: pc.localDescription } }));
          });
        } else {
          enqueue(() => pcRef.current!.addIceCandidate(data.candidate));
        }
      });
      wsRef.current = ws;
      ws.onclose = () => {
        if (wsRef.current === ws) fail("Lost connection to the server.");
      };
      ws.send(JSON.stringify({ type: "join", name, code, password, asAdmin }));
    } catch (err) {
      fail((err as Error).message);
    }
  }

  // Asks the host device to switch its mic/camera; the button updates once the host confirms.
  function toggle(kind: MediaKind) {
    setPending(kind);
    setTimeout(() => setPending(null), 5000); // don't lock the buttons if the host never answers
    wsRef.current?.send(JSON.stringify({ type: "set-media", kind, enabled: !media[kind] }));
  }

  if (status === "login" || status === "joining") {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        {asAdmin ? (
          <div className="w-full max-w-sm flex flex-col gap-4">
            <div>
              <h1 className="text-2xl font-semibold">Watch as admin</h1>
              <p className="text-sm text-neutral-500 mt-1">
                Stream <span className="font-mono">{initialCode}</span>. The host will see you as &quot;Admin&quot;.
              </p>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              onClick={() => join("", initialCode, "")}
              disabled={status === "joining"}
              className="rounded-lg bg-blue-600 text-white py-3 font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {status === "joining" ? "Please wait…" : "Watch"}
            </button>
          </div>
        ) : (
          <JoinForm initialCode={initialCode} busy={status === "joining"} error={error} onSubmit={join} />
        )}
      </main>
    );
  }

  if (status === "connecting") {
    return (
      <main className="flex flex-1 items-center justify-center p-6 text-neutral-500">Connecting to camera…</main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
      <div className="relative w-full max-w-4xl">
        <video ref={videoRef} autoPlay playsInline controls className="w-full rounded-xl bg-black aspect-video object-contain" />
        {!media.video && (
          <div className="pointer-events-none absolute inset-0 bottom-12 flex flex-col items-center justify-center rounded-t-xl bg-neutral-900 text-neutral-400">
            <span>Camera is off</span>
            {media.changedBy && <span className="text-xs mt-1">Turned off by {media.changedBy}</span>}
          </div>
        )}
        {stats && media.video && (
          <div className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 font-mono text-xs text-white">
            {stats.codec} · {stats.resolution} · {stats.fps}fps · {stats.kbps} kbps
          </div>
        )}
        {!media.audio && (
          <span className="absolute right-3 top-3 rounded-md bg-red-600 px-2 py-1 text-xs text-white">
            Host mic off{media.changedBy ? ` · ${media.changedBy}` : ""}
          </span>
        )}
        {needsTap && media.audio && (
          <button
            onClick={() => {
              if (videoRef.current) videoRef.current.muted = false;
              setNeedsTap(false);
            }}
            className="absolute inset-x-0 bottom-16 mx-auto w-fit rounded-lg bg-white/90 px-4 py-2 text-sm font-medium text-black"
          >
            🔇 Tap to unmute
          </button>
        )}
      </div>
      <div className="flex items-center gap-3">
        <MediaButton kind="audio" enabled={media.audio} disabled={pending !== null} onToggle={() => toggle("audio")} />
        <MediaButton kind="video" enabled={media.video} disabled={pending !== null} onToggle={() => toggle("video")} />
        <button
          onClick={() => {
            stopAll();
            setStats(null);
            setStatus("login");
          }}
          className="rounded-lg bg-neutral-800 text-white px-6 py-3 hover:bg-neutral-700"
        >
          Leave
        </button>
      </div>
      <p className="text-xs text-neutral-500">The mic and camera buttons switch the host&apos;s device on or off for everyone.</p>
    </main>
  );
}
