"use client";

import { useEffect, useRef, useState } from "react";
import { JoinForm } from "@/components/JoinForm";
import { createQueue, openSignaling, rtcConfig } from "@/lib/rtc";

type Stats = { codec: string; resolution: string; fps: number; kbps: number };

export default function ViewPage() {
  const [status, setStatus] = useState<"login" | "joining" | "connecting" | "watching">("login");
  const [error, setError] = useState<string | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
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

  async function join(name: string, code: string) {
    setError(null);
    setStatus("joining");
    const enqueue = createQueue();
    try {
      const ws = await openSignaling((msg) => {
        if (msg.type === "error") return fail(msg.message);
        if (msg.type === "host-left") return fail("The host stopped broadcasting.");
        if (msg.type === "join-ok") return setStatus("connecting");
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
      ws.send(JSON.stringify({ type: "join", name, code }));
    } catch (err) {
      fail((err as Error).message);
    }
  }

  if (status === "login" || status === "joining") {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <JoinForm busy={status === "joining"} error={error} onSubmit={join} />
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
        <video ref={videoRef} autoPlay playsInline controls className="w-full rounded-xl bg-black" />
        {stats && (
          <div className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 font-mono text-xs text-white">
            {stats.codec} · {stats.resolution} · {stats.fps}fps · {stats.kbps} kbps
          </div>
        )}
        {needsTap && (
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
    </main>
  );
}
