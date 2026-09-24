import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";

/** Full-height page area with its content centred. */
export function Screen({ children }: { children: ReactNode }) {
  return <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-8 sm:p-8">{children}</main>;
}

/** Rounded square with an icon, used at the top of each card. */
export function IconBadge({ icon, tone = "accent" }: { icon: IconName; tone?: "accent" | "warning" | "danger" }) {
  const tones = {
    accent: "bg-accent/12 text-accent",
    warning: "bg-warning/15 text-warning",
    danger: "bg-danger/12 text-danger",
  };
  return (
    <span className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl ${tones[tone]}`}>
      <Icon name={icon} className="h-6 w-6" />
    </span>
  );
}

export function CardHeader({
  icon,
  tone,
  title,
  children,
}: {
  icon: IconName;
  tone?: "accent" | "warning" | "danger";
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <IconBadge icon={icon} tone={tone} />
      <div>
        <h1 className="text-[1.6rem] font-semibold leading-tight tracking-tight">{title}</h1>
        {children && <div className="mt-1.5 text-[0.95rem] leading-relaxed text-muted">{children}</div>}
      </div>
    </div>
  );
}

/** A labelled input. Pass input props through; `hint` shows small text underneath. */
export function Field({
  label,
  hint,
  optional,
  ...input
}: { label: string; hint?: ReactNode; optional?: boolean } & React.ComponentProps<"input">) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">
        {label} {optional && <span className="font-normal text-muted">(optional)</span>}
      </span>
      <input className="field" {...input} />
      {hint && <span className="text-xs leading-relaxed text-muted">{hint}</span>}
    </label>
  );
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
      {children}
    </p>
  );
}

export function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`spinner ${className}`} fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Primary submit button that shows a spinner while busy. */
export function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button type="submit" disabled={busy} className="btn btn-primary w-full">
      {busy ? <Spinner /> : children}
    </button>
  );
}

/** Card for the small form screens (logins, join, setup). */
export function FormCard({ children, onBack }: { children: ReactNode; onBack?: () => void }) {
  return (
    <div className="w-full max-w-[400px]">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mb-3 -ml-1 inline-flex items-center gap-1 rounded-lg px-1 py-1 text-sm font-medium text-muted hover:text-fg"
        >
          <Icon name="chevronLeft" className="h-4 w-4" /> Back
        </button>
      )}
      <div className="card flex flex-col gap-6 p-6 sm:p-8">{children}</div>
    </div>
  );
}

/** Round avatar with the person's initials; the colour is stable per name. */
export function Avatar({ name }: { name: string }) {
  const colors = ["#0a84ff", "#30b0c7", "#34c759", "#ff9f0a", "#ff375f", "#bf5af2", "#5e5ce6", "#ac8e68"];
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
      style={{ background: colors[Math.abs(hash) % colors.length] }}
      aria-hidden="true"
    >
      {initials || "?"}
    </span>
  );
}
