// Choosing the corpus sample: which upstream fixtures a pull request run compares on. The full corpus is 438
// fixtures in two line endings, in two engines, per rule and per settings case; the sample is a fixed list small
// enough to run on every pull request, chosen so every rule markdownlint reports anywhere in the corpus still
// reports somewhere in the sample.

import { oracleLint } from "./markdownlint-oracle.js";

/**
 * A greedy set cover: repeatedly the entry covering the most keys not yet covered per unit of its cost, a tie going
 * to the name that sorts first, until no entry adds one. Without `costs` every entry costs the same. The result is
 * sorted by name, so it is the same list whatever the map's order.
 *
 * @throws When a cost is not a positive number.
 */
export const chooseCover = (
	covers: ReadonlyMap<string, ReadonlySet<string>>,
	costs?: ReadonlyMap<string, number>,
): ReadonlyArray<string> => {
	for (const [name, cost] of costs ?? []) {
		if (!(cost > 0)) throw new Error(`chooseCover: the cost of ${name} must be a positive number, got ${cost}`);
	}
	const names = [...covers.keys()].sort();
	const covered = new Set<string>();
	const chosen: Array<string> = [];
	for (;;) {
		let best: string | undefined;
		let rate = 0;
		for (const name of names) {
			let adds = 0;
			for (const key of covers.get(name) ?? []) if (!covered.has(key)) adds += 1;
			const worth = adds / (costs?.get(name) ?? 1);
			if (worth > rate) {
				best = name;
				rate = worth;
			}
		}
		if (best === undefined) return chosen.sort();
		chosen.push(best);
		for (const key of covers.get(best) ?? []) covered.add(key);
	}
};

/** The keys some entry of `covers` has and no entry named in `chosen` does, sorted. */
export const uncovered = (
	covers: ReadonlyMap<string, ReadonlySet<string>>,
	chosen: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	const covered = new Set<string>();
	for (const name of chosen) for (const key of covers.get(name) ?? []) covered.add(key);
	const missing = new Set<string>();
	for (const keys of covers.values()) for (const key of keys) if (!covered.has(key)) missing.add(key);
	return [...missing].sort();
};

/**
 * Each entry's name to the rules markdownlint reports for it, as written and converted to CRLF, with every
 * built-in rule on (a fixture's own inline comments still apply). Rule names are sorted.
 */
export const ruleCovers = (
	entries: ReadonlyArray<{ readonly name: string; readonly source: string }>,
): ReadonlyMap<string, ReadonlySet<string>> => {
	const covers = new Map<string, ReadonlySet<string>>();
	for (const entry of entries) {
		const found = new Set<string>();
		for (const source of [entry.source, entry.source.replace(/\r?\n/g, "\r\n")]) {
			let findings: ReturnType<typeof oracleLint>;
			try {
				findings = oracleLint(source, { default: true }, { micromark: true });
			} catch {
				// markdownlint itself throws on a few fixtures (an upstream bug); they cover nothing.
				continue;
			}
			for (const finding of findings) {
				const [name] = finding.ruleNames;
				if (name !== undefined) found.add(name);
			}
		}
		covers.set(entry.name, new Set([...found].sort()));
	}
	return covers;
};
