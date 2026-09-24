"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { Spinner } from "@/components/ui";
import type { ReceivedAlert } from "@/lib/alerts/channel";
import { ALERT_LABELS, type AlertType } from "@/lib/alerts/types";

const TYPE_ICON = { movement: "move", meow: "paw" } as const satisfies Record<AlertType, string>;
const TYPE_TONE: Record<AlertType, string> = { movement: "bg-warning/15 text-warning", meow: "bg-accent/12 text-accent" };

function time(ts: number) {
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Newest-first list of alerts with thumbnails; tap one for the full snapshot. */
export function AlertList({
  alerts,
  onExport,
  empty = "No alerts yet.",
}: {
  alerts: ReceivedAlert[];
  onExport?: () => Promise<void>;
  empty?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const newestFirst = [...alerts].reverse();
  const openIndex = newestFirst.findIndex((a) => a.id === openId);
  const open = openIndex >= 0 ? newestFirst[openIndex] : null;

  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
      if (e.key === "ArrowLeft" && openIndex > 0) setOpenId(newestFirst[openIndex - 1].id);
      if (e.key === "ArrowRight" && openIndex < newestFirst.length - 1) setOpenId(newestFirst[openIndex + 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, openIndex, newestFirst]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <Icon name="bell" className="h-4 w-4 text-muted" />
        <h2 className="text-sm font-semibold">Alerts</h2>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">{alerts.length}</span>
        {onExport && (
          <button
            onClick={async () => {
              setExporting(true);
              try {
                await onExport();
              } finally {
                setExporting(false);
              }
            }}
            disabled={exporting || alerts.length === 0}
            className="btn btn-sm btn-secondary ml-auto"
          >
            {exporting ? <Spinner className="h-4 w-4" /> : <Icon name="download" className="h-4 w-4" />} Export
          </button>
        )}
      </div>

      {alerts.length === 0 ? (
        <p className="px-1 py-4 text-center text-sm text-muted">{empty}</p>
      ) : (
        <ul className="flex max-h-[26rem] flex-col gap-1 overflow-y-auto">
          {newestFirst.map((a) => (
            <li key={a.id}>
              <button onClick={() => setOpenId(a.id)} className="flex w-full items-center gap-3 rounded-xl p-1.5 text-left transition-colors hover:bg-surface-2">
                {a.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local object URL, nothing to optimise
                  <img src={a.url} alt="" className="h-10 w-16 shrink-0 rounded-lg bg-black object-cover" />
                ) : (
                  <span className="inline-flex h-10 w-16 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
                    <Icon name="video" slash className="h-4 w-4" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={`chip ${TYPE_TONE[a.type]}`}>
                      <Icon name={TYPE_ICON[a.type]} className="h-3 w-3" />
                      {ALERT_LABELS[a.type]}
                    </span>
                    <span className="truncate text-xs text-muted">{a.detail}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {time(a.ts)} · <span className="font-mono">{a.streamCode}</span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Alert snapshot"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setOpenId(null)}
        >
          <div className="flex w-full max-w-3xl flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            {open.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL
              <img src={open.url} alt={`${ALERT_LABELS[open.type]} snapshot`} className="w-full rounded-2xl bg-black" />
            ) : (
              <div className="flex aspect-video items-center justify-center rounded-2xl bg-[#111] text-sm text-white/60">
                No snapshot: the camera was off
              </div>
            )}
            <div className="flex items-center gap-3 text-white">
              <span className={`chip ${TYPE_TONE[open.type]}`}>
                <Icon name={TYPE_ICON[open.type]} className="h-3 w-3" />
                {ALERT_LABELS[open.type]}
              </span>
              <span className="min-w-0 truncate text-sm">
                {open.detail} · {new Date(open.ts).toLocaleString()} · <span className="font-mono">{open.streamCode}</span>
              </span>
              <span className="ml-auto flex gap-1.5">
                <button
                  onClick={() => setOpenId(newestFirst[openIndex - 1]?.id ?? openId)}
                  disabled={openIndex <= 0}
                  aria-label="Newer alert"
                  className="ctl h-10 w-10"
                >
                  <Icon name="chevronLeft" />
                </button>
                <button
                  onClick={() => setOpenId(newestFirst[openIndex + 1]?.id ?? openId)}
                  disabled={openIndex >= newestFirst.length - 1}
                  aria-label="Older alert"
                  className="ctl h-10 w-10"
                >
                  <Icon name="chevronRight" />
                </button>
                <button onClick={() => setOpenId(null)} aria-label="Close" className="ctl h-10 w-10">
                  <Icon name="x" />
                </button>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
