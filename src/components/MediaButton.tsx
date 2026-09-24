import type { MediaKind } from "@/lib/rtc";

const ICONS: Record<MediaKind, React.ReactNode> = {
  audio: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3z" />
    </>
  ),
};

/** Round toggle for the host device's mic or camera; shows a slash when off. */
export function MediaButton({
  kind,
  enabled,
  disabled,
  onToggle,
}: {
  kind: MediaKind;
  enabled: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const label = `${enabled ? "Turn off" : "Turn on"} ${kind === "audio" ? "mic" : "camera"}`;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={!enabled}
      className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors disabled:opacity-50 ${
        enabled ? "bg-neutral-700 text-white hover:bg-neutral-600" : "bg-red-600 text-white hover:bg-red-700"
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {ICONS[kind]}
        {!enabled && <path d="M3 3l18 18" />}
      </svg>
    </button>
  );
}
