"use client";

import { useEffect, useRef, useState } from "react";

const NAME_KEY = "ip-camera:name";

export function JoinForm({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (name: string, code: string) => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);

  // Prefill the name used last time (after mount, so the prerendered HTML matches).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(NAME_KEY);
      if (saved && nameRef.current && !nameRef.current.value) nameRef.current.value = saved;
    } catch {}
  }, []);
  const [code, setCode] = useState("");
  const inputClass =
    "rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-4 py-3 outline-none focus:border-blue-500";

  return (
    <form
      className="w-full max-w-sm flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const name = nameRef.current?.value.trim() ?? "";
        try {
          localStorage.setItem(NAME_KEY, name);
        } catch {}
        onSubmit(name, code);
      }}
    >
      <div>
        <h1 className="text-2xl font-semibold">Watch a camera</h1>
        <p className="text-sm text-neutral-500 mt-1">The host will see your name while you watch.</p>
      </div>
      <input
        required
        maxLength={40}
        autoComplete="name"
        placeholder="Your name"
        ref={nameRef}
        className={inputClass}
      />
      <input
        required
        autoFocus
        minLength={6}
        maxLength={6}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="6-character code"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
        className={`${inputClass} font-mono text-lg tracking-[0.3em] uppercase`}
      />
      {error && <p className="text-sm text-red-500">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-blue-600 text-white py-3 font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? "Please wait…" : "Watch"}
      </button>
    </form>
  );
}
