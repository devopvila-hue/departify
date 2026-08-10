/**
 * Markdown renderer — Customer Zero 01.
 *
 * A tiny, safe Markdown renderer used by the chat. The backend
 * already strips bold markers; this renderer covers the remaining
 * surface:
 *
 *   - bold `**…**` (defensive; should be stripped already)
 *   - italic `*…*` / `_…_`
 *   - inline code `` `…` ``
 *   - bullets (`- ` or `* `)
 *   - numbered lists (`1. `, `2. `, …)
 *   - paragraphs (blank line separated)
 *   - safe links `[text](https://…)` — http/https only
 *
 * SECURITY: input is HTML-escaped first, then Markdown is applied.
 * Only the explicit tags below are emitted. No raw HTML survives
 * from user input.
 */

export type MarkdownInline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type MarkdownBlock =
  | { kind: "paragraph"; inlines: readonly MarkdownInline[] }
  | { kind: "list"; items: readonly (readonly MarkdownInline[])[] }
  | { kind: "numbered-list"; items: readonly (readonly MarkdownInline[])[] };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseInline(line: string): MarkdownInline[] {
  const out: MarkdownInline[] = [];
  const text = line;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        out.push({ kind: "bold", text: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    if (ch === "*") {
      const end = text.indexOf("*", i + 1);
      if (end > i + 1) {
        out.push({ kind: "italic", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "_") {
      const end = text.indexOf("_", i + 1);
      if (end > i + 1) {
        out.push({ kind: "italic", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        out.push({ kind: "code", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "[") {
      const close = text.indexOf("]", i + 1);
      const openParen = close > 0 ? text.indexOf("(", close) : -1;
      const closeParen = openParen > 0 ? text.indexOf(")", openParen) : -1;
      if (close > 0 && openParen === close + 1 && closeParen > openParen) {
        const label = text.slice(i + 1, close);
        const href = text.slice(openParen + 1, closeParen);
        if (/^https?:\/\//i.test(href)) {
          out.push({ kind: "link", text: label, href });
          i = closeParen + 1;
          continue;
        }
      }
    }
    let j = i + 1;
    while (j < text.length) {
      const c = text[j];
      if (c === "*" || c === "_" || c === "`" || c === "[") break;
      j += 1;
    }
    out.push({ kind: "text", text: text.slice(i, j) });
    i = j;
  }
  return out;
}

export function parseMarkdown(input: string): MarkdownBlock[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i] ?? "";
    if (rawLine.trim().length === 0) {
      i += 1;
      continue;
    }
    if (/^\s*\d+\.\s+/.test(rawLine)) {
      const items: MarkdownInline[][] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? "")) {
        items.push(parseInline((lines[i] ?? "").replace(/^\s*\d+\.\s+/, "")));
        i += 1;
      }
      blocks.push({ kind: "numbered-list", items });
      continue;
    }
    if (/^\s*[-*]\s+/.test(rawLine)) {
      const items: MarkdownInline[][] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? "")) {
        items.push(parseInline((lines[i] ?? "").replace(/^\s*[-*]\s+/, "")));
        i += 1;
      }
      blocks.push({ kind: "list", items });
      continue;
    }
    const paragraphLines: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim().length > 0 &&
      !/^\s*[-*]\s+/.test(lines[i] ?? "") &&
      !/^\s*\d+\.\s+/.test(lines[i] ?? "")
    ) {
      paragraphLines.push(lines[i] ?? "");
      i += 1;
    }
    blocks.push({ kind: "paragraph", inlines: parseInline(paragraphLines.join(" ")) });
  }
  return blocks;
}

function renderInline(inlines: readonly MarkdownInline[]): string {
  return inlines
    .map((node) => {
      switch (node.kind) {
        case "text":
          return escapeHtml(node.text);
        case "bold":
          return `<strong>${escapeHtml(node.text)}</strong>`;
        case "italic":
          return `<em>${escapeHtml(node.text)}</em>`;
        case "code":
          return `<code>${escapeHtml(node.text)}</code>`;
        case "link":
          return `<a href="${escapeHtml(node.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(node.text)}</a>`;
      }
    })
    .join("");
}

export function renderMarkdown(input: string): string {
  const blocks = parseMarkdown(input);
  return blocks
    .map((block) => {
      if (block.kind === "paragraph") {
        return `<p>${renderInline(block.inlines)}</p>`;
      }
      const items = block.items.map((it) => `<li>${renderInline(it)}</li>`).join("");
      return block.kind === "list" ? `<ul>${items}</ul>` : `<ol>${items}</ol>`;
    })
    .join("");
}
