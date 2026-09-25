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
/** Screen box ⇄ frame box for a horizontally mirrored preview (the flip is its own inverse). */
const flip = (b: Box): Box => ({ ...b, x: 1 - b.x - b.w });

/**
 * Drag on the camera preview to draw watched areas. Coordinates are stored as fractions of the
 * real (unmirrored) camera frame, so they line up regardless of screen size or letterboxing, and
 * the motion detector can use them directly. The preview itself is shown mirrored, so x is flipped
 * between screen and frame.
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
  const pointerId = useRef<number | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
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

  // iPhone Safari can still scroll or zoom the page during a drag despite touch-action: none, which
  // cancels the drag. Blocking the touch events themselves stops that. React's touch handlers are
  // passive (they can't prevent default), so these are native, non-passive listeners.
  const hasFrame = frame !== null;
  useEffect(() => {
    const el = layer.current;
    if (!el) return;
    const block = (e: TouchEvent) => {
      if (!(e.target as HTMLElement).closest("button")) e.preventDefault();
    };
    el.addEventListener("touchstart", block, { passive: false });
    el.addEventListener("touchmove", block, { passive: false });
    return () => {
      el.removeEventListener("touchstart", block);
      el.removeEventListener("touchmove", block);
    };
  }, [hasFrame]);

  function point(e: React.PointerEvent) {
    const r = layer.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  }

  function boxFrom(a: { x: number; y: number }, b: { x: number; y: number }): Box {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
  }

  /** Finish the current drag, keeping the box if it's big enough (also on cancel, so an interrupted drag isn't lost). */
  function finish(end: { x: number; y: number } | null) {
    const from = start.current;
    start.current = null;
    pointerId.current = null;
    setDraft(null);
    if (!from || !end) return;
    const box = boxFrom(from, end);
    if (box.w >= MIN_SIZE && box.h >= MIN_SIZE) onChange([...zones, { id: crypto.randomUUID(), ...flip(box) }]);
  }

  if (!frame) return null;

  const pct = (b: Box) => ({ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` });

  return (
    <div
      ref={layer}
      className="absolute cursor-crosshair touch-none select-none [-webkit-touch-callout:none]"
      style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}
      onPointerDown={(e) => {
        // One finger draws; ignore a second finger (or a second mouse button) mid-drag.
        if ((e.target as HTMLElement).closest("button") || pointerId.current !== null || !e.isPrimary) return;
        // Capture keeps the drag going if the finger slides off the picture. Some mobile browsers
        // throw here (e.g. a very quick tap already released the pointer); the drag must still work.
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {}
        pointerId.current = e.pointerId;
        start.current = last.current = point(e);
        setDraft({ ...start.current, w: 0, h: 0 });
      }}
      onPointerMove={(e) => {
        if (e.pointerId !== pointerId.current || !start.current) return;
        last.current = point(e);
        setDraft(boxFrom(start.current, last.current));
      }}
      onPointerUp={(e) => e.pointerId === pointerId.current && finish(point(e))}
      onPointerCancel={(e) => e.pointerId === pointerId.current && finish(last.current)}
    >
      {zones.map((z, i) => (
        <div key={z.id} className="absolute rounded-md border-2 border-[#ffd60a] bg-[#ffd60a]/15" style={pct(flip(z))}>
          <span className="absolute left-1 top-1 rounded bg-[#ffd60a] px-1.5 text-[11px] font-bold text-black">{i + 1}</span>
          {/* Inside the box's corner (outside it could be cut off at the picture's edge), and big enough to tap. */}
          <button
            type="button"
            onClick={() => onChange(zones.filter((x) => x.id !== z.id))}
            aria-label={`Remove area ${i + 1}`}
            className="absolute right-1 top-1 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/80 text-white ring-2 ring-[#ffd60a]"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
      ))}
      {draft && <div className="absolute rounded-md border-2 border-dashed border-white bg-white/10" style={pct(draft)} />}
    </div>
  );
}
