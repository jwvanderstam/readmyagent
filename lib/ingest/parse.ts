import { z } from "zod";
import { type RunFile, runFileSchema } from "@/lib/contract";

export type ParseResult = { ok: true; run: RunFile } | { ok: false; message: string };

const MAX_MESSAGE_LENGTH = 2000;

const truncate = (s: string) =>
  s.length > MAX_MESSAGE_LENGTH ? `${s.slice(0, MAX_MESSAGE_LENGTH - 3)}...` : s;

/** Parse and validate the text of a run file. Pure: no I/O, never throws. */
export function parseRunFile(content: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (e) {
    return { ok: false, message: truncate(`Not valid JSON: ${(e as Error).message}`) };
  }

  // A future major version needs its own adapter (agent contract, section 5). Say so explicitly
  // instead of reporting a pattern mismatch.
  if (typeof data === "object" && data !== null && "contract_version" in data) {
    const version = data.contract_version;
    if (typeof version === "string" && !version.startsWith("1.")) {
      return {
        ok: false,
        message: `Unsupported contract version ${version}; this reader accepts 1.x.`,
      };
    }
  }

  const parsed = runFileSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      message: truncate(`Contract violation:\n${z.prettifyError(parsed.error)}`),
    };
  }
  return { ok: true, run: parsed.data };
}
