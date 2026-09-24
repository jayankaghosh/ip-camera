/** "← Back" link to the Host / Viewer choice, aligned with the forms below it. */
export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="w-full max-w-sm">
      <button onClick={onClick} className="text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
        ← Back
      </button>
    </div>
  );
}
