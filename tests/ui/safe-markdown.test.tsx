import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SafeMarkdown } from "@/components/safe-markdown";

const render = (md: string) => renderToStaticMarkup(<SafeMarkdown>{md}</SafeMarkdown>);

// SECURITY.md T2: agent output may contain text from mails, web pages and repositories.
describe("SafeMarkdown", () => {
  it("renders ordinary Markdown, including tables", () => {
    const html = render("**bold** and `code`\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<table>");
  });

  it("drops raw HTML instead of rendering it", () => {
    const html = render('Hi <script>alert(1)</script><img src=x onerror="alert(1)"> <b>x</b>');
    expect(html).not.toMatch(/<script|<img|onerror|<b>/);
  });

  it("does not load images, keeping only their alt text", () => {
    const html = render("![pixel](https://tracker.example/p.gif)");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("tracker.example");
  });

  it("opens http links safely and neutralises other schemes", () => {
    const html = render(
      "[site](https://example.com) [bad](javascript:alert(1)) [data](data:text/html,x)",
    );
    expect(html).toContain(
      '<a href="https://example.com/" target="_blank" rel="noopener noreferrer nofollow"',
    );
    expect(html).not.toMatch(/javascript:|data:text/);
    expect(html).toContain("<span>bad</span>");
  });

  it("renders a full Markdown run log with tables and without raw HTML", () => {
    const log = readFileSync(
      join(import.meta.dirname, "..", "fixtures", "markdown", "weekbrief-run-2026-w48.md"),
      "utf8",
    );
    const html = render(log);
    expect(html).toContain("<h1>Weekbrief 2026-w48");
    expect(html).toContain("<table>");
    expect(html).not.toContain("<script");
  });
});
