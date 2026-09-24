"use client";

import { useEffect, useRef, useState } from "react";
import { createAlertSender, type ReceivedAlert } from "@/lib/alerts/channel";
import { SoundDetector } from "@/lib/alerts/sound";
import { MotionDetector } from "@/lib/alerts/motion";
import { publishToNtfy } from "@/lib/alerts/ntfy";
import type { NtfyTarget } from "@/lib/rtc";
import { addAlert, listAlerts, pruneAlerts } from "@/lib/alerts/store";
import { enabledSounds, type AlertConfig, type AlertRecord, type AlertType } from "@/lib/alerts/types";

/** One alert per type at most this often, so a cat pacing around doesn't produce dozens. */
const COOLDOWN_MS = 15_000;
const SNAPSHOT_WIDTH = 480;

export type SoundStatus = "off" | "loading" | "listening" | "paused" | "error";
export type NtfyStatus = { state: "idle" } | { state: "sent"; at: number } | { state: "failed"; at: number; error: string };

function toView(r: AlertRecord): ReceivedAlert {
  return { id: r.id, type: r.type, ts: r.ts, streamCode: r.streamCode, detail: r.detail, image: r.image, url: r.image && URL.createObjectURL(r.image) };
}

/** JPEG of the camera right now (mirrored, like the video everyone sees), or null if the camera is off. */
function snapshot(video: HTMLVideoElement | null): Promise<Blob | null> {
  const live = video?.srcObject instanceof MediaStream && video.srcObject.getVideoTracks().some((t) => t.readyState === "live");
  if (!video || !live || !video.videoWidth) return Promise.resolve(null);
  const canvas = document.createElement("canvas");
  canvas.width = SNAPSHOT_WIDTH;
  canvas.height = Math.round((SNAPSHOT_WIDTH * video.videoHeight) / video.videoWidth);
  const ctx = canvas.getContext("2d")!;
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.7));
}

/**
 * Runs the host's alert detectors while live, saves alerts on this device (newest `maxAlerts` kept),
 * and streams them to every viewer's data channel: full history on connect, then live.
 */
export function useHostAlerts({
  account,
  config,
  live,
  streamCode,
  maxAlerts,
  micOn,
  videoRef,
  getMicTrack,
  ntfy,
}: {
  account: string | null | undefined;
  config: AlertConfig;
  live: boolean;
  streamCode: string | null;
  maxAlerts: number;
  micOn: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  getMicTrack: () => MediaStreamTrack | null;
  /** Where to publish push notifications; null disables them. */
  ntfy: NtfyTarget | null;
}) {
  const [alerts, setAlerts] = useState<ReceivedAlert[]>([]);
  const [soundReady, setSoundReady] = useState(false);
  const [soundError, setSoundError] = useState<string | null>(null);
  const [ntfyStatus, setNtfyStatus] = useState<NtfyStatus>({ state: "idle" });

  // Latest values for the async callbacks below.
  const recordsRef = useRef<AlertRecord[]>([]);
  const sendersRef = useRef(new Set<ReturnType<typeof createAlertSender>>());
  const lastFiredRef = useRef(new Map<AlertType, number>());
  const soundRef = useRef<SoundDetector | null>(null);
  const latest = useRef({ account, streamCode, maxAlerts, getMicTrack, ntfy });
  useEffect(() => {
    latest.current = { account, streamCode, maxAlerts, getMicTrack, ntfy };
  });

  function apply(records: AlertRecord[]) {
    recordsRef.current = records;
    setAlerts((old) => {
      old.forEach((a) => a.url && URL.revokeObjectURL(a.url));
      return records.map(toView);
    });
  }

  // Load this account's saved alerts from the device.
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    listAlerts(account)
      .then((records) => !cancelled && apply(records))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [account]);

  // The admin's limit changed (or first arrived): trim and tell viewers.
  useEffect(() => {
    if (!account || !live) return;
    pruneAlerts(account, maxAlerts)
      .then((removed) => {
        const gone = new Set(removed);
        if (removed.length) apply(recordsRef.current.filter((r) => !gone.has(r.id)));
        for (const s of sendersRef.current) {
          s.sendRemoved(removed);
          s.sendMax(maxAlerts);
        }
      })
      .catch(() => {});
  }, [account, live, maxAlerts]);

  async function fire(type: AlertType, detail: string) {
    const { account, streamCode, maxAlerts, ntfy } = latest.current;
    const now = Date.now();
    if (!account || !streamCode || now - (lastFiredRef.current.get(type) ?? 0) < COOLDOWN_MS) return;
    lastFiredRef.current.set(type, now);
    const record: AlertRecord = { id: crypto.randomUUID(), account, streamCode, type, ts: now, detail, image: await snapshot(videoRef.current) };
    const removed = await addAlert(record, maxAlerts).catch(() => [] as string[]);
    const gone = new Set(removed);
    apply([...recordsRef.current.filter((r) => !gone.has(r.id)), record]);
    for (const s of sendersRef.current) {
      s.sendAlert(record);
      s.sendRemoved(removed);
    }
    if (ntfy) {
      publishToNtfy(ntfy.server, ntfy.topic, record)
        .then(() => setNtfyStatus({ state: "sent", at: Date.now() }))
        .catch((err) => setNtfyStatus({ state: "failed", at: Date.now(), error: err instanceof Error ? err.message : String(err) }));
    }
  }

  // Movement detector: runs only while live with at least one area.
  const zonesKey = JSON.stringify(config.zones);
  useEffect(() => {
    if (!live || !config.movement || config.zones.length === 0) return;
    const detector = new MotionDetector(() => videoRef.current, config.zones, config.sensitivity, (i) => fire("movement", `Area ${i + 1}`));
    detector.start();
    return () => detector.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- zonesKey stands in for config.zones
  }, [live, config.movement, zonesKey, config.sensitivity]);

  // Sound detector (meow / dog / crash): loads the model once, listens while live and the mic is on.
  const sounds = enabledSounds(config);
  const soundsKey = sounds.join(",");
  useEffect(() => {
    if (!live || sounds.length === 0) return;
    let cancelled = false;
    SoundDetector.create(sounds, config.sensitivity, (kind, score, label) => fire(kind, `${label} · ${Math.round(score * 100)}%`))
      .then((detector) => {
        if (cancelled) return detector.stop();
        soundRef.current = detector;
        detector.setTrack(latest.current.getMicTrack());
        setSoundError(null);
        setSoundReady(true);
      })
      .catch((err) => !cancelled && setSoundError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
      soundRef.current?.stop();
      soundRef.current = null;
      setSoundReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- soundsKey stands in for sounds; fire reads refs
  }, [live, soundsKey, config.sensitivity]);

  // Follow the host's mic being switched off/on (by the host or a viewer).
  useEffect(() => {
    soundRef.current?.setTrack(micOn ? latest.current.getMicTrack() : null);
  }, [micOn, soundReady]);

  const soundStatus: SoundStatus =
    !live || sounds.length === 0 ? "off" : soundError ? "error" : !soundReady ? "loading" : micOn ? "listening" : "paused";

  return {
    /** Only this stream's alerts; older streams' stay saved on the device (up to the limit) but hidden. */
    alerts: alerts.filter((a) => a.streamCode === streamCode),
    soundStatus,
    soundError,
    ntfyStatus,
    /** Hook up a new viewer's data channel: history once it opens, then live alerts. */
    attach(channel: RTCDataChannel) {
      const sender = createAlertSender(channel);
      channel.onopen = () => {
        sendersRef.current.add(sender);
        const { streamCode, maxAlerts } = latest.current;
        sender.sendHistory(recordsRef.current.filter((r) => r.streamCode === streamCode), maxAlerts);
      };
      channel.onclose = () => sendersRef.current.delete(sender);
    },
  };
}
