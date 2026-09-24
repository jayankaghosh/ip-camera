"use client";

import { useEffect, useState } from "react";
import type { RoomSummary } from "@/lib/rtc";

type Host = { username: string; createdAt: number; updatedAt: number };

const inputClass =
  "min-w-0 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500";
const buttonClass = "rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50";

/** Admin tab: add, rename, re-password and delete host accounts. */
export function HostAccounts({ rooms }: { rooms: RoomSummary[] }) {
  const [hosts, setHosts] = useState<Host[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/hosts")
      .then((r) => r.json())
      .then((body) => (body.hosts ? setHosts(body.hosts) : setError(body.error ?? "Could not load hosts.")))
      .catch(() => setError("Could not reach the server."));
  }, []);

  /** Runs an API call that answers with the updated host list. Returns true on success. */
  async function call(method: string, path: string, body?: object) {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return false;
      }
      setHosts(data.hosts);
      setError(null);
      return true;
    } catch {
      setError("Could not reach the server.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const liveCount = (username: string) =>
    rooms.filter((r) => r.host.toLowerCase() === username.toLowerCase()).length;

  return (
    <section className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-3 rounded-xl border border-neutral-300 dark:border-neutral-700 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const data = new FormData(form);
          if (await call("POST", "/api/admin/hosts", { username: data.get("username"), password: data.get("password") })) {
            form.reset();
          }
        }}
      >
        <h2 className="text-sm font-medium">Add a host</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input name="username" required placeholder="Username" autoComplete="off" autoCapitalize="none" className={`${inputClass} flex-1`} />
          <input name="password" type="password" required minLength={6} placeholder="Password (6+ characters)" autoComplete="new-password" className={`${inputClass} flex-1`} />
          <button type="submit" disabled={busy} className={`${buttonClass} bg-blue-600 text-white hover:bg-blue-700`}>
            Add host
          </button>
        </div>
      </form>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {hosts?.length === 0 && (
        <p className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-10 text-center text-neutral-500">
          No host accounts yet. Add one above; hosts need an account to broadcast.
        </p>
      )}

      {hosts && hosts.length > 0 && (
        <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-300 dark:divide-neutral-800 dark:border-neutral-700">
          {hosts.map((host) => {
            const live = liveCount(host.username);
            if (editing === host.username) {
              return (
                <li key={host.username} className="p-4">
                  <form
                    className="flex flex-col gap-2 sm:flex-row sm:items-center"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const data = new FormData(e.currentTarget);
                      const ok = await call("PATCH", `/api/admin/hosts/${encodeURIComponent(host.username)}`, {
                        newUsername: data.get("newUsername"),
                        password: data.get("password"),
                      });
                      if (ok) setEditing(null);
                    }}
                  >
                    <input name="newUsername" required defaultValue={host.username} aria-label="Username" autoCapitalize="none" className={`${inputClass} flex-1`} />
                    <input name="password" type="password" minLength={6} placeholder="New password (blank = keep)" autoComplete="new-password" aria-label="New password" className={`${inputClass} flex-1`} />
                    <div className="flex gap-2">
                      <button type="submit" disabled={busy} className={`${buttonClass} bg-blue-600 text-white hover:bg-blue-700`}>
                        Save
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className={`${buttonClass} border border-neutral-300 dark:border-neutral-700`}>
                        Cancel
                      </button>
                    </div>
                  </form>
                  <p className="mt-2 text-xs text-neutral-500">
                    Saving logs {host.username} out on all devices{live ? ` and ends their ${live} live stream${live > 1 ? "s" : ""}` : ""}.
                  </p>
                </li>
              );
            }
            return (
              <li key={host.username} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium">
                    <span className="truncate">{host.username}</span>
                    {live > 0 && (
                      <span className="rounded bg-red-500/15 px-1.5 text-[10px] font-semibold uppercase text-red-600 dark:text-red-400">
                        live{live > 1 ? ` ×${live}` : ""}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-neutral-500">
                    Added {new Date(host.createdAt).toLocaleDateString()}
                    {host.updatedAt !== host.createdAt && ` · changed ${new Date(host.updatedAt).toLocaleDateString()}`}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setError(null);
                      setEditing(host.username);
                    }}
                    className={`${buttonClass} border border-neutral-300 hover:border-blue-500 dark:border-neutral-700`}
                  >
                    Edit
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      const warning = live ? ` Their ${live} live stream${live > 1 ? "s" : ""} will end.` : "";
                      if (confirm(`Delete host "${host.username}"?${warning}`)) {
                        call("DELETE", `/api/admin/hosts/${encodeURIComponent(host.username)}`);
                      }
                    }}
                    className={`${buttonClass} text-red-600 hover:bg-red-500/10`}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
