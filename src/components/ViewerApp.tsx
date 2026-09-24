"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { CardHeader, ErrorMessage, FormCard, Screen, Spinner } from "@/components/ui";
import { JoinForm } from "@/components/JoinForm";
import { MediaButton } from "@/components/MediaButton";
import { createQueue, openSignaling, rtcConfig, type MediaKind, type MediaState } from "@/lib/rtc";

type Stats = { codec: string; resolution: string; fps: number; kbps: number };

export function ViewerApp({
  initialCode,
  asAdmin,
  onBack,
}: {
  initialCode: string;
  asAdmin: boolean;
  onBack: () => void;
}) {
  const [status, setStatus] = useState<"login" | "joining" | "connecting" | "watching">("login");
  const [error, setError] = useState<string | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [media, setMedia] = useState<MediaState>({ audio: true, video: true, changedBy: null });
  const [pending, setPending] = useState<MediaKind | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [micBusy, setMicBusy] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  // Sender of the viewer → host audio channel, and the viewer's own mic track while talking.
  const talkSenderRef = useRef<RTCRtpSender | null>(null);
  const micTrackRef = useRef<MediaStreamTrack | null>(null);

  function stopAll() {
    wsRef.current?.close();
    wsRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    remoteStreamRef.current = null;
    micTrackRef.current?.stop();
    micTrackRef.current = null;
    talkSenderRef.current = null;
  }

  useEffect(() => stopAll, []);

  function fail(message: string) {
    stopAll();
    setError(message);
    setStats(null);
    setPending(null);
    setMicOn(false);
    setMicError(null);
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
            // The host offered a receive-only audio channel for our voice: answer it as send-only.
            // It sends nothing until the mic is switched on (replaceTrack), so no renegotiation later.
            const talk = pc.getTransceivers().find((t) => data.talkMid != null && t.mid === data.talkMid);
            if (talk) {
              talk.direction = "sendonly";
              talkSenderRef.current = talk.sender;
            }
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

  // The viewer's own mic: while on, the host hears them. Off releases the mic completely.
  async function toggleMyMic() {
    const sender = talkSenderRef.current;
    if (!sender) return setMicError("This host doesn't support talking back yet.");
    setMicBusy(true);
    setMicError(null);
    try {
      if (micOn) {
        await sender.replaceTrack(null);
        micTrackRef.current?.stop();
        micTrackRef.current = null;
        setMicOn(false);
        wsRef.current?.send(JSON.stringify({ type: "viewer-mic", enabled: false }));
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        const [track] = stream.getAudioTracks();
        if (!talkSenderRef.current) return void track.stop(); // left meanwhile
        micTrackRef.current = track;
        await sender.replaceTrack(track);
        setMicOn(true);
        wsRef.current?.send(JSON.stringify({ type: "viewer-mic", enabled: true }));
      }
    } catch (err) {
      const denied = err instanceof DOMException && err.name === "NotAllowedError";
      setMicError(denied ? "Microphone permission was denied." : "Couldn't turn on your microphone.");
    } finally {
      setMicBusy(false);
    }
  }

  // Asks the host device to switch its mic/camera; the button updates once the host confirms.
  function toggle(kind: MediaKind) {
    setPending(kind);
    setTimeout(() => setPending(null), 5000); // don't lock the buttons if the host never answers
    wsRef.current?.send(JSON.stringify({ type: "set-media", kind, enabled: !media[kind] }));
  }

  function leave() {
    stopAll();
    setStats(null);
    setMicOn(false);
    setMicError(null);
    setStatus("login");
  }

  // Fullscreen the whole player (so the controls stay visible); iPhone Safari only allows the bare video.
  function toggleFullscreen() {
    const el = playerRef.current;
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (el?.requestFullscreen) el.requestFullscreen().catch(() => {});
    else video?.webkitEnterFullscreen?.();
  }

  if (status === "login" || status === "joining") {
    return (
      <Screen>
        <FormCard onBack={asAdmin ? undefined : onBack}>
          {asAdmin ? (
            <>
              <CardHeader icon="shield" tone="warning" title="Watch as admin">
                Stream <span className="font-mono font-semibold text-fg">{initialCode}</span>. The host will see you as
                &quot;Admin&quot;.
              </CardHeader>
              <ErrorMessage>{error}</ErrorMessage>
              <button onClick={() => join("", initialCode, "")} disabled={status === "joining"} className="btn btn-primary w-full">
                {status === "joining" ? <Spinner /> : <><Icon name="monitor" /> Watch</>}
              </button>
            </>
          ) : (
            <>
              <CardHeader icon="monitor" title="Watch a camera">
                Enter the code the host shared with you.
              </CardHeader>
              <JoinForm initialCode={initialCode} busy={status === "joining"} error={error} onSubmit={join} />
            </>
          )}
        </FormCard>
      </Screen>
    );
  }

  if (status === "connecting") {
    return (
      <Screen>
        <div className="flex flex-col items-center gap-3 text-muted">
          <Spinner className="h-7 w-7" />
          <span className="text-sm">Connecting to camera…</span>
        </div>
      </Screen>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-3 p-3 sm:p-6">
      <div ref={playerRef} className="relative overflow-hidden rounded-[20px] bg-black">
        <video ref={videoRef} autoPlay playsInline className="aspect-video h-full w-full object-contain" />
        {!media.video && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#111] text-white/70">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-white/10">
              <Icon name="video" slash className="h-6 w-6" />
            </span>
            <span className="text-sm">
              Camera is off{media.changedBy && <span className="text-white/50"> · turned off by {media.changedBy}</span>}
            </span>
          </div>
        )}
        <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          {stats && media.video ? (
            <span className="on-video px-2.5 py-1 font-mono text-[11px]">
              {stats.codec} · {stats.resolution} · {stats.fps}fps · {stats.kbps} kbps
            </span>
          ) : (
            <span />
          )}
          {!media.audio && (
            <span className="on-video flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium">
              <Icon name="mic" slash className="h-3.5 w-3.5" />
              Host mic off{media.changedBy ? ` · ${media.changedBy}` : ""}
            </span>
          )}
        </div>
        {needsTap && media.audio && (
          <button
            onClick={() => {
              if (videoRef.current) videoRef.current.muted = false;
              setNeedsTap(false);
            }}
            className="on-video absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 px-5 py-3 text-sm font-semibold"
          >
            <Icon name="volumeOff" /> Tap to unmute
          </button>
        )}
        {/* Below the video on phones, floating over it on larger screens */}
        <div className="flex justify-center p-3 sm:absolute sm:bottom-4 sm:left-1/2 sm:-translate-x-1/2 sm:p-0">
          <div className="on-video flex items-center gap-2 p-2 sm:gap-2.5">
            <MediaButton kind="audio" enabled={media.audio} disabled={pending !== null} onToggle={() => toggle("audio")} />
            <MediaButton kind="video" enabled={media.video} disabled={pending !== null} onToggle={() => toggle("video")} />
            <span className="mx-0.5 h-7 w-px bg-white/25" />
            <button
              onClick={toggleMyMic}
              disabled={micBusy}
              aria-pressed={micOn}
              title={micOn ? "Stop talking" : "Talk to the host"}
              className={`ctl w-auto gap-2 px-4 text-sm font-semibold ${micOn ? "ctl-active" : ""}`}
            >
              <Icon name="mic" className="h-5 w-5" />
              {micOn ? "Talking" : "Talk"}
            </button>
            <button onClick={toggleFullscreen} title="Fullscreen" aria-label="Fullscreen" className="ctl hidden sm:inline-flex">
              <Icon name="maximize" className="h-5 w-5" />
            </button>
            <button onClick={leave} title="Leave" aria-label="Leave" className="ctl ctl-danger">
              <Icon name="end" className="h-[22px] w-[22px]" />
            </button>
          </div>
        </div>
      </div>
      <ErrorMessage>{micError}</ErrorMessage>
      <p className="px-2 text-center text-xs leading-relaxed text-muted">
        The first two buttons turn the <strong className="font-semibold text-fg">host&apos;s</strong> mic and camera on or off for
        everyone. <strong className="font-semibold text-fg">Talk</strong> turns on your own mic so the host can hear you
        {micOn ? " (they can hear you now)" : ""}.
      </p>
    </main>
  );
}
