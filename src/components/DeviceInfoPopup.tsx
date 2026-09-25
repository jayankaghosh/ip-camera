"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { Spinner } from "@/components/ui";
import type { DeviceInfo, PressureState } from "@/lib/device";

const REFRESH_MS = 10_000;
const NA = <span className="text-muted">Not available</span>;

function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : m ? `${m} min` : `${s} s`;
}

const PRESSURE: Record<PressureState, { label: string; tone: string }> = {
  nominal: { label: "Normal", tone: "text-success" },
  fair: { label: "Moderate", tone: "text-success" },
  serious: { label: "High: device is busy or warm", tone: "text-warning" },
  critical: { label: "Critical: device is overloaded or hot", tone: "text-danger" },
};

/** The browser's rough speed class for the connection (not the actual network type). */
const SPEED_CLASS: Record<string, string> = { "slow-2g": "Very slow", "2g": "Slow (2G-like)", "3g": "Moderate (3G-like)", "4g": "Fast (4G-like)" };

const QUALITY: Record<string, { label: string; tone: string }> = {
  none: { label: "Full quality", tone: "text-success" },
  cpu: { label: "Reduced: device busy or hot", tone: "text-warning" },
  bandwidth: { label: "Reduced: slow network", tone: "text-warning" },
  other: { label: "Reduced", tone: "text-warning" },
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <dl className="divide-y divide-line overflow-hidden rounded-xl bg-surface-2">{children}</dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3.5 py-2.5 text-sm">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium [overflow-wrap:anywhere]">{children ?? NA}</dd>
    </div>
  );
}

function Battery({ battery }: { battery: DeviceInfo["battery"] }) {
  if (!battery) {
    return (
      <div className="rounded-xl bg-surface-2 px-3.5 py-3 text-sm text-muted">
        Battery info isn&apos;t available from this browser (iPhone, iPad and Firefox don&apos;t share it).
      </div>
    );
  }
  const pct = Math.round(battery.level * 100);
  const low = pct <= 20 && !battery.charging;
  const time = battery.charging ? battery.chargingTimeSec : battery.dischargingTimeSec;
  return (
    <div className="flex items-center gap-4 rounded-xl bg-surface-2 px-3.5 py-3">
      <div className="relative h-7 w-14 shrink-0 rounded-md border-2 border-current p-0.5 text-muted">
        <span className="absolute -right-1.5 top-1/2 h-3 w-1 -translate-y-1/2 rounded-r bg-current" />
        <span
          className={`block h-full rounded-sm ${low ? "bg-danger" : battery.charging ? "bg-success" : "bg-fg"}`}
          style={{ width: `${Math.max(4, pct)}%` }}
        />
      </div>
      <div className="min-w-0">
        <div className={`flex items-center gap-1 text-xl font-semibold ${low ? "text-danger" : ""}`}>
          {pct}%
          {battery.charging && <Icon name="bolt" className="h-4 w-4 text-success" />}
        </div>
        <div className="text-xs text-muted">
          {battery.charging ? "Charging" : "On battery"}
          {time ? ` · ${duration(time * 1000)} ${battery.charging ? "to full" : "left"}` : ""}
          {low && " · Low: plug it in"}
        </div>
      </div>
    </div>
  );
}

/**
 * Viewer's popup with everything the host's browser can tell us about the host device. It asks
 * over the "device" data channel when opened and every 10 s while open.
 */
export function DeviceInfoPopup({ channel, onClose }: { channel: RTCDataChannel; onClose: () => void }) {
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const ask = () => channel.readyState === "open" && channel.send("device-info");
    const onMessage = (e: MessageEvent) => {
      if (typeof e.data !== "string") return;
      try {
        setInfo(JSON.parse(e.data));
      } catch {}
    };
    channel.addEventListener("message", onMessage);
    ask();
    const refresh = setInterval(ask, REFRESH_MS);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(refresh);
      clearInterval(clock);
      window.removeEventListener("keydown", onKey);
      channel.removeEventListener("message", onMessage);
    };
  }, [channel, onClose]);

  const hostTime =
    info &&
    new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: info.timeZone, timeZoneName: "short" });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Host device"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="card flex max-h-[88svh] w-full max-w-md flex-col overflow-hidden rounded-b-none sm:rounded-b-[20px]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-line p-4">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent/12 text-accent">
            <Icon name="smartphone" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Host device</h2>
            <p className="truncate text-xs text-muted">
              {info
                ? [info.device.model, info.os.name && `${info.os.name} ${info.os.version ?? ""}`.trim(), info.browser.name].filter(Boolean).join(" · ")
                : "Asking the host…"}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="btn btn-sm btn-secondary px-2.5">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </header>

        {!info ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted">
            <Spinner /> Getting device info…
          </div>
        ) : (
          <div className="flex flex-col gap-4 overflow-y-auto p-4">
            <Section title="Battery">
              <Battery battery={info.battery} />
            </Section>

            <Section title="Health">
              <Row label="CPU pressure">
                {info.cpuPressure ? (
                  <span className={PRESSURE[info.cpuPressure].tone}>{PRESSURE[info.cpuPressure].label}</span>
                ) : info.cpuPressureSupported ? (
                  <span className="font-normal text-muted">No reading yet (only reported while FurCam is on screen)</span>
                ) : null}
              </Row>
              <Row label="Video to you">
                {info.qualityLimitation ? (
                  <span className={(QUALITY[info.qualityLimitation] ?? QUALITY.other).tone}>
                    {(QUALITY[info.qualityLimitation] ?? QUALITY.other).label}
                  </span>
                ) : null}
              </Row>
              <Row label="Temperature">
                <span className="font-normal text-muted">Web apps can&apos;t read it; watch CPU pressure instead</span>
              </Row>
            </Section>

            <Section title="Device">
              <Row label="Type">{info.device.kind[0].toUpperCase() + info.device.kind.slice(1)}</Row>
              <Row label="Model">{info.device.model}</Row>
              <Row label="System">{info.os.name && `${info.os.name} ${info.os.version ?? ""}`.trim()}</Row>
              <Row label="Browser">{info.browser.name && `${info.browser.name} ${info.browser.version ?? ""}`.trim()}</Row>
              <Row label="CPU cores">{info.cpuCores}</Row>
              <Row label="Memory">{info.memoryGB && `~${info.memoryGB} GB`}</Row>
              <Row label="Screen">
                {`${info.screen.width}×${info.screen.height} @${info.screen.pixelRatio}x`}
                {info.screen.orientation && `, ${info.screen.orientation}`}
              </Row>
            </Section>

            <Section title="Network">
              <Row label="Online">{info.online ? "Yes" : <span className="text-danger">No</span>}</Row>
              {info.network ? (
                <>
                  <Row label="Connection">
                    {[info.network.type && info.network.type[0].toUpperCase() + info.network.type.slice(1), info.network.effectiveType && SPEED_CLASS[info.network.effectiveType]]
                      .filter(Boolean)
                      .join(" · ") || null}
                  </Row>
                  <Row label="Speed">{info.network.downlinkMbps !== undefined ? `~${info.network.downlinkMbps} Mbps` : null}</Row>
                  <Row label="Latency">{info.network.rttMs !== undefined ? `~${info.network.rttMs} ms` : null}</Row>
                  <Row label="Data saver">{info.network.saveData ? "On" : "Off"}</Row>
                </>
              ) : (
                <Row label="Connection">{null}</Row>
              )}
            </Section>

            <Section title="Camera & mic">
              <Row label="Camera">{info.camera ? info.camera.label : <span className="text-muted">Off</span>}</Row>
              {info.camera && (
                <Row label="Video">
                  {[info.camera.width && `${info.camera.width}×${info.camera.height}`, info.camera.frameRate && `${info.camera.frameRate} fps`, info.camera.facing]
                    .filter(Boolean)
                    .join(" · ") || null}
                </Row>
              )}
              <Row label="Mic">{info.mic ? info.mic.label : <span className="text-muted">Off</span>}</Row>
            </Section>

            <Section title="FurCam">
              <Row label="App on screen">
                {info.page.visible ? "Yes" : <span className="text-warning">No: in the background, the camera may pause</span>}
              </Row>
              <Row label="Screen kept awake">{info.page.wakeLock ? "Yes" : <span className="text-warning">No</span>}</Row>
              <Row label="Live for">{duration(info.stream.liveSinceMs)}</Row>
              <Row label="Viewers">{info.stream.viewers}</Row>
              <Row label="Storage used">{info.storage && `${info.storage.usedMB} MB of ${(info.storage.quotaMB / 1000).toFixed(1)} GB`}</Row>
            </Section>

            <Section title="Locale">
              <Row label="Local time">{hostTime}</Row>
              <Row label="Time zone">{info.timeZone}</Row>
              <Row label="Language">{info.language}</Row>
            </Section>

            <p className="px-1 text-center text-xs text-muted">
              Updated {Math.max(0, Math.round((now - info.collectedAt) / 1000))} s ago · refreshes every {REFRESH_MS / 1000} s
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
