"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { HostApp } from "@/components/HostApp";
import { ViewerApp } from "@/components/ViewerApp";
import { Icon } from "@/components/icons";
import { IconBadge, Screen } from "@/components/ui";

/**
 * The whole app lives at "/": pick Host or Viewer here. A link with ?code=ABC123 opens the viewer
 * with the code filled in; ?code=…&admin=1 is the admin's "Watch" link.
 */
export function Home() {
  const params = useSearchParams();
  const initialCode = (params.get("code") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  const asAdmin = params.get("admin") === "1" && initialCode.length === 6;
  const [role, setRole] = useState<"host" | "viewer" | null>(initialCode ? "viewer" : null);

  function back() {
    if (location.search) history.replaceState(null, "", "/"); // drop ?code so it doesn't stick around
    setRole(null);
  }

  if (role === "host") return <HostApp onBack={back} />;
  if (role === "viewer") {
    return <ViewerApp initialCode={initialCode} asAdmin={asAdmin} onBack={back} />;
  }

  const choices = [
    { role: "host", icon: "video", title: "Host", text: "Stream this device's camera and mic. Needs a host account." },
    { role: "viewer", icon: "monitor", title: "Watch", text: "Watch a live camera with the code the host shared." },
  ] as const;

  return (
    <Screen>
      <div className="flex w-full max-w-[400px] flex-col gap-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-[20px] bg-accent text-white">
            <Icon name="video" className="h-8 w-8" />
          </span>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">IP Camera</h1>
            <p className="mt-1.5 text-muted">Live video from any device, straight to your screen.</p>
          </div>
        </div>
        <div className="card overflow-hidden">
          {choices.map((c, i) => (
            <button
              key={c.role}
              onClick={() => setRole(c.role)}
              className={`flex w-full items-center gap-4 p-5 text-left transition-colors hover:bg-surface-2 ${
                i > 0 ? "border-t border-line" : ""
              }`}
            >
              <IconBadge icon={c.icon} />
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-semibold">{c.title}</span>
                <span className="block text-sm leading-snug text-muted">{c.text}</span>
              </span>
              <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-muted" />
            </button>
          ))}
        </div>
        <p className="text-center text-xs text-muted">Encrypted, peer-to-peer video</p>
      </div>
    </Screen>
  );
}
