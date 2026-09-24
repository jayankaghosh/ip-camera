/** Shown beside a viewer's name: animated bars while they speak, a small mic while their mic is on. */
export function TalkIndicator({ micOn, speaking }: { micOn: boolean; speaking: boolean }) {
  if (speaking) {
    return (
      <span role="img" aria-label="Speaking" title="Speaking" className="flex h-4 items-end gap-[2px] text-green-500">
        {[0, 1, 2].map((i) => (
          <span key={i} className="talk-bar w-[3px] rounded-full bg-current" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </span>
    );
  }
  if (micOn) {
    return (
      <svg
        role="img"
        aria-label="Mic on"
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5 text-neutral-500"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <title>Mic on</title>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
    );
  }
  return null;
}
