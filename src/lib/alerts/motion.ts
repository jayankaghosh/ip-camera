// Movement detection by frame differencing on a tiny, low-rate copy of the camera: about two
// 160-pixel-wide frames per second, so it costs very little CPU (and battery) even on old phones.
import type { Sensitivity, Zone } from "@/lib/alerts/types";

const SAMPLE_MS = 500;
const WIDTH = 160;
/** A pixel "changed" if its brightness moved by more than this (0–255). */
const PIXEL_DELTA = 28;
/** Share of a zone's pixels that must change for it to count as movement. */
const ZONE_FRACTION: Record<Sensitivity, number> = { high: 0.012, medium: 0.03, low: 0.08 };
/** If this much of the whole frame changes at once it's a lighting/exposure jump, not movement. */
const GLOBAL_CHANGE_IGNORE = 0.6;
/** Movement must show in this many samples in a row, which filters out single-frame noise. */
const CONSECUTIVE = 2;

export class MotionDetector {
  private timer: ReturnType<typeof setInterval> | null = null;
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
  private previous: Uint8ClampedArray | null = null;
  private streak = new Map<string, number>();

  constructor(
    private getVideo: () => HTMLVideoElement | null,
    private zones: Zone[],
    private sensitivity: Sensitivity,
    private onMovement: (zoneIndex: number) => void,
  ) {}

  start() {
    this.timer ??= setInterval(() => this.sample(), SAMPLE_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.previous = null;
  }

  private sample() {
    const video = this.getVideo();
    const live = video?.srcObject instanceof MediaStream && video.srcObject.getVideoTracks().some((t) => t.readyState === "live");
    if (!video || !live || video.readyState < 2 || !video.videoWidth) {
      this.previous = null; // camera off: start fresh when it comes back
      return;
    }
    const height = Math.max(1, Math.round((WIDTH * video.videoHeight) / video.videoWidth));
    if (this.canvas.width !== WIDTH || this.canvas.height !== height) {
      this.canvas.width = WIDTH;
      this.canvas.height = height;
      this.previous = null;
    }
    this.ctx.drawImage(video, 0, 0, WIDTH, height);
    const { data } = this.ctx.getImageData(0, 0, WIDTH, height);

    // Brightness only (fast, and colour noise doesn't matter here).
    const luma = new Uint8ClampedArray(WIDTH * height);
    for (let i = 0, p = 0; i < luma.length; i++, p += 4) luma[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;

    const prev = this.previous;
    this.previous = luma;
    if (!prev) return;

    let globalChanged = 0;
    for (let i = 0; i < luma.length; i++) if (Math.abs(luma[i] - prev[i]) > PIXEL_DELTA) globalChanged++;
    if (globalChanged / luma.length > GLOBAL_CHANGE_IGNORE) return;

    this.zones.forEach((zone, index) => {
      const x0 = Math.floor(zone.x * WIDTH);
      const y0 = Math.floor(zone.y * height);
      const x1 = Math.min(WIDTH, Math.ceil((zone.x + zone.w) * WIDTH));
      const y1 = Math.min(height, Math.ceil((zone.y + zone.h) * height));
      let changed = 0;
      let total = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * WIDTH + x;
          total++;
          if (Math.abs(luma[i] - prev[i]) > PIXEL_DELTA) changed++;
        }
      }
      const moving = total > 0 && changed / total > ZONE_FRACTION[this.sensitivity];
      const streak = moving ? (this.streak.get(zone.id) ?? 0) + 1 : 0;
      this.streak.set(zone.id, streak);
      if (streak === CONSECUTIVE) this.onMovement(index);
    });
  }
}
