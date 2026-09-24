import { Icon } from "@/components/icons";
import type { MediaKind } from "@/lib/rtc";

/** Round call-style toggle for the host device's mic or camera. Off = white disc with a slashed icon. */
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
      className={`ctl ${enabled ? "" : "ctl-off"}`}
    >
      <Icon name={kind === "audio" ? "mic" : "video"} slash={!enabled} className="h-[22px] w-[22px]" />
    </button>
  );
}
