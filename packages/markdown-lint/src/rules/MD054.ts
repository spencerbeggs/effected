// MD054 `link-image-style`: a port of markdownlint's lib/md054.mjs over the
// kit tree. markdownlint reads each autolink, link and image token (links and
// images in image labels included) as written (see `Medium`): an autolink's
// destination, an inline one's destination and title strings, a reference's
// destination from the definitions (a destination in angle brackets reads as
// none there). A style its setting disallows is reported with the token's
// first line as context; on one line, its range is the token and its fix the
// inline form (the label's brackets and the destination's parentheses
// escaped) or, when that is not allowed or a bare URL would do, an autolink.

import type * as Lint from "@effected/markdown-lint";
import { errorContext } from "../internal/lines.js";
import type { Medium } from "../internal/references.js";
import { normalizeLabel, referenceData } from "../internal/references.js";
import { flagSettingOn } from "../internal/settings.js";
import { LintRule } from "../LintRule.js";

// markdownlint's `removeBackslashEscapes`.
const removeBackslashEscapes = (text: string): string =>
	text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1");

// markdownlint's `autolinkAble`: an absolute URL with no space or angle bracket.
const autolinkAble = (destination: string): boolean => {
	try {
		new URL(destination);
	} catch {
		return false;
	}
	return !/[ <>]/.test(destination);
};

/**
 * MD054 `link-image-style`: links and images use the styles allowed.
 *
 * @remarks
 * Settings, each allowing a style (default `true`): `autolink`, `inline`,
 * `full`, `collapsed`, `shortcut`, and `url_inline` (an inline link whose
 * text is its URL). The fix rewrites a disallowed one on one line to an
 * inline link or image, or to an autolink.
 *
 * @public
 */
export const MD054: Lint.LintRule = LintRule.make({
	names: ["MD054", "link-image-style"],
	description: "Link and image style",
	tags: ["images", "links"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md054.md",
	check: (context, report) => {
		const { config, source } = context;
		const autolink = flagSettingOn(config, "autolink");
		const inline = flagSettingOn(config, "inline");
		const full = flagSettingOn(config, "full");
		const collapsed = flagSettingOn(config, "collapsed");
		const shortcut = flagSettingOn(config, "shortcut");
		const urlInline = flagSettingOn(config, "url_inline");
		if (autolink && inline && full && collapsed && shortcut && urlInline) return;
		const { definitions, media } = referenceData(context);
		const disallowed = (medium: Medium): string | undefined => {
			const { destination, image, kind, label } = medium;
			if (kind === "autolink") return !autolink && destination ? destination : undefined;
			if (kind === "inline" && destination !== undefined) {
				const error =
					!inline ||
					(!urlInline &&
						autolink &&
						!image &&
						medium.title === undefined &&
						label === destination &&
						autolinkAble(destination));
				return error ? destination : undefined;
			}
			const found = definitions.get(normalizeLabel(medium.reference || label))?.destination ?? "";
			const allowed = kind === "shortcut" ? shortcut : kind === "collapsed" ? collapsed : full;
			return found !== "" && !allowed ? found : undefined;
		};
		for (const medium of media) {
			const destination = disallowed(medium);
			if (destination === undefined) continue;
			const text = source.slice(medium.start, medium.end);
			const oneLine = context.mapping.lineNumber(medium.start) === context.mapping.lineNumber(medium.end);
			let insertText: string | undefined;
			if (oneLine) {
				const canInline = inline && medium.label !== "";
				const canAutolink = autolink && !medium.image && autolinkAble(destination);
				if (canInline && (urlInline || !canAutolink)) {
					const label = medium.label.replace(/[[\]]/g, "\\$&");
					insertText = `${medium.image ? "!" : ""}[${label}](${destination.replace(/[()]/g, "\\$&")})`;
				} else if (canAutolink) {
					insertText = `<${removeBackslashEscapes(destination)}>`;
				}
			}
			report(
				context.diagnostic({
					at: { offset: medium.start, length: 0 },
					context: errorContext(text.replace(/[\r\n][\s\S]*$/, "")),
					...(oneLine ? { range: { offset: medium.start, length: medium.end - medium.start } } : {}),
					...(insertText === undefined
						? {}
						: { fix: { offset: medium.start, length: medium.end - medium.start, content: insertText } }),
				}),
			);
		}
	},
});
