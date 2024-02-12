import {
  m2h as m2hMarkdownIt,
  m2hSync as m2hSyncMarkdownIt,
} from "./markdown-it.js";
import { m2h as m2hUnified, m2hSync as m2hSyncUnified } from "./unified.js";

export interface ProcessorOptions {
  locale?: string;
}

export async function m2h(md: string, options: ProcessorOptions) {
  if (process.env.USE_MARKDOWN_IT) {
    return await m2hMarkdownIt(md, {});
  }
  return await m2hUnified(md, options);
}

export function m2hSync(md: string, options: ProcessorOptions) {
  if (process.env.USE_MARKDOWN_IT) {
    return m2hSyncMarkdownIt(md, {});
  }
  return m2hSyncUnified(md, options);
}
