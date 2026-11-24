// Document facts computed once per lint. Every rule's context over one
// reading shares that reading's `mapping`, which each reading creates once,
// so a fact keyed on it is computed by the first rule that asks and read by
// the rest, and freed with the reading. A memoized fact is shared between
// rules: type it read-only, and copy before adding to it.

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
