"use client";

// Shown when a page or Server Action fails. The message stays generic: details go to the logs,
// never to the page (SECURITY.md).
export default function ReaderError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="py-8">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-1 text-neutral-700">The action did not complete. Try again.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-neutral-900"
      >
        Try again
      </button>
    </div>
  );
}
