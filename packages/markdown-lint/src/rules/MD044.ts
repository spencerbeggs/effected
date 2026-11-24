// MD044 `proper-names`: a port of markdownlint's lib/md044.mjs over the kit
// tree. markdownlint matches each name over the text of its `data` tokens
// (and, by setting, `codeFlowValue`/`codeTextData` and
// `htmlFlowData`/`htmlTextData`), leaving out link destinations, references,
// definitions and fence info. A token's edges are word boundaries to its
// pattern, so the kit reads the same token texts (see `textTokens`).

import type { MarkdownNode } from "@effected/markdown";
import { MarkdownDocument as Document, MarkdownParseOptions } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { Result } from "effect";
import type { DataSegment } from "../internal/inline.js";
import { textTokens } from "../internal/inline.js";
import { unmaskedSource } from "../internal/memo.js";
import { flagSettingOn } from "../internal/settings.js";
import { LintRule } from "../LintRule.js";

const autolinkOptions = MarkdownParseOptions.make({ dialect: "gfm", frontmatter: false });

// markdownlint's `escapeForRegExp`.
const escapeForRegExp = (text: string): string => text.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

/**
 * MD044 `proper-names`: proper names are written with their capitalization.
 *
 * @remarks
 * markdownlint's settings: `names` (default none), the names as they should
 * be written, matched case-insensitively as whole words; `code_blocks`
 * (default `true`), whether code blocks and code spans are checked; and
 * `html_elements` (default `true`), whether HTML is. A longer name is matched
 * first, and a shorter one inside its match is not reported. Where markdownlint
 * throws or hangs, the kit stays total: a name that is no string reads as no
 * names, and an empty name is passed over. The fix writes the name.
 *
 * @public
 */
export const MD044: Lint.LintRule = LintRule.make({
	names: ["MD044", "proper-names"],
	description: "Proper names should have the correct capitalization",
	tags: ["spelling"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md044.md",
	check: (context, report) => {
		const setting = context.config.names;
		const names = Array.isArray(setting) ? [...(setting as ReadonlyArray<unknown>)] : [];
		// markdownlint calls string methods on every name and throws on any other value.
		if (names.length === 0 || !names.every((name): name is string => typeof name === "string")) return;
		// Sorted as markdownlint sorts them, on a copy: markdownlint sorts the caller's array in place, the kit does not.
		names.sort((a, b) => b.length - a.length || a.localeCompare(b));
		const scan = {
			code: flagSettingOn(context.config, "code_blocks"),
			html: flagSettingOn(context.config, "html_elements"),
		};
		// markdownlint matches over its tokens' text, HTML comments as written: the kit's reading masks their bodies.
		const source = unmaskedSource(context);
		const segments = textTokens(context, scan);
		// markdownlint's exclusions, by the characters they cover: a match overlapping one is not reported.
		const excluded = new Uint8Array(source.length + 1);
		const covers = (start: number, end: number): boolean => {
			for (let at = start; at < end; at++) if (excluded[at] === 1) return true;
			return false;
		};
		const exclude = (start: number, end: number) => excluded.fill(1, start, end);
		const scanned = new Set<DataSegment>();
		const lineEnd = (offset: number) => {
			const line = context.mapping.lineNumber(offset);
			return context.mapping.lineStart(line) + (context.lines[line - 1] ?? "").length;
		};
		for (const name of names) {
			// An empty name matches nothing at every word boundary, where markdownlint loops forever.
			if (name.length === 0) continue;
			const startPattern = /^\W/.test(name) ? "" : "\\b_*";
			const endPattern = /\W$/.test(name) ? "" : "_*\\b";
			const pattern = new RegExp(`(${startPattern})(${escapeForRegExp(name)})${endPattern}`, "gi");
			for (const segment of segments) {
				const text = source.slice(segment.start, segment.end);
				pattern.lastIndex = 0;
				for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
					const [, left = "", nameMatch = ""] = match;
					const start = segment.start + match.index + left.length;
					const end = start + nameMatch.length;
					if (!names.includes(nameMatch) && !covers(start, end)) {
						let autolinks: ReadonlyArray<DataSegment> = [];
						if (!scanned.has(segment)) {
							autolinks = literalAutolinks(text).map((link) => ({
								start: segment.start + link.start,
								// markdownlint's range for it ends `token.endColumn + tok.endColumn - 1`, past the token.
								end: Math.min(lineEnd(segment.start), segment.end + link.end + 1),
							}));
							for (const link of autolinks) exclude(link.start, link.end);
							scanned.add(segment);
						}
						if (!autolinks.some((link) => link.start < end && start < link.end) && name !== nameMatch) {
							report(
								context.diagnostic({
									at: { offset: start, length: 0 },
									detail: `Expected: ${name}; Actual: ${nameMatch}`,
									range: { offset: start, length: nameMatch.length },
									fix: { offset: start, length: nameMatch.length, content: name },
								}),
							);
						}
					}
					exclude(start, end);
				}
			}
		}
	},
});

// The GFM literal autolinks markdownlint's re-parse of a token's text finds, in the text's offsets.
const literalAutolinks = (text: string): ReadonlyArray<DataSegment> => {
	// A GFM literal autolink starts `www.`, a scheme or holds an `@`: a text with none of them has none, unparsed.
	if (!/www\.|https?:|ftp:|mailto:|xmpp:|@/i.test(text)) return [];
	const parsed = Document.parseResult(text, autolinkOptions);
	if (!Result.isSuccess(parsed)) return [];
	return (parsed.success.findAll("link") as ReadonlyArray<MarkdownNode>)
		.filter((link) => !"[<".includes(text.charAt(link.position.start.offset)))
		.map((link) => ({ start: link.position.start.offset, end: link.position.end.offset }));
};
