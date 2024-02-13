import { ProcessorOptions, decodeKS, encodeKS } from "../index.js";
import markdownit, { Token } from "markdown-it";
import deflist from "markdown-it-deflist";
import { escapeHtml, unescapeAll } from "markdown-it/lib/common/utils.mjs";
import StateCore from "markdown-it/lib/rules_core/state_core.js";
import StateBlock from "markdown-it/lib/rules_block/state_block.js";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_LOCALE } from "../../libs/constants/index.js";

const DL_RE = /^(> )?( *)- ([^\n]+)\n+(> )?( *)- : /gm;

export function replaceOldDl(html: string): string {
  const ret = html.replace(DL_RE, "$1$3\n$4:   ");
  return ret;
}

// These use the `markdown-it` parser (env USE_MARKDOWN_IT=1).
export async function m2h(md: string, options: ProcessorOptions) {
  return m2hSync(md, options);
}

let mdi: markdownit;

// TODO: Original has a localized processor, we are ignoring this here
export async function m2hSync(md: string, options: ProcessorOptions) {
  const locale = options.locale || "en-US";
  if (!mdi) {
    mdi = markdownit({
      html: true,
      linkify: false,
      typographer: false,
      quotes: "“”‘’",
    })
      .use(deflist)
      .use(customProcessor(locale));
  }
  const dlReplaced = replaceOldDl(String(md));
  const macroEncoded = encodeKS(dlReplaced);
  const htmlMacroEncoded = mdi.render(String(macroEncoded));
  const html = decodeKS(htmlMacroEncoded);
  return html;
}

// Cached notePatterns (localized regexp patterns for note cards)
const notePatterns = new Map<string, RegExp>();
function loadNotePatterns() {
  const localeDir = new URL(`../localizations/`, import.meta.url);
  fs.readdirSync(localeDir).forEach((fileName) => {
    if (!fileName.endsWith(".json")) {
      return;
    }

    const txData = JSON.parse(
      fs.readFileSync(new URL(fileName, localeDir).pathname, "utf-8")
    );
    const tx = txData["translations"][""];
    if (!tx) {
      return;
    }
    const locale = path.basename(fileName, path.extname(fileName));
    const typesOred = ["note", "warning", "callout"]
      .map((type) => {
        const msgName = `card_${type}_label`;
        return tx[msgName]["msgstr"][0].replace(/[: ：]/g, "").toLowerCase();
      })
      .join("|");
    notePatterns.set(
      locale,
      new RegExp(`^\\*\\*(${typesOred}).*\\*\\* *`, "i")
    );
  });
}

// Returns a localized markdown extension function.
function customProcessor(locale: string) {
  // Load the notePatterns if needed.
  if (!notePatterns.size) {
    loadNotePatterns();
  }

  return (md: markdownit) => {
    // Custom ```fence``` renderer that add our css language class and
    // optionally others.
    md.renderer.rules.fence = function (tokens, idx) {
      const token = tokens[idx];
      const info = token.info ? unescapeAll(token.info).trim() : "";
      const meta = info.split(/\s+/);
      const language = meta[0]?.replace(/-nolint$/, "");
      meta.shift();
      const cssClasses = (
        language ? `brush: ${language} ${meta.join(" ")}` : `${meta.join(" ")}`
      ).trim();

      return `<pre class="${cssClasses}">${escapeHtml(token.content)}</pre>\n`;
    };

    // Treat Kuma macros that appear on a block level to
    // not be qwrapped in <p> tags.
    // Macro content is base64-encoded at this stage,
    // they look like `{{aHRtbGVsZW1lbnQoImNhbnZhcyIp}}`.
    // We pass this encoded payload through unchanged.
    const kumaScriptMatcher = /(^{{.*?}})$/;
    function kumaScriptMacro(
      state: StateBlock,
      startLine: number,
      endLine: number
    ) {
      for (
        let nextLine = startLine;
        nextLine < endLine && !state.isEmpty(nextLine);
        nextLine++
      ) {
        const line = state.src.slice(
          state.bMarks[nextLine],
          state.eMarks[nextLine]
        );
        const match = line.match(kumaScriptMatcher);
        if (match) {
          const line = state.getLines(
            nextLine,
            nextLine + 1,
            state.blkIndent,
            true
          );
          const token = state.push("kumascript", "", 0);
          token.block = true;
          token.content = line;
          token.map = [nextLine, nextLine + 1];
          state.line = nextLine + 1;
          return true;
        }
        return false;
      }
      return false;
    }
    md.block.ruler.before("paragraph", "kumascript", kumaScriptMacro);

    const kumaScriptMacroRenderer = function (tokens: Token[], idx: number) {
      return `\n${tokens[idx].content}\n`;
    };
    md.renderer.rules.kumascript = kumaScriptMacroRenderer;

    // A helper that finds next index of a token by toke type and start index, or -1 if not found.
    // An optional `level` can be provided to match the token level.
    function findTokenIndex(
      tokens: Token[],
      props: { type: TokenType; level?: number },
      position: number
    ) {
      for (let i = position, l = tokens.length; i < l; i++) {
        if (
          tokens[i].type === props.type &&
          (props.level === undefined || tokens[i].level === props.level)
        ) {
          return i;
        }
      }
      return -1;
    }

    enum TokenType {
      BLOCKQUOTE_OPEN = "blockquote_open",
      BLOCKQUOTE_CLOSE = "blockquote_close",
      PARAGRAPH_OPEN = "paragraph_open",
      PARAGRAPH_CLOSE = "paragraph_close",
      NOOP = "noop",
      INLINE = "inline",
      NOTECARD_OPEN = "notecard_open",
      NOTECARD_CLOSE = "notecard_close",
    }

    // Special behaviour for blockquote.
    // If there is a `**Warning:**` or `**Note:**` or `**Callout:**`
    // as the first child in the block, covert it to a <div class="notecard">
    //
    // We are looking for blockquotes that contain a paragraph with
    // a bolded note pattern.
    // We do not support nested notecards.
    // We only modify token attributes, in some cases we disable tokens
    // by setting their type to 'noop', with a matching renderer set up.
    function notecardMacro(state: StateCore) {
      const tokens = state.tokens;
      for (let i = 0; i < tokens.length; i++) {
        // Find the opening tag of the next blockquote.
        const start = findTokenIndex(
          tokens,
          { type: TokenType.BLOCKQUOTE_OPEN },
          i
        );
        if (start === -1) {
          continue;
        }

        // Find the closing tag of the current block quote.
        const level = tokens[start].level;
        const end = findTokenIndex(
          tokens,
          { type: TokenType.BLOCKQUOTE_CLOSE, level: level },
          start + 1
        );
        if (end === -1) {
          continue;
        }

        // Next time around, continue from the end of the current blockquote.
        // There are no nested notecards.
        i = end;

        // Detect a notecard pattern: a paragraph_open followed by an inline tag.
        // If the inline tag contains the note pattern, then we have a notecard.

        // The matching notecard terms are localized, we need to translate them back to
        // english / our css class names.
        const notePattern =
          notePatterns.get(locale) || notePatterns.get(DEFAULT_LOCALE);
        const paragraphOpen = tokens[start + 1];
        const inlineTag = tokens[start + 2];
        if (
          paragraphOpen.type === TokenType.PARAGRAPH_OPEN &&
          inlineTag.type === TokenType.INLINE
        ) {
          // We transform blockquote_open and blockquote_close tags
          // to notecard_open and notecard_close tags, with a
          // notecardType attribute.
          // Special case on `callout` notecards: We usually get a
          // We also remove the `**Callout:**` prefix/paragraph.
          const match = inlineTag.content.match(notePattern);
          if (match) {
            // We have hit a note card.
            // annotate the blockquote tokens
            const notecardType = match[1].toLowerCase();
            tokens[start].type = TokenType.NOTECARD_OPEN;
            tokens[start].attrPush(["notecardType", notecardType]);
            tokens[end].type = TokenType.NOTECARD_CLOSE;
            tokens[start].attrPush(["notecardType", notecardType]);
            // Callout notecard special handling
            if (notecardType === "callout") {
              // First, get the paragraph_open/close pair.
              const pStart = findTokenIndex(
                tokens,
                { type: TokenType.PARAGRAPH_OPEN },
                start + 1
              );
              if (pStart === -1) {
                return;
              }
              const pLevel = tokens[pStart].level;
              const pEnd = findTokenIndex(
                tokens,
                { type: TokenType.PARAGRAPH_CLOSE, level: pLevel },
                pStart + 1
              );
              if (pEnd === -1) {
                return;
              }

              tokens[pStart].type = TokenType.NOOP;
              tokens[pEnd].type = TokenType.NOOP;
              inlineTag.type = TokenType.NOOP;
            }
          }
        }
      }
      return false;
    }
    // Insert the notecard function into the core parsing pipeline.
    md.core.ruler.after("block", "notecard", notecardMacro);

    // Set up renderers for notecard_open, notecard_close and noop tokens.
    const notecardOpenRenderer = function (tokens: Token[], idx: number) {
      const notecardType = tokens[idx].attrGet("notecardType");
      const classNames =
        notecardType === "callout" ? ["callout"] : ["notecard", notecardType];
      return `<div class="${classNames.join(" ")}">\n`;
    };
    const notecardCloseRenderer = function (/*tokens: Token[], idx: number*/) {
      return `</div>\n`;
    };
    const noopRenderer = function (/*tokens: Token[], idx: number*/) {
      return "";
    };
    md.renderer.rules.notecard_open = notecardOpenRenderer;
    md.renderer.rules.notecard_close = notecardCloseRenderer;
    md.renderer.rules.noop = noopRenderer;
  };
}
