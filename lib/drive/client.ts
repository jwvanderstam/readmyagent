import type { FeedbackFileWriter } from "@/lib/feedback";
import { log } from "@/lib/log";

const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";

/** Larger than any valid run file (200 items of at most 4000 characters), small enough to be safe. */
export const MAX_RUN_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ATTEMPTS = 3;

export type DriveFile = {
  id: string;
  name: string;
  modifiedTime: Date;
  /** When the file was created; for a Markdown log, the end of its run (ADR-0011). */
  createdTime: Date | null;
  size: number | null;
};

/** What sync needs from Drive. Implemented by the Drive client, and by fakes in tests. */
export interface RunFileSource {
  /** Files in the agent folder, optionally only those modified after `since`. */
  listFiles(since: Date | null): Promise<DriveFile[]>;
  /** The text content of a file. Throws DriveError, also when the file is too large. */
  download(file: DriveFile): Promise<string>;
}

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "DriveError";
  }
}

export type DriveClientOptions = {
  folderId: string;
  feedbackFileId: string;
  /** Authorization headers for each request (Workload Identity Federation or key). */
  getHeaders: () => Promise<Headers>;
  fetch?: typeof fetch;
  /** Waits between retries; injectable so tests do not sleep. */
  sleep?: (ms: number) => Promise<void>;
};

/** Escape a value for a Drive query string literal. */
const quote = (value: string) => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

type FilesPage = {
  files?: { id: string; name: string; modifiedTime: string; createdTime?: string; size?: string }[];
  nextPageToken?: string;
};

/**
 * Minimal Drive v3 client for the agent folder. Read files, and update the content of the
 * owner-created feedback.json. It never creates files: the service account has no storage quota
 * (ADR-0006, ADR-0008).
 */
export function createDriveClient(options: DriveClientOptions): RunFileSource & FeedbackFileWriter {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  async function request(url: string, init: RequestInit, event: string): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      const headers = await options.getHeaders();
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
      let response: Response;
      try {
        response = await doFetch(url, { ...init, headers });
      } catch (e) {
        if (attempt >= MAX_ATTEMPTS) {
          log("error", event, "Drive request failed", { attempt });
          throw new DriveError(`Drive request failed: ${(e as Error).message}`, null);
        }
        await sleep(250 * 2 ** attempt);
        continue;
      }
      if (response.ok) return response;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= MAX_ATTEMPTS) {
        log("error", event, "Drive returned an error", { status: response.status, attempt });
        throw new DriveError(`Drive returned HTTP ${response.status}`, response.status);
      }
      await sleep(250 * 2 ** attempt);
    }
  }

  return {
    async listFiles(since) {
      const conditions = [`${quote(options.folderId)} in parents`, "trashed = false"];
      if (since) conditions.push(`modifiedTime > ${quote(since.toISOString())}`);
      const files: DriveFile[] = [];
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({
          q: conditions.join(" and "),
          fields: "nextPageToken, files(id, name, modifiedTime, createdTime, size)",
          pageSize: "1000",
          orderBy: "modifiedTime",
        });
        if (pageToken) params.set("pageToken", pageToken);
        const response = await request(`${API}?${params}`, { method: "GET" }, "drive.list_failed");
        const page = (await response.json()) as FilesPage;
        for (const f of page.files ?? []) {
          files.push({
            id: f.id,
            name: f.name,
            modifiedTime: new Date(f.modifiedTime),
            createdTime: f.createdTime === undefined ? null : new Date(f.createdTime),
            size: f.size === undefined ? null : Number(f.size),
          });
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
      return files;
    },

    async download(file) {
      if (file.size !== null && file.size > MAX_RUN_FILE_BYTES) {
        throw new DriveError(
          `File is ${file.size} bytes; the limit is ${MAX_RUN_FILE_BYTES}.`,
          null,
        );
      }
      const url = `${API}/${encodeURIComponent(file.id)}?alt=media`;
      const response = await request(url, { method: "GET" }, "drive.download_failed");
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_RUN_FILE_BYTES) {
        throw new DriveError(`File exceeds ${MAX_RUN_FILE_BYTES} bytes.`, null);
      }
      return text;
    },

    async write(content) {
      // Update the content of the existing file. Never `files.create` (ADR-0006).
      const url = `${UPLOAD_API}/${encodeURIComponent(options.feedbackFileId)}?uploadType=media`;
      await request(
        url,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: content,
        },
        "drive.feedback_write_failed",
      );
    },
  };
}
