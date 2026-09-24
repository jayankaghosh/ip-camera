"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { Avatar, ErrorMessage } from "@/components/ui";
import type { RoomSummary } from "@/lib/rtc";

type Host = { username: string; createdAt: number; updatedAt: number };

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
        className="card flex flex-col gap-3 p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const data = new FormData(form);
          if (await call("POST", "/api/admin/hosts", { username: data.get("username"), password: data.get("password") })) {
            form.reset();
          }
        }}
      >
        <h2 className="font-semibold">Add a host</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input name="username" required placeholder="Username" autoComplete="off" autoCapitalize="none" aria-label="Username" className="field sm:flex-1" />
          <input name="password" type="password" required minLength={6} placeholder="Password (6+ characters)" autoComplete="new-password" aria-label="Password" className="field sm:flex-1" />
          <button type="submit" disabled={busy} className="btn btn-primary">
            <Icon name="plus" /> Add
          </button>
        </div>
        <p className="text-xs text-muted">Hosts need an account to broadcast. Give them the username and password yourself.</p>
      </form>

      <ErrorMessage>{error}</ErrorMessage>

      {hosts?.length === 0 && (
        <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-muted">
            <Icon name="users" className="h-6 w-6" />
          </span>
          <p className="text-muted">No host accounts yet.</p>
        </div>
      )}

      {hosts && hosts.length > 0 && (
        <ul className="card divide-y divide-line overflow-hidden">
          {hosts.map((host) => {
            const live = liveCount(host.username);
            if (editing === host.username) {
              return (
                <li key={host.username} className="bg-surface-2/50 p-4">
                  <form
                    className="flex flex-col gap-2 sm:flex-row"
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
                    <input name="newUsername" required defaultValue={host.username} aria-label="Username" autoCapitalize="none" className="field sm:flex-1" />
                    <input name="password" type="password" minLength={6} placeholder="New password (blank = keep)" autoComplete="new-password" aria-label="New password" className="field sm:flex-1" />
                    <div className="flex gap-2">
                      <button type="submit" disabled={busy} className="btn btn-primary flex-1 sm:flex-none">
                        Save
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className="btn btn-secondary flex-1 sm:flex-none">
                        Cancel
                      </button>
                    </div>
                  </form>
                  <p className="mt-2 text-xs text-muted">
                    Saving logs {host.username} out on all devices{live ? ` and ends their ${live} live stream${live > 1 ? "s" : ""}` : ""}.
                  </p>
                </li>
              );
            }
            return (
              <li key={host.username} className="flex items-center gap-3 p-4">
                <Avatar name={host.username} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{host.username}</span>
                    {live > 0 && (
                      <span className="chip bg-danger/12 text-danger">
                        <span className="live-dot h-1.5 w-1.5 rounded-full bg-danger" /> Live{live > 1 ? ` ×${live}` : ""}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted">
                    Added {new Date(host.createdAt).toLocaleDateString()}
                    {host.updatedAt !== host.createdAt && ` · changed ${new Date(host.updatedAt).toLocaleDateString()}`}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setError(null);
                    setEditing(host.username);
                  }}
                  title={`Edit ${host.username}`}
                  aria-label={`Edit ${host.username}`}
                  className="btn btn-sm btn-secondary px-2.5"
                >
                  <Icon name="pencil" className="h-4 w-4" />
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    const warning = live ? ` Their ${live} live stream${live > 1 ? "s" : ""} will end.` : "";
                    if (confirm(`Delete host "${host.username}"?${warning}`)) {
                      call("DELETE", `/api/admin/hosts/${encodeURIComponent(host.username)}`);
                    }
                  }}
                  title={`Delete ${host.username}`}
                  aria-label={`Delete ${host.username}`}
                  className="btn btn-sm btn-ghost-danger px-2.5"
                >
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
