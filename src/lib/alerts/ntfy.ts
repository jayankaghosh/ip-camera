// Push notifications for alerts via ntfy (https://ntfy.sh): the host device publishes each alert to
// the stream's topic, with the snapshot attached. Anyone subscribed to the topic in the ntfy app
// gets it on their phone, and tapping the notification opens the stream. The server picks the
// topic: one per host account, furcam-alert-<username>-<random>.
import { ALERT_LABELS, type AlertRecord } from "@/lib/alerts/types";

/** Public page for the topic; opens the ntfy app or web app to subscribe. */
export const ntfyTopicUrl = (server: string, topic: string) => `${server}/${encodeURIComponent(topic)}`;

export async function publishToNtfy(server: string, topic: string, alert: AlertRecord) {
  const time = new Date(alert.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  // Options go in the query string (not headers) so non-ASCII text like "·" is safe.
  const params = new URLSearchParams({
    title: `${ALERT_LABELS[alert.type]} alert · FurCam`,
    message: `${alert.detail} at ${time}`,
    tags: alert.type === "meow" ? "cat" : "paw_prints",
    priority: "4",
    click: `${location.origin}/?code=${alert.streamCode}`,
  });
  let body: Blob | undefined;
  if (alert.image) {
    // PUT with a filename makes ntfy attach the snapshot, shown as an image in the notification.
    params.set("filename", `furcam-${alert.type}-${alert.ts}.jpg`);
    body = alert.image;
  }
  const res = await fetch(`${ntfyTopicUrl(server, topic)}?${params}`, { method: body ? "PUT" : "POST", body });
  if (!res.ok) throw new Error(`ntfy answered ${res.status}`);
}
