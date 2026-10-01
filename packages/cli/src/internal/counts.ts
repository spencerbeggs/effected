import type { BlockOf, Counter } from "../Doc.js";

/**
 * The total of a `Counts` block: the caller's rule when it has one, otherwise the sum of `n` over every counter.
 *
 * @remarks
 * Lives here, not on `Doc`, so a renderer needs nothing from `Doc` at runtime: `Doc.print` imports the renderers, and
 * a renderer importing `Doc` back would make a cycle. `Doc.total` is this function.
 *
 * @internal
 */
export const totalOf = (block: BlockOf<"Counts">): number =>
	block.total === undefined ? block.counters.reduce((sum, counter) => sum + counter.n, 0) : block.total(block.counters);

/**
 * The counters a renderer shows: every one except a zero counter that does not ask for `showZero`. `Doc.visibleCounters`
 * is this function.
 *
 * @internal
 */
export const visibleCountersOf = (block: BlockOf<"Counts">): ReadonlyArray<Counter> =>
	block.counters.filter((counter) => counter.n !== 0 || counter.showZero === true);
