/** Alerts the sound model can raise. */
export type SoundKind = "meow" | "bark" | "crash";
export const SOUND_KINDS: SoundKind[] = ["meow", "bark", "crash"];

export type AlertType = "movement" | SoundKind;

/** A watched area, in fractions (0–1) of the camera frame so it survives resolution changes. */
export type Zone = { id: string; x: number; y: number; w: number; h: number };

export type Sensitivity = "low" | "medium" | "high";

/** What the host chose to watch for before going live. */
export type AlertConfig = { movement: boolean; zones: Zone[]; sensitivity: Sensitivity } & Record<SoundKind, boolean>;

export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  movement: false,
  meow: false,
  bark: false,
  crash: false,
  zones: [],
  sensitivity: "medium",
};

/** Sound kinds this config listens for. */
export const enabledSounds = (config: AlertConfig) => SOUND_KINDS.filter((k) => config[k]);
/** Whether any alert is switched on. */
export const anyAlertsOn = (config: AlertConfig) => config.movement || enabledSounds(config).length > 0;

export type AlertRecord = {
  id: string;
  account: string;
  streamCode: string;
  type: AlertType;
  ts: number;
  /** e.g. "Area 2", "Meow · 84%", "Bark · 71%", "Smash, crash · 55%" */
  detail: string;
  /** JPEG snapshot of the camera at that moment (mirrored like the video); null if the camera was off. */
  image: Blob | null;
};

export const ALERT_LABELS: Record<AlertType, string> = { movement: "Movement", meow: "Meow", bark: "Dog", crash: "Crash" };
