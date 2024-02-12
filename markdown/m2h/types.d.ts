declare module "markdown-it-deflist" {
  export default function deflist(md: markdownit): void;
}

declare module "markdown-it/lib/common/utils.mjs" {
  export function escapeHtml(str: string): string;
  export function unescapeAll(str: string): string;
}
