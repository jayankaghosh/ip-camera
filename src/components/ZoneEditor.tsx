"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import type { Zone } from "@/lib/alerts/types";

type Box = { x: number; y: number; w: number; h: number };
const MIN_SIZE = 0.04; // ignore accidental taps: boxes must be at least 4% of the frame each way

/** Where the picture actually is inside an object-contain <video> (it may be letterboxed). */
function contentBox(video: HTMLVideoElement): Box | null {
  const { clientWidth: cw, clientHeight: ch, videoWidth: vw, videoHeight: vh } = video;
  if (!cw || !ch || !vw || !vh) return null;
  const scale = Math.min(cw / vw, ch / vh);
  const w = vw * scale;
  const h = vh * scale;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Drag on the camera preview to draw watched areas. Coordinates are stored as fractions of the
 * camera frame, so they line up regardless of screen size or letterboxing.
 */
export function ZoneEditor({
  videoRef,
  zones,
  onChange,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  zones: Zone[];
  onChange: (zones: Zone[]) => void;
}) {
  const [frame, setFrame] = useState<Box | null>(null);
  const [draft, setDraft] = useState<Box | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const layer = useRef<HTMLDivElement>(null);

  // Track the picture's position as the video loads or the layout changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const update = () => setFrame(contentBox(video));
    const observer = new ResizeObserver(update);
    observer.observe(video);
    video.addEventListener("loadedmetadata", update);
    video.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      video.removeEventListener("loadedmetadata", update);
      video.removeEventListener("resize", update);
    };
  }, [videoRef]);

  function point(e: React.PointerEvent) {
    const r = layer.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  }

  function boxFrom(a: { x: number; y: number }, b: { x: number; y: number }): Box {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
  }

  if (!frame) return null;

  const pct = (b: Box) => ({ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` });

  return (
    <div
      ref={layer}
      className="absolute cursor-crosshair touch-none select-none"
      style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = point(e);
        setDraft({ ...start.current, w: 0, h: 0 });
      }}
      onPointerMove={(e) => start.current && setDraft(boxFrom(start.current, point(e)))}
      onPointerUp={(e) => {
        if (!start.current) return;
        const box = boxFrom(start.current, point(e));
        start.current = null;
        setDraft(null);
        if (box.w >= MIN_SIZE && box.h >= MIN_SIZE) onChange([...zones, { id: crypto.randomUUID(), ...box }]);
      }}
      onPointerCancel={() => {
        start.current = null;
        setDraft(null);
      }}
    >
      {zones.map((z, i) => (
        <div key={z.id} className="absolute rounded-md border-2 border-[#ffd60a] bg-[#ffd60a]/15" style={pct(z)}>
          <span className="absolute left-1 top-1 rounded bg-[#ffd60a] px-1.5 text-[11px] font-bold text-black">{i + 1}</span>
          <button
            type="button"
            onClick={() => onChange(zones.filter((x) => x.id !== z.id))}
            aria-label={`Remove area ${i + 1}`}
            className="absolute -right-2.5 -top-2.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black text-white ring-2 ring-[#ffd60a]"
          >
            <Icon name="x" className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {draft && <div className="absolute rounded-md border-2 border-dashed border-white bg-white/10" style={pct(draft)} />}
    </div>
  );
}
