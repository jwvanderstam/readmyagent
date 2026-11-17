import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOwnerSession, signIn } from "@/lib/auth";
import { safeCallbackPath } from "@/lib/auth/policy";

export const metadata: Metadata = { title: "Sign in · readmyagent" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function errorMessage(error: string | string[] | undefined): string | null {
  if (!error) return null;
  if (error === "AccessDenied") return "This Google account is not allowed on this instance.";
  return "Sign-in failed. Try again.";
}

export default async function SignInPage({ searchParams }: Props) {
  const params = await searchParams;
  const callbackPath = safeCallbackPath(params.callbackUrl);
  if (await getOwnerSession()) redirect(callbackPath);

  const error = errorMessage(params.error);

  async function signInWithGoogle() {
    "use server";
    await signIn("google", { redirectTo: callbackPath });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-4">
      <h1 className="text-2xl font-semibold">readmyagent</h1>
      <p className="mt-2 text-neutral-700">Sign in with the Google account of this instance.</p>
      {error && (
        <p role="alert" className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-red-900">
          {error}
        </p>
      )}
      <form action={signInWithGoogle} className="mt-6">
        <button
          type="submit"
          className="w-full rounded bg-neutral-900 px-4 py-3 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
        >
          Sign in with Google
        </button>
      </form>
    </main>
  );
}
