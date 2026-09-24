export type AlertType = "movement" | "meow";

/** A watched area, in fractions (0–1) of the camera frame so it survives resolution changes. */
export type Zone = { id: string; x: number; y: number; w: number; h: number };

export type Sensitivity = "low" | "medium" | "high";

/** What the host chose to watch for before going live. */
export type AlertConfig = { movement: boolean; meow: boolean; zones: Zone[]; sensitivity: Sensitivity };

export const DEFAULT_ALERT_CONFIG: AlertConfig = { movement: false, meow: false, zones: [], sensitivity: "medium" };

export type AlertRecord = {
  id: string;
  account: string;
  streamCode: string;
  type: AlertType;
  ts: number;
  /** e.g. "Area 2" or "Meow · 84%" */
  detail: string;
  /** JPEG snapshot of the camera at that moment (mirrored like the video); null if the camera was off. */
  image: Blob | null;
};

export const ALERT_LABELS: Record<AlertType, string> = { movement: "Movement", meow: "Meow" };
