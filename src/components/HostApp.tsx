"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { MediaButton } from "@/components/MediaButton";
import { TalkIndicator } from "@/components/TalkIndicator";
import { Avatar, CardHeader, ErrorMessage, Field, FormCard, Screen, SubmitButton } from "@/components/ui";
import {
  createQueue,
  openSignaling,
  preferEfficientCodecs,
  rtcConfig,
  type MediaKind,
  type MediaState,
  type ServerMessage,
} from "@/lib/rtc";

type Peer = {
  pc: RTCPeerConnection;
  enqueue: ReturnType<typeof createQueue>;
  senders: Record<MediaKind, RTCRtpSender>;
  /** Viewer → host audio (the viewer's own mic). Silent until they switch it on. */
  talk: RTCRtpTransceiver;
  speaker: HTMLAudioElement;
};
type ViewerInfo = { id: string; name: string; isAdmin: boolean; joinedAt: number; micOn: boolean };

// A viewer counts as speaking while their mic level is above this (0–1), plus a short hold so the
// indicator doesn't flicker between words.
const SPEAKING_LEVEL = 0.03;
const SPEAKING_HOLD_MS = 700;

const KINDS: MediaKind[] = ["audio", "video"];
const CONSTRAINTS: Record<MediaKind, MediaTrackConstraints> = {
  video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
  audio: { echoCancellation: true, noiseSuppression: true },
};

export function HostApp({ onBack }: { onBack: () => void }) {
  // Which host account is logged in: undefined while checking, null when logged out.
  const [account, setAccount] = useState<string | null | undefined>(undefined);
  const [loggingIn, setLoggingIn] = useState(false);
  const [status, setStatus] = useState<"setup" | "starting" | "live">("setup");
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewers, setViewers] = useState<ViewerInfo[]>([]);
  const [media, setMedia] = useState<MediaState>({ audio: true, video: true, changedBy: null });
  const [speaking, setSpeaking] = useState<ReadonlySet<string>>(new Set());
  // Set if the browser's autoplay policy stopped viewer voices from playing; one click fixes it.
  const [voicesBlocked, setVoicesBlocked] = useState(false);
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
    for (const { pc, speaker } of peersRef.current.values()) {
      pc.close();
      speaker.srcObject = null;
    }
    peersRef.current.clear();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }

  useEffect(() => stopAll, []);

  useEffect(() => {
    fetch("/api/host/session")
      .then((r) => r.json())
      .then((body: { loggedIn?: boolean; username?: string }) => setAccount(body.loggedIn ? body.username! : null))
      .catch(() => setAccount(null));
  }, []);

  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setLoggingIn(true);
    setError(null);
    try {
      const res = await fetch("/api/host/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
      });
      const body = await res.json();
      if (res.ok) setAccount(body.username);
      else setError(body.error ?? "Login failed.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoggingIn(false);
    }
  }

  async function logout() {
    await fetch("/api/host/logout", { method: "POST" }).catch(() => {});
    setError(null);
    setAccount(null);
  }

  // Only the camera goes to the preview (it's muted anyway); a fresh MediaStream makes the <video> re-render.
  function refreshPreview() {
    const stream = streamRef.current;
    if (videoRef.current) videoRef.current.srcObject = stream ? new MediaStream(stream.getVideoTracks()) : null;
  }

  useEffect(() => {
    if (status === "live") refreshPreview();
  }, [status]);

  // Poll each viewer's incoming mic level to show who is speaking.
  const micOnIds = viewers.filter((v) => v.micOn).map((v) => v.id).join(",");
  useEffect(() => {
    const ids = micOnIds ? micOnIds.split(",") : [];
    const lastLoud = new Map<string, number>();
    const timer = setInterval(() => {
      const now = performance.now();
      const next = new Set<string>();
      for (const id of ids) {
        const level = peersRef.current.get(id)?.talk.receiver.getSynchronizationSources?.()[0]?.audioLevel ?? 0;
        if (level > SPEAKING_LEVEL) lastLoud.set(id, now);
        if (now - (lastLoud.get(id) ?? -Infinity) < SPEAKING_HOLD_MS) next.add(id);
      }
      setSpeaking((prev) => (prev.size === next.size && [...next].every((id) => prev.has(id)) ? prev : next));
    }, 150);
    return () => {
      clearInterval(timer);
      setSpeaking(new Set());
    };
  }, [micOnIds]);

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
    const peer = peersRef.current.get(viewerId);
    peer?.pc.close();
    if (peer) peer.speaker.srcObject = null;
    peersRef.current.delete(viewerId);
    setViewers((v) => v.filter((x) => x.id !== viewerId));
  }

  function addViewer(ws: WebSocket, viewer: Omit<ViewerInfo, "joinedAt" | "micOn">) {
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
    // Receive-only channel for the viewer's voice. Its track exists right away and simply stays
    // silent until the viewer switches their mic on, so talking never needs renegotiation.
    const talk = pc.addTransceiver("audio", { direction: "recvonly" });
    const speaker = new Audio();
    speaker.autoplay = true;
    speaker.srcObject = new MediaStream([talk.receiver.track]);
    speaker.play().catch(() => setVoicesBlocked(true)); // normally allowed: the host clicked "Start camera"
    peersRef.current.set(viewer.id, { pc, enqueue, senders, talk, speaker });
    setViewers((v) => [...v, { ...viewer, joinedAt: Date.now(), micOn: false }]);

    pc.onicecandidate = (e) => {
      if (e.candidate) ws.send(JSON.stringify({ type: "signal", to: viewer.id, data: { candidate: e.candidate } }));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") removePeer(viewer.id);
    };

    enqueue(async () => {
      await pc.setLocalDescription(await pc.createOffer());
      ws.send(
        JSON.stringify({ type: "signal", to: viewer.id, data: { sdp: pc.localDescription, talkMid: talk.mid } }),
      );
    });
  }

  function handleMessage(msg: ServerMessage) {
    const ws = wsRef.current;
    if (!ws) return;
    if (msg.type === "viewer-joined") {
      addViewer(ws, { id: msg.viewerId, name: msg.name, isAdmin: msg.isAdmin });
    } else if (msg.type === "viewer-mic") {
      setViewers((v) => v.map((x) => (x.id === msg.viewerId ? { ...x, micOn: msg.enabled } : x)));
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
        } else if (msg.type === "host-revoked") {
          // Account deleted/changed by the admin, or the login expired: back to the login form.
          stopAll();
          setViewers([]);
          setCode(null);
          setAccount(null);
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

  if (account === undefined) return null;

  if (account === null) {
    return (
      <Screen>
        <FormCard onBack={onBack}>
          <CardHeader icon="lock" title="Host login">
            Log in with the host account the admin gave you.
          </CardHeader>
          <form onSubmit={login} className="flex flex-col gap-4">
            <Field label="Username" name="username" required autoComplete="username" autoCapitalize="none" />
            <Field label="Password" name="password" type="password" required autoComplete="current-password" />
            <ErrorMessage>{error}</ErrorMessage>
            <SubmitButton busy={loggingIn}>Log in</SubmitButton>
          </form>
        </FormCard>
      </Screen>
    );
  }

  if (status !== "live") {
    return (
      <Screen>
        <FormCard onBack={onBack}>
          <CardHeader icon="video" title="Go live">
            You&apos;ll get a 6-character code to share with the people who should watch.
          </CardHeader>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3.5 py-2.5">
            <span className="flex min-w-0 items-center gap-2.5">
              <Avatar name={account} />
              <span className="min-w-0">
                <span className="block text-xs text-muted">Logged in as</span>
                <span className="block truncate text-sm font-semibold">{account}</span>
              </span>
            </span>
            <button type="button" onClick={logout} className="btn btn-sm text-muted hover:text-fg">
              <Icon name="logOut" className="h-4 w-4" /> Log out
            </button>
          </div>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              start();
            }}
          >
            <Field
              label="Stream password"
              optional
              type="password"
              autoComplete="new-password"
              maxLength={64}
              placeholder="Leave empty to use the code only"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              hint="Viewers type this along with the code. It's not your account password."
            />
            <ErrorMessage>{error}</ErrorMessage>
            <SubmitButton busy={status === "starting"}>
              <Icon name="video" /> Start camera
            </SubmitButton>
          </form>
        </FormCard>
      </Screen>
    );
  }

  const hasPassword = password.trim() !== "";

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-3 sm:p-6 lg:flex-row lg:items-start">
      <section className="flex min-w-0 flex-col gap-3 lg:flex-1">
        {/* Share bar: the code (tap to copy) and the optional stream password */}
        <div className="card flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <span className="live-dot h-2 w-2 rounded-full bg-danger" />
            LIVE <span className="font-normal text-muted">· {account}</span>
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                navigator.clipboard?.writeText(code ?? "").then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              title="Copy code"
              className="flex items-center gap-3 rounded-xl bg-surface-2 py-1.5 pl-3.5 pr-2.5 transition-colors hover:bg-line"
            >
              <span className="text-xs font-medium text-muted">Code</span>
              <span className="font-mono text-xl font-semibold tracking-[0.2em]">{code}</span>
              <span className={copied ? "text-success" : "text-muted"}>
                <Icon name={copied ? "check" : "copy"} className="h-4 w-4" />
              </span>
            </button>
            {hasPassword && (
              <button
                onClick={() => setShowPassword((v) => !v)}
                title={showPassword ? "Hide password" : "Show password"}
                className="flex items-center gap-3 rounded-xl bg-surface-2 py-2 pl-3.5 pr-2.5 transition-colors hover:bg-line"
              >
                <span className="text-xs font-medium text-muted">Password</span>
                <span className="font-mono text-sm">{showPassword ? password.trim() : "••••••"}</span>
                <Icon name={showPassword ? "eyeOff" : "eye"} className="h-4 w-4 text-muted" />
              </button>
            )}
          </div>
        </div>

        {/* Camera preview with call-style controls */}
        <div className="relative overflow-hidden rounded-[20px] bg-black">
          <video ref={videoRef} autoPlay playsInline muted className="aspect-video w-full object-contain" />
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
          {!media.audio && (
            <span className="on-video absolute left-3 top-3 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium">
              <Icon name="mic" slash className="h-3.5 w-3.5" />
              Mic off{media.changedBy ? ` · ${media.changedBy}` : ""}
            </span>
          )}
          {/* Below the video on phones (so it doesn't cover a small preview), floating over it on larger screens */}
          <div className="flex justify-center p-3 sm:absolute sm:bottom-4 sm:left-1/2 sm:-translate-x-1/2 sm:p-0">
            <div className="on-video flex items-center gap-2.5 p-2">
              <MediaButton kind="audio" enabled={media.audio} onToggle={() => setDevice("audio", !media.audio, "Host")} />
              <MediaButton kind="video" enabled={media.video} onToggle={() => setDevice("video", !media.video, "Host")} />
              <button onClick={stop} title="Stop broadcasting" aria-label="Stop broadcasting" className="ctl ctl-danger w-auto gap-2 px-5 font-semibold">
                <Icon name="end" className="h-[22px] w-[22px]" />
                <span className="text-sm">End</span>
              </button>
            </div>
          </div>
        </div>
        <ErrorMessage>{error}</ErrorMessage>
      </section>

      {/* Who's watching */}
      <aside className="card w-full shrink-0 p-4 lg:w-80">
        <h2 className="flex items-center gap-2 px-1 text-sm font-semibold">
          <Icon name="users" className="h-4 w-4 text-muted" /> Watching
          <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">{viewers.length}</span>
        </h2>
        {voicesBlocked && (
          <button
            onClick={() => {
              for (const { speaker } of peersRef.current.values()) speaker.play().catch(() => {});
              setVoicesBlocked(false);
            }}
            className="btn btn-sm mt-3 w-full bg-warning/15 text-warning"
          >
            Click to hear viewers
          </button>
        )}
        {viewers.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-muted">No one yet. Share the code to invite people.</p>
        ) : (
          <ul className="mt-2 flex flex-col">
            {viewers.map((v) => {
              const isSpeaking = speaking.has(v.id);
              return (
                <li key={v.id} className="flex items-center gap-3 rounded-xl px-1 py-2">
                  <Avatar name={v.name} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className={`truncate text-sm font-medium ${isSpeaking ? "text-success" : ""}`}>{v.name}</span>
                      <TalkIndicator micOn={v.micOn} speaking={isSpeaking} />
                      {v.isAdmin && <span className="chip bg-warning/15 text-warning">Admin</span>}
                    </span>
                    <span className="block text-xs text-muted">
                      Joined {new Date(v.joinedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </span>
                  <button
                    onClick={() => wsRef.current?.send(JSON.stringify({ type: "kick", viewerId: v.id }))}
                    title={`Remove ${v.name}`}
                    aria-label={`Remove ${v.name}`}
                    className="btn btn-sm btn-ghost-danger px-2.5"
                  >
                    <Icon name="x" className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
    </main>
  );
}
