import { describe, expect, it, vi } from "vitest";
import { createDriveClient, DriveError, MAX_RUN_FILE_BYTES } from "@/lib/drive";

type Call = { url: URL; init: RequestInit };

function fakeFetch(responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const fn = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(input as string), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("No more fake responses");
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

function client(responses: (Response | Error)[]) {
  const fake = fakeFetch(responses);
  const drive = createDriveClient({
    folderId: "folder'1",
    feedbackFileId: "feedback-id",
    getHeaders: () => Promise.resolve(new Headers({ Authorization: "Bearer test-token" })),
    fetch: fake.fetch,
    sleep: () => Promise.resolve(),
  });
  return { drive, calls: fake.calls };
}

const file = { id: "f1", name: "a.json", modifiedTime: new Date(), createdTime: null, size: 10 };

describe("Drive client", () => {
  it("lists the folder with an escaped query, follows pages and sends credentials", async () => {
    const { drive, calls } = client([
      json({
        files: [
          {
            id: "a",
            name: "a.json",
            modifiedTime: "2026-11-18T06:00:00Z",
            createdTime: "2026-11-18T05:59:00Z",
            size: "12",
          },
        ],
        nextPageToken: "p2",
      }),
      json({ files: [{ id: "b", name: "b.md", modifiedTime: "2026-11-18T06:01:00Z" }] }),
    ]);

    const files = await drive.listFiles(new Date("2026-11-17T00:00:00Z"));

    expect(files).toEqual([
      {
        id: "a",
        name: "a.json",
        modifiedTime: new Date("2026-11-18T06:00:00Z"),
        createdTime: new Date("2026-11-18T05:59:00Z"),
        size: 12,
      },
      {
        id: "b",
        name: "b.md",
        modifiedTime: new Date("2026-11-18T06:01:00Z"),
        createdTime: null,
        size: null,
      },
    ]);
    const q = calls[0]!.url.searchParams.get("q");
    expect(q).toBe(
      "'folder\\'1' in parents and trashed = false and modifiedTime > '2026-11-17T00:00:00.000Z'",
    );
    expect(calls[0]!.url.searchParams.get("fields")).toContain("createdTime");
    expect(calls[1]!.url.searchParams.get("pageToken")).toBe("p2");
    expect(new Headers(calls[0]!.init.headers).get("authorization")).toBe("Bearer test-token");
  });

  it("lists everything when there is no previous sync", async () => {
    const { drive, calls } = client([json({ files: [] })]);
    await drive.listFiles(null);
    expect(calls[0]!.url.searchParams.get("q")).not.toContain("modifiedTime");
  });

  it("downloads file content", async () => {
    const { drive, calls } = client([new Response('{"a":1}')]);
    expect(await drive.download(file)).toBe('{"a":1}');
    expect(calls[0]!.url.pathname).toBe("/drive/v3/files/f1");
    expect(calls[0]!.url.searchParams.get("alt")).toBe("media");
  });

  it("refuses files over the size limit without downloading them", async () => {
    const { drive, calls } = client([]);
    await expect(drive.download({ ...file, size: MAX_RUN_FILE_BYTES + 1 })).rejects.toThrow(
      DriveError,
    );
    expect(calls).toHaveLength(0);
  });

  it("updates feedback.json in place and never creates a file", async () => {
    const { drive, calls } = client([json({ id: "feedback-id" })]);
    await drive.write('{"entries":[]}');
    const { url, init } = calls[0]!;
    expect(init.method).toBe("PATCH");
    expect(url.pathname).toBe("/upload/drive/v3/files/feedback-id");
    expect(url.searchParams.get("uploadType")).toBe("media");
    expect(init.body).toBe('{"entries":[]}');
    expect(new Headers(init.headers).get("content-type")).toContain("application/json");
  });

  it("retries rate limits, server errors and network failures, then succeeds", async () => {
    const { drive, calls } = client([
      new Response("", { status: 429 }),
      new Error("socket hang up"),
      new Response("ok"),
    ]);
    expect(await drive.download(file)).toBe("ok");
    expect(calls).toHaveLength(3);
  });

  it("does not retry client errors", async () => {
    const { drive, calls } = client([new Response("", { status: 403 })]);
    const error = await drive.download(file).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DriveError);
    expect((error as DriveError).status).toBe(403);
    expect(calls).toHaveLength(1);
  });

  it("gives up after three attempts", async () => {
    const { drive, calls } = client([
      new Response("", { status: 503 }),
      new Response("", { status: 503 }),
      new Response("", { status: 503 }),
    ]);
    await expect(drive.listFiles(null)).rejects.toThrow("HTTP 503");
    expect(calls).toHaveLength(3);
  });
});
