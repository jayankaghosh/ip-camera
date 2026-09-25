// Everything a web page is allowed to know about the device it runs on, collected on the host and
// sent to a viewer on request (the "device" data channel). Many of these APIs only exist in some
// browsers, so every field is optional and "unknown" is a normal answer. Temperature is never
// available to web pages; CPU pressure (Chromium) and "quality limited by CPU" are the closest hints.

export const DEVICE_CHANNEL = "device";

export type PressureState = "nominal" | "fair" | "serious" | "critical";

export type DeviceInfo = {
  collectedAt: number;
  device: { kind: "phone" | "tablet" | "computer"; model?: string };
  os: { name?: string; version?: string };
  browser: { name?: string; version?: string };
  /** null = this browser doesn't expose the battery (iPhone, Firefox…). */
  battery: { level: number; charging: boolean; chargingTimeSec: number | null; dischargingTimeSec: number | null } | null;
  /** CPU pressure from the Compute Pressure API; null if no reading yet (or unsupported). */
  cpuPressure: PressureState | null;
  /** Chrome only reports pressure while the page is visible, so "supported but no reading" happens. */
  cpuPressureSupported: boolean;
  cpuCores?: number;
  /** Approximate RAM in GB, as the browser reports it (rounded; older browsers cap it at 8). */
  memoryGB?: number;
  screen: { width: number; height: number; pixelRatio: number; orientation?: string };
  network: { type?: string; effectiveType?: string; downlinkMbps?: number; rttMs?: number; saveData?: boolean } | null;
  online: boolean;
  camera?: { label: string; width?: number; height?: number; frameRate?: number; facing?: string };
  mic?: { label: string };
  /** Is the FurCam tab in front, and is the screen being kept awake? */
  page: { visible: boolean; wakeLock: boolean };
  stream: { liveSinceMs: number; viewers: number };
  /** Why video to this viewer is reduced, if it is: "cpu" often means the device is hot or busy. */
  qualityLimitation?: string;
  storage?: { usedMB: number; quotaMB: number };
  timeZone: string;
  language: string;
};

type UAData = {
  mobile: boolean;
  platform: string;
  brands: { brand: string; version: string }[];
  getHighEntropyValues(hints: string[]): Promise<{ model?: string; platformVersion?: string; fullVersionList?: { brand: string; version: string }[] }>;
};
type NetworkInformation = { type?: string; effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean };
type BatteryManager = { level: number; charging: boolean; chargingTime: number; dischargingTime: number };

/** OS, browser and device model, from User-Agent Client Hints where available, else the UA string. */
async function identify(): Promise<Pick<DeviceInfo, "device" | "os" | "browser">> {
  const ua = navigator.userAgent;
  const uaData = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
  const touch = navigator.maxTouchPoints > 1;
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touch); // iPadOS reports itself as a Mac
  const kind: DeviceInfo["device"]["kind"] = iPad || /Tablet/.test(ua) ? "tablet" : /Mobi|iPhone|Android/.test(ua) ? "phone" : "computer";

  let os: DeviceInfo["os"] = {};
  let model: string | undefined;
  let browser: DeviceInfo["browser"] = {};

  if (uaData) {
    try {
      const high = await uaData.getHighEntropyValues(["model", "platformVersion", "fullVersionList"]);
      model = high.model || undefined;
      let version = high.platformVersion;
      // Windows 11 reports platform version 13 or higher; below that it's Windows 10.
      if (uaData.platform === "Windows" && version) version = Number(version.split(".")[0]) >= 13 ? "11" : "10";
      os = { name: uaData.platform === "macOS" ? "macOS" : uaData.platform, version };
      const brand = (high.fullVersionList ?? uaData.brands).find((b) => !/Not.?A.?Brand|Chromium/i.test(b.brand));
      if (brand) browser = { name: brand.brand.replace("Google ", ""), version: brand.version.split(".")[0] };
    } catch {}
  }

  if (!os.name) {
    const m =
      ua.match(/(iPhone|iPad|iPod).*? OS (\d+[_\d]*)/) ??
      ua.match(/(Android) (\d+(?:\.\d+)?)/) ??
      ua.match(/(Windows NT) (\d+\.\d+)/) ??
      ua.match(/(Mac OS X) (\d+[_\d]*)/) ??
      ua.match(/(CrOS|Linux)/);
    if (m) {
      const name = { iPhone: "iOS", iPod: "iOS", iPad: "iPadOS", Android: "Android", "Windows NT": "Windows", "Mac OS X": iPad ? "iPadOS" : "macOS", CrOS: "ChromeOS", Linux: "Linux" }[m[1]] ?? m[1];
      os = { name, version: m[2]?.replace(/_/g, ".") };
    }
  }
  if (!model) {
    if (/iPhone/.test(ua)) model = "iPhone"; // Apple doesn't let web pages see which iPhone
    else if (iPad) model = "iPad";
    else model = ua.match(/Android [^;]+; ([^;)]+?)(?: Build|[;)])/)?.[1]?.trim().replace(/^K$/, "") || undefined;
  }
  if (!browser.name) {
    const b = ua.match(/(Edg|OPR|SamsungBrowser|Firefox|FxiOS|CriOS|Chrome)\/(\d+)/) ?? ua.match(/Version\/(\d+).*Safari/);
    if (b) {
      browser = b.length === 3
        ? { name: { Edg: "Edge", OPR: "Opera", SamsungBrowser: "Samsung Internet", FxiOS: "Firefox", CriOS: "Chrome" }[b[1]] ?? b[1], version: b[2] }
        : { name: "Safari", version: b[1] };
    }
  }
  return { device: { kind, model }, os, browser };
}

let pressure: PressureState | null = null;
let pressureWatching = false;

/** Start listening for CPU pressure (Chromium only). Cheap: the browser pushes changes. */
export function watchCpuPressure() {
  const PO = (globalThis as { PressureObserver?: new (cb: (records: { state: PressureState }[]) => void) => { observe(source: string): Promise<void> } }).PressureObserver;
  if (!PO || pressureWatching) return;
  pressureWatching = true;
  new PO((records) => (pressure = records.at(-1)?.state ?? pressure)).observe("cpu").catch(() => (pressureWatching = false));
}

/** Camera/mic names are sometimes internal ids or very long; keep them readable. */
function deviceLabel(label: string, fallback: string) {
  const clean = label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, "").trim(); // drop USB vendor:product ids
  if (!clean || (!/\s/.test(clean) && clean.length > 24)) return fallback; // looks like an id, not a name
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean;
}

export async function collectDeviceInfo(ctx: {
  stream: MediaStream | null;
  peer?: RTCPeerConnection;
  liveSince: number;
  viewers: number;
  wakeLock: boolean;
}): Promise<DeviceInfo> {
  const nav = navigator as Navigator & {
    getBattery?: () => Promise<BatteryManager>;
    connection?: NetworkInformation;
    deviceMemory?: number;
  };

  const [identity, battery, storage, qualityLimitation] = await Promise.all([
    identify(),
    nav.getBattery?.().then(
      (b) => ({
        level: b.level,
        charging: b.charging,
        chargingTimeSec: Number.isFinite(b.chargingTime) && b.chargingTime > 0 ? b.chargingTime : null,
        dischargingTimeSec: Number.isFinite(b.dischargingTime) ? b.dischargingTime : null,
      }),
      () => null,
    ) ?? null,
    navigator.storage?.estimate?.().then(
      (e) => (e.quota ? { usedMB: Math.round((e.usage ?? 0) / 1e6), quotaMB: Math.round(e.quota / 1e6) } : undefined),
      () => undefined,
    ),
    ctx.peer?.getStats().then((report) => {
      let reason: string | undefined;
      report.forEach((s) => {
        if (s.type === "outbound-rtp" && s.kind === "video") reason = s.qualityLimitationReason;
      });
      return reason;
    }, () => undefined),
  ]);

  const video = ctx.stream?.getVideoTracks()[0];
  const audio = ctx.stream?.getAudioTracks()[0];
  const vs = video?.getSettings();
  const conn = nav.connection;

  return {
    collectedAt: Date.now(),
    ...identity,
    battery,
    cpuPressure: pressure,
    cpuPressureSupported: "PressureObserver" in globalThis,
    cpuCores: navigator.hardwareConcurrency || undefined,
    memoryGB: nav.deviceMemory,
    screen: {
      width: screen.width,
      height: screen.height,
      pixelRatio: Math.round(devicePixelRatio * 100) / 100,
      orientation: screen.orientation?.type?.replace(/-primary|-secondary/, ""),
    },
    network: conn
      ? { type: conn.type, effectiveType: conn.effectiveType, downlinkMbps: conn.downlink, rttMs: conn.rtt, saveData: conn.saveData }
      : null,
    online: navigator.onLine,
    camera: video
      ? { label: deviceLabel(video.label, "Camera"), width: vs?.width, height: vs?.height, frameRate: vs?.frameRate && Math.round(vs.frameRate), facing: vs?.facingMode }
      : undefined,
    mic: audio ? { label: deviceLabel(audio.label, "Microphone") } : undefined,
    page: { visible: document.visibilityState === "visible", wakeLock: ctx.wakeLock },
    stream: { liveSinceMs: Date.now() - ctx.liveSince, viewers: ctx.viewers },
    qualityLimitation,
    storage,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
  };
}
