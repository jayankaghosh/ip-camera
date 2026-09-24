"use client";

import { useEffect, useState } from "react";
import { AdminSettings } from "@/components/AdminSettings";
import { HostAccounts } from "@/components/HostAccounts";
import { Icon } from "@/components/icons";
import { Avatar, CardHeader, ErrorMessage, Field, FormCard, Screen, SubmitButton } from "@/components/ui";
import { openSignaling, type RoomSummary } from "@/lib/rtc";

function formatTime(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function AdminPage() {
  const [session, setSession] = useState<"checking" | "out" | "in">("checking");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [tab, setTab] = useState<"streams" | "hosts" | "settings">("streams");

  useEffect(() => {
    fetch("/api/admin/session")
      .then((r) => r.json())
      .then((body: { loggedIn?: boolean }) => setSession(body.loggedIn ? "in" : "out"))
      .catch(() => setSession("out"));
  }, []);

  // Live list of streams while logged in.
  useEffect(() => {
    if (session !== "in") return;
    let ws: WebSocket | null = null;
    let closed = false;
    openSignaling((msg) => {
      if (msg.type === "rooms") setRooms(msg.rooms);
      else if (msg.type === "error") setSession("out");
    })
      .then((socket) => {
        if (closed) return socket.close();
        ws = socket;
        socket.onclose = () => {
          if (!closed) setError("Lost connection to the server. Reload to reconnect.");
        };
        socket.send(JSON.stringify({ type: "admin-subscribe" }));
      })
      .catch((err) => setError(err.message));
    return () => {
      closed = true;
      ws?.close();
    };
  }, [session]);

  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
      });
      if (res.ok) setSession("in");
      else setError((await res.json()).error ?? "Login failed.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => {});
    setRooms(null);
    setSession("out");
  }

  if (session === "checking") return null;

  if (session === "out") {
    return (
      <Screen>
        <FormCard>
          <CardHeader icon="shield" title="Admin">
            Log in to manage hosts and see all live streams.
          </CardHeader>
          <form onSubmit={login} className="flex flex-col gap-4">
            <Field label="Username" name="username" required autoComplete="username" autoCapitalize="none" />
            <Field label="Password" name="password" type="password" required autoComplete="current-password" />
            <ErrorMessage>{error}</ErrorMessage>
            <SubmitButton busy={busy}>Log in</SubmitButton>
          </form>
        </FormCard>
      </Screen>
    );
  }

  const tabs = [
    { key: "streams", label: "Live streams", count: rooms?.length },
    { key: "hosts", label: "Hosts" },
    { key: "settings", label: "Settings" },
  ] as const;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white">
          <Icon name="shield" className="h-5 w-5" />
        </span>
        <h1 className="text-xl font-semibold tracking-tight">Admin</h1>
        <button onClick={logout} className="btn btn-sm btn-secondary ml-auto">
          <Icon name="logOut" className="h-4 w-4" /> Log out
        </button>
      </header>

      <div className="flex w-fit gap-1 rounded-xl bg-surface-2 p-1" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              tab === t.key ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
            }`}
          >
            {t.label}
            {"count" in t && t.count !== undefined && (
              <span className={`rounded-full px-1.5 text-xs ${t.count ? "bg-danger text-white" : "bg-line text-muted"}`}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      <ErrorMessage>{error}</ErrorMessage>
      {tab === "hosts" && <HostAccounts rooms={rooms ?? []} />}
      {tab === "settings" && <AdminSettings />}

      {tab === "streams" && rooms?.length === 0 && (
        <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-muted">
            <Icon name="video" slash className="h-6 w-6" />
          </span>
          <p className="text-muted">No one is broadcasting right now.</p>
        </div>
      )}

      {tab === "streams" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {rooms?.map((room) => (
            <article key={room.code} className="card flex flex-col gap-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="live-dot h-2 w-2 rounded-full bg-danger" />
                    <span className="font-mono text-2xl font-semibold tracking-[0.2em]">{room.code}</span>
                  </div>
                  <div className="mt-1 truncate text-sm text-muted">
                    <span className="font-medium text-fg">{room.host}</span> · live since {formatTime(room.createdAt)}
                  </div>
                </div>
                <a href={`/?code=${room.code}&admin=1`} target="_blank" rel="noopener" className="btn btn-sm btn-primary shrink-0">
                  <Icon name="monitor" className="h-4 w-4" /> Watch
                </a>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-xl bg-surface-2 px-3 py-2">
                  <dt className="text-xs text-muted">Password</dt>
                  <dd className="truncate font-mono font-medium">{room.password ?? <span className="font-sans text-muted">None</span>}</dd>
                </div>
                <div className="rounded-xl bg-surface-2 px-3 py-2">
                  <dt className="text-xs text-muted">Camera</dt>
                  <dd className={`font-medium ${room.media.video ? "" : "text-danger"}`}>{room.media.video ? "On" : "Off"}</dd>
                </div>
                <div className="rounded-xl bg-surface-2 px-3 py-2">
                  <dt className="text-xs text-muted">Mic</dt>
                  <dd className={`font-medium ${room.media.audio ? "" : "text-danger"}`}>{room.media.audio ? "On" : "Off"}</dd>
                </div>
              </dl>
              <div>
                <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                  <Icon name="users" className="h-3.5 w-3.5" /> Viewers · {room.viewers.length}
                </h3>
                {room.viewers.length === 0 ? (
                  <p className="text-sm text-muted">No one watching.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {room.viewers.map((v, i) => (
                      <li key={i} className="flex items-center gap-2.5 text-sm">
                        <Avatar name={v.name} />
                        <span className="min-w-0 flex-1 truncate font-medium">{v.name}</span>
                        {v.micOn && <span className="chip bg-success/15 text-success">Mic on</span>}
                        {v.isAdmin && <span className="chip bg-warning/15 text-warning">Admin</span>}
                        <span className="text-xs text-muted">{formatTime(v.joinedAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
