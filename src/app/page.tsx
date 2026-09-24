import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">IP Camera</h1>
        <p className="text-neutral-500 mt-2">Are you streaming a camera or watching one?</p>
      </div>
      <div className="grid w-full max-w-md grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/host"
          className="rounded-xl border border-neutral-300 dark:border-neutral-700 p-6 hover:border-blue-500 transition-colors"
        >
          <div className="text-lg font-medium">Host</div>
          <p className="text-sm text-neutral-500 mt-1">Share this device&apos;s camera and microphone.</p>
        </Link>
        <Link
          href="/view"
          className="rounded-xl border border-neutral-300 dark:border-neutral-700 p-6 hover:border-blue-500 transition-colors"
        >
          <div className="text-lg font-medium">Viewer</div>
          <p className="text-sm text-neutral-500 mt-1">Watch a live camera with its password.</p>
        </Link>
      </div>
    </main>
  );
}
