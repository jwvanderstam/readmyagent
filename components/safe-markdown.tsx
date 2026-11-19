import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { safeHttpUrl } from "@/lib/format";

// The only way agent-produced text is rendered (docs/standards.md section 8, SECURITY.md T2).
// - Raw HTML in the source is dropped, never rendered.
// - Images are not loaded: a remote image in a mail summary would be a tracking pixel.
// - Links open only for http(s) and never pass a referrer or ranking signal.
const components: Components = {
  a: ({ href, children }) => {
    const url = safeHttpUrl(href);
    if (!url) return <span>{children}</span>;
    return (
      <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="underline">
        {children}
      </a>
    );
  },
};

export function SafeMarkdown({ children }: { children: string }) {
  return (
    <div className="space-y-2 break-words [&_code]:rounded [&_code]:bg-neutral-100 [&_code]:px-1 [&_li]:ml-5 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto [&_ul]:list-disc">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        disallowedElements={["img"]}
        unwrapDisallowed
        components={components}
      >
        {children}
      </Markdown>
    </div>
  );
}
