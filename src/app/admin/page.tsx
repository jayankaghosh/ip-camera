"use client";

import { useEffect, useState } from "react";
import { HostAccounts } from "@/components/HostAccounts";
import { openSignaling, type RoomSummary } from "@/lib/rtc";

const inputClass =
  "rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-3 outline-none focus:border-blue-500";

function formatTime(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function AdminPage() {
  const [session, setSession] = useState<"checking" | "out" | "in">("checking");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [tab, setTab] = useState<"streams" | "hosts">("streams");

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
      <main className="flex flex-1 items-center justify-center p-6">
        <form onSubmit={login} className="w-full max-w-sm flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Admin</h1>
            <p className="text-sm text-neutral-500 mt-1">Log in to see all live streams.</p>
          </div>
          <input name="username" required autoComplete="username" placeholder="Username" className={inputClass} />
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="Password"
            className={inputClass}
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-blue-600 text-white py-3 font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Please wait…" : "Log in"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-1 rounded-lg bg-neutral-200/60 p-1 dark:bg-neutral-800" role="tablist">
          {(
            [
              ["streams", `Live streams${rooms ? ` (${rooms.length})` : ""}`],
              ["hosts", "Hosts"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium ${
                tab === key ? "bg-white shadow-sm dark:bg-neutral-950" : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button onClick={logout} className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-4 py-2 text-sm hover:border-blue-500">
          Log out
        </button>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {tab === "hosts" && <HostAccounts rooms={rooms ?? []} />}
      {tab === "streams" && rooms?.length === 0 && (
        <p className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-10 text-center text-neutral-500">
          No one is broadcasting right now.
        </p>
      )}
      {tab === "streams" && (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {rooms?.map((room) => (
          <article key={room.code} className="flex flex-col gap-4 rounded-xl border border-neutral-300 dark:border-neutral-700 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-mono text-2xl font-semibold tracking-[0.3em]">{room.code}</div>
                <div className="mt-1 text-xs text-neutral-500">
                  {room.host} · live since {formatTime(room.createdAt)}
                </div>
              </div>
              <a
                href={`/?code=${room.code}&admin=1`}
                target="_blank"
                rel="noopener"
                className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Watch
              </a>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-neutral-500">Password</dt>
              <dd className="font-mono">{room.password ?? <span className="font-sans text-neutral-500">None</span>}</dd>
              <dt className="text-neutral-500">Camera</dt>
              <dd className={room.media.video ? "" : "text-red-500"}>{room.media.video ? "On" : "Off"}</dd>
              <dt className="text-neutral-500">Mic</dt>
              <dd className={room.media.audio ? "" : "text-red-500"}>{room.media.audio ? "On" : "Off"}</dd>
              <dt className="text-neutral-500">Viewers</dt>
              <dd>
                {room.viewers.length === 0 ? (
                  <span className="text-neutral-500">None</span>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {room.viewers.map((v, i) => (
                      <li key={i} className="flex items-center justify-between gap-2">
                        <span className="truncate">
                          {v.name}
                          {v.isAdmin && <span className="ml-1.5 text-[10px] uppercase text-amber-600 dark:text-amber-400">admin</span>}
                          {v.micOn && <span className="ml-1.5 text-[10px] uppercase text-green-600 dark:text-green-400">mic on</span>}
                        </span>
                        <span className="text-xs text-neutral-500">{formatTime(v.joinedAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </dl>
          </article>
        ))}
      </div>
      )}
    </main>
  );
}
