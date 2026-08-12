// line-length (#129): lines must not exceed the configured maximum. No fix —
// a line can only be shortened by reflowing content, and reflowing is
// formatting, not fixing.

import { Schema } from "effect";
import type { YamlRule } from "../../YamlLintRule.js";
import { YamlLintDiagnostic, YamlLintSeverity } from "../../YamlLintRule.js";
import { nonNegativeIntegerOption } from "./util.js";

/**
 * Options for `line-length`. `max` defaults to 120 — the kit-native line
 * width (the yamllint id is recognizable; the option surface and defaults
 * are ours).
 */
export const lineLengthOptions = Schema.Struct({
	severity: Schema.optionalKey(YamlLintSeverity),
	max: Schema.optionalKey(nonNegativeIntegerOption),
});

const DEFAULT_MAX = 120;

/** Lines longer than the configured maximum. */
export const lineLength: YamlRule = {
	id: "line-length",
	check: (ctx, options) => {
		const max = (options as { readonly max?: number } | undefined)?.max ?? DEFAULT_MAX;
		const out: Array<YamlLintDiagnostic> = [];
		for (const line of ctx.lines) {
			if (line.text.length > max) {
				out.push(
					new YamlLintDiagnostic({
						rule: "line-length",
						severity: "error",
						message: `Line is longer than ${max} characters (${line.text.length})`,
						offset: line.offset + max,
						length: line.text.length - max,
						line: line.number,
						character: max,
					}),
				);
			}
		}
		return out;
	},
};
