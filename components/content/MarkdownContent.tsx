import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Shared renderer for markdown-authored pages (starting with /privacy —
// see lib/content/privacy.ts's own comment on why the content lives in
// plain .md files rather than a component or messages/*.json). Not
// specific to the privacy policy: any future long-form legal/content
// page (terms of service, etc.) can reuse this instead of re-styling
// react-markdown's element set from scratch.
//
// remark-gfm is required, not optional — the source documents use
// GitHub-flavored tables (the data/legal-basis/provider tables), which
// plain CommonMark doesn't parse at all.
//
// Heading levels start at h2 deliberately: the page itself owns the one
// h1 (its title), so every section heading in the markdown body (##) is
// the next level down — correct nesting, not a skipped level.
export function MarkdownContent({ markdown }: { markdown: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h2: ({ children }) => (
          <h2 style={{ font: "var(--text-heading-md)", color: "var(--text-primary)", margin: "var(--space-8) 0 var(--space-3)" }}>
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 style={{ font: "var(--text-heading-sm)", color: "var(--text-primary)", margin: "var(--space-5) 0 var(--space-2)" }}>
            {children}
          </h3>
        ),
        p: ({ children }) => (
          <p style={{ font: "var(--text-body-md)", color: "var(--text-secondary)", margin: "var(--space-3) 0" }}>{children}</p>
        ),
        ul: ({ children }) => (
          <ul style={{ margin: "var(--space-3) 0", paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol style={{ margin: "var(--space-3) 0", paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {children}
          </ol>
        ),
        li: ({ children }) => <li style={{ font: "var(--text-body-md)", color: "var(--text-secondary)" }}>{children}</li>,
        strong: ({ children }) => <strong style={{ color: "var(--text-primary)" }}>{children}</strong>,
        a: ({ href, children }) => (
          <a href={href} style={{ color: "var(--accent)" }} target={href?.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote
            style={{
              margin: "var(--space-4) 0",
              padding: "var(--space-3) var(--space-4)",
              borderLeft: "3px solid var(--border-default)",
              color: "var(--text-tertiary)",
              font: "var(--text-body-sm)",
            }}
          >
            {children}
          </blockquote>
        ),
        // Wide tables scroll inside their own container instead of ever
        // widening the page body — same convention this app already
        // uses for any other wide content.
        table: ({ children }) => (
          <div style={{ overflowX: "auto", margin: "var(--space-4) 0" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", font: "var(--text-body-sm)" }}>{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead style={{ background: "var(--bg-sunken)" }}>{children}</thead>,
        th: ({ children }) => (
          <th
            style={{
              padding: "var(--space-2) var(--space-3)",
              border: "1px solid var(--border-subtle)",
              textAlign: "left",
              color: "var(--text-primary)",
              whiteSpace: "nowrap",
            }}
          >
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td style={{ padding: "var(--space-2) var(--space-3)", border: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}>
            {children}
          </td>
        ),
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}
