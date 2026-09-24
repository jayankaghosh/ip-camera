// "Export" for viewers: every alert's snapshot plus alerts.csv / alerts.json, as one ZIP download.
import { strToU8, zipSync, type Zippable } from "fflate";
import type { ReceivedAlert } from "@/lib/alerts/channel";
import { ALERT_LABELS } from "@/lib/alerts/types";

const pad = (n: number) => String(n).padStart(2, "0");

/** Local time, safe for file names: 2026-09-25_14-03-22 */
function stamp(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export async function exportAlertsZip(alerts: ReceivedAlert[], streamCode: string) {
  const files: Zippable = {};
  const rows: Record<string, string | null>[] = [];
  const used = new Set<string>();

  for (const a of alerts) {
    let image: string | null = null;
    if (a.image) {
      let name = `images/${stamp(a.ts)}_${a.type}_${a.streamCode}.jpg`;
      for (let n = 2; used.has(name); n++) name = `images/${stamp(a.ts)}_${a.type}_${a.streamCode}_${n}.jpg`;
      used.add(name);
      // JPEGs are already compressed: store them as-is (level 0), which is also much faster.
      files[name] = [new Uint8Array(await a.image.arrayBuffer()), { level: 0 }];
      image = name;
    }
    rows.push({
      time: new Date(a.ts).toISOString(),
      localTime: new Date(a.ts).toLocaleString(),
      type: ALERT_LABELS[a.type],
      detail: a.detail,
      stream: a.streamCode,
      image,
    });
  }

  const header = ["time", "localTime", "type", "detail", "stream", "image"];
  const csv = [header.join(","), ...rows.map((r) => header.map((k) => csvCell(r[k] ?? "")).join(","))].join("\n");
  files["alerts.csv"] = strToU8(csv);
  files["alerts.json"] = strToU8(JSON.stringify(rows, null, 2));

  const zip = zipSync(files);
  const url = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `alerts_${streamCode}_${stamp(Date.now())}.zip`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
