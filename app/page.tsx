import { requireOwner, signOut } from "@/lib/auth";

export default async function HomePage() {
  const session = await requireOwner();

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/signin" });
  }

  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-semibold">readmyagent</h1>
      <p className="mt-2 text-neutral-700">Phase 1 in progress. The reader is not built yet.</p>
      <p className="mt-4 text-sm text-neutral-600">Signed in as {session.user?.email}.</p>
      <form action={signOutAction} className="mt-2">
        <button type="submit" className="text-sm underline">
          Sign out
        </button>
      </form>
    </main>
  );
}
