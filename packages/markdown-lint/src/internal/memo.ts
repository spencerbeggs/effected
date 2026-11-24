// Document facts computed once per lint. Every rule's context over one
// reading shares that reading's `mapping`, which each reading creates once,
// so a fact keyed on it is computed by the first rule that asks and read by
// the rest, and freed with the reading. A memoized fact is shared between
// rules: type it read-only, and copy before adding to it. The host also
// records here what a reading knows that no public context field carries.

import type { LintContext } from "../LintContext.js";
import type { PositionMapping } from "../PositionMapping.js";

/**
 * `compute`, run once per reading: later calls with any context over the
 * same reading return the first result.
 * @internal
 */
export const perReading = <A>(compute: (context: LintContext) => A): ((context: LintContext) => A) => {
	const cache = new WeakMap<PositionMapping, A>();
	return (context) => {
		if (cache.has(context.mapping)) return cache.get(context.mapping) as A;
		const value = compute(context);
		cache.set(context.mapping, value);
		return value;
	};
};

const unmaskedSources = new WeakMap<PositionMapping, string>();

/**
 * Record a reading's text before HTML comment masking, under its mapping.
 * The host calls it when it builds a rule's context. @internal
 */
export const registerUnmaskedSource = (mapping: PositionMapping, text: string): void => {
	unmaskedSources.set(mapping, text);
};

/**
 * `context.source` before HTML comment masking: the same text and offsets,
 * comment bodies as written, for a reader that must see a comment's own
 * characters, as markdownlint's parse does before it masks. Under
 * markdownlint the adapter is handed only the masked lines, so there it is
 * `source`. @internal
 */
export const unmaskedSource = (context: LintContext): string => unmaskedSources.get(context.mapping) ?? context.source;
