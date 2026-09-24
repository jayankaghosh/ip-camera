/** The FurCam logo on a white tile, so the black line art reads in both light and dark mode. */
export function Logo({ size = 64 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center bg-white ring-1 ring-black/5"
      style={{ width: size, height: size, borderRadius: size * 0.28 }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- small static asset, no optimiser needed */}
      <img src="/logo-mark.png" alt="FurCam" width={size * 0.82} height={size * 0.82} />
    </span>
  );
}
