"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { ErrorMessage, Field, SubmitButton } from "@/components/ui";

const NAME_KEY = "ip-camera:name";

export function JoinForm({
  initialCode = "",
  busy,
  error,
  onSubmit,
}: {
  initialCode?: string;
  busy: boolean;
  error: string | null;
  onSubmit: (name: string, code: string, password: string) => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);

  // Prefill the name used last time (after mount, so the prerendered HTML matches).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(NAME_KEY);
      if (saved && nameRef.current && !nameRef.current.value) nameRef.current.value = saved;
    } catch {}
  }, []);
  const [code, setCode] = useState(initialCode);
  const [password, setPassword] = useState("");

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const name = nameRef.current?.value.trim() ?? "";
        try {
          localStorage.setItem(NAME_KEY, name);
        } catch {}
        onSubmit(name, code, password);
      }}
    >
      <Field label="Your name" required maxLength={40} autoComplete="name" ref={nameRef} hint="The host sees this while you watch." />
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Code</span>
        <input
          required
          autoFocus={!initialCode}
          minLength={6}
          maxLength={6}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="ABC123"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          className="field text-center font-mono text-2xl font-semibold uppercase tracking-[0.35em] placeholder:tracking-[0.35em] placeholder:opacity-40"
        />
      </label>
      <Field
        label="Stream password"
        optional
        type="password"
        maxLength={64}
        autoComplete="off"
        placeholder="Only if the host set one"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <ErrorMessage>{error}</ErrorMessage>
      <SubmitButton busy={busy}>
        <Icon name="monitor" /> Watch
      </SubmitButton>
    </form>
  );
}
