"use client";

import { useEffect, useState } from "react";
import { ErrorMessage, Spinner } from "@/components/ui";
import type { AppSettings } from "@/lib/rtc";

/** Admin tab: app-wide settings. Saved on the server and pushed to live hosts immediately. */
export function AdminSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [maxAlerts, setMaxAlerts] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then((body) => {
        if (!body.settings) return setError(body.error ?? "Could not load settings.");
        setSettings(body.settings);
        setMaxAlerts(String(body.settings.maxAlerts));
      })
      .catch(() => setError("Could not reach the server."));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxAlerts: Number(maxAlerts) }),
      });
      const body = await res.json();
      if (!res.ok) return setError(body.error ?? "Could not save.");
      setSettings(body.settings);
      setMaxAlerts(String(body.settings.maxAlerts));
      setSaved(true);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return error ? <ErrorMessage>{error}</ErrorMessage> : null;

  const changed = maxAlerts !== String(settings.maxAlerts);

  return (
    <form onSubmit={save} className="card flex flex-col gap-4 p-5">
      <div>
        <h2 className="font-semibold">Alerts kept per host device</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Each host device keeps only its newest alerts; older ones are deleted automatically. Applies to live hosts right away.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="number"
          min={1}
          max={1000}
          step={1}
          required
          inputMode="numeric"
          value={maxAlerts}
          onChange={(e) => {
            setMaxAlerts(e.target.value);
            setSaved(false);
          }}
          aria-label="Alerts to keep"
          className="field w-32"
        />
        <span className="text-sm text-muted">alerts (1–1000)</span>
        <button type="submit" disabled={saving || !changed} className="btn btn-primary ml-auto">
          {saving ? <Spinner /> : "Save"}
        </button>
      </div>
      {saved && !changed && <p className="text-sm text-success">Saved.</p>}
      <ErrorMessage>{error}</ErrorMessage>
    </form>
  );
}
