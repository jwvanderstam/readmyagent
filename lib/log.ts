// Structured JSON logs (docs/standards.md, section 6): one event name per log site, IDs instead of
// content, never secrets, tokens, file contents or mail data.

type Level = "debug" | "info" | "warn" | "error";
type Context = Record<string, string | number | boolean | null | undefined>;

export function log(level: Level, event: string, msg: string, context: Context = {}): void {
  const line = JSON.stringify({ level, event, msg, time: new Date().toISOString(), ...context });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
