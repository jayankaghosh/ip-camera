"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { HostApp } from "@/components/HostApp";
import { ViewerApp } from "@/components/ViewerApp";

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

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">IP Camera</h1>
        <p className="text-neutral-500 mt-2">Are you streaming a camera or watching one?</p>
      </div>
      <div className="grid w-full max-w-md grid-cols-1 gap-4 sm:grid-cols-2">
        <button
          onClick={() => setRole("host")}
          className="rounded-xl border border-neutral-300 dark:border-neutral-700 p-6 text-left hover:border-blue-500 transition-colors"
        >
          <div className="text-lg font-medium">Host</div>
          <p className="text-sm text-neutral-500 mt-1">Share this device&apos;s camera and microphone. Needs a host account.</p>
        </button>
        <button
          onClick={() => setRole("viewer")}
          className="rounded-xl border border-neutral-300 dark:border-neutral-700 p-6 text-left hover:border-blue-500 transition-colors"
        >
          <div className="text-lg font-medium">Viewer</div>
          <p className="text-sm text-neutral-500 mt-1">Watch a live camera with its code.</p>
        </button>
      </div>
    </main>
  );
}
