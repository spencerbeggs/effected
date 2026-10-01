import type { Block, Document } from "../Doc.js";
import { Doc } from "../Doc.js";
import type { RenderContext } from "../Render.js";
import { plainInline, renderPlain } from "./renderPlain.js";
import { escapeData } from "./workflowCommand.js";

/**
 * A line the runner reads as a command: after its leading whitespace it starts with `::`, or with `##`, the legacy
 * prefix of `##[error]` and `##vso[...]`. The whitespace is .NET's, which is JavaScript's `\s` plus U+0085.
 */
const COMMAND = /^[\s\u0085]*(?:::|##)/;

/** The runner's line breaks: it splits at a lone CR as well as at LF and CRLF. */
const LINE_BREAK = /\r\n|\r|\n/;

/** U+200B, written by code point so the source carries no invisible character. */
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);

/**
 * Make a line of text safe to put in a log: a line that would be read as a command gets a zero-width space in front,
 * which the runner does not count as whitespace, so it is no longer at the start of the line.
 */
const neutralize = (line: string): string => (COMMAND.test(line) ? `${ZERO_WIDTH_SPACE}${line}` : line);

/**
 * Split text at the runner's line breaks and neutralize each line that would be read as a command.
 *
 * @internal
 */
export const neutralizeLines = (text: string): ReadonlyArray<string> => text.split(LINE_BREAK).map(neutralize);

const plainLines = (blocks: ReadonlyArray<Block>, ctx: RenderContext): ReadonlyArray<string> =>
	blocks.length === 0 ? [] : neutralizeLines(renderPlain(blocks, ctx));

const blockLines = (block: Block, ctx: RenderContext): ReadonlyArray<string> => {
	switch (block._tag) {
		case "Collapsible": {
			// The title is a command's data, so its line breaks are escaped: a raw one would end the command.
			const title = plainInline(block.title, ctx)
				.map((span) => span.text)
				.join("");
			// Groups do not nest: inside this one a collapsible is plain text, its title and its indented body.
			return [`::group::${escapeData(title)}`, ...plainLines(block.body, ctx), "::endgroup::"];
		}
		case "Section": {
			// A section's children start a line, so they may be groups. Everything else is plain text.
			const groups: Array<ReadonlyArray<string>> = [
				...(block.title === undefined ? [] : [plainLines([Doc.heading(1, block.title)], ctx)]),
				...block.children.map((child) => blockLines(child, ctx)),
			];
			return groups.flatMap((group, index) => (index === 0 ? group : ["", ...group]));
		}
		default:
			return plainLines([block], ctx);
	}
};

/**
 * Render a document for a GitHub Actions log: plain text, with a top-level collapsible as a group.
 *
 * @internal
 */
export const renderGithubLog = (doc: Document, ctx: RenderContext): string =>
	doc.flatMap((block) => blockLines(block, ctx)).join("\n");
