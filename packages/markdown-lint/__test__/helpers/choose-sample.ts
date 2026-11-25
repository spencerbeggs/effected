// Chooses the corpus sample: the fixtures a pull request run compares on. Run it through the package script,
//
//   pnpm --filter @effected/markdown-lint run corpus:sample            (print the choice)
//   pnpm --filter @effected/markdown-lint run corpus:sample --write    (rewrite corpus-sample.ts)
//
// It reads the fixtures directly, never through the sample it is about to replace, so a stale sample cannot stop it.
//
// Two passes, both deterministic:
//
// 1. Rule cover. The smallest set of fixtures (greedy, ties by name) in which every rule markdownlint reports
//    anywhere in the corpus reports somewhere.
// 2. Source cover. A rule reporting once does not reach the branches the rest of the corpus reaches, and the
//    repository's coverage thresholds are global, so a drop in this one package would pass unnoticed. Each fixture is
//    linted with every kit rule under V8's precise coverage, and fixtures are added (most new source first, ties by
//    name) until the sample executes at least `--source-cover` percent (97 by default) of the source the whole
//    corpus executes.

import { writeFileSync } from "node:fs";
import { Session } from "node:inspector/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import { rules } from "../../src/rules/all.js";
import { fullCorpus } from "./corpus-files.js";
import { chooseCover, ruleCovers, uncovered } from "./sample-cover.js";

const argv = process.argv.slice(2);
// pnpm forwards a literal `--` ahead of the flags; drop one leading occurrence.
if (argv[0] === "--") argv.shift();
const { values: flags } = parseArgs({
	args: argv,
	options: {
		write: { type: "boolean", default: false },
		"source-cover": { type: "string", default: "97" },
	},
});
const sourceCover = Number(flags["source-cover"]);
if (!(sourceCover > 0 && sourceCover <= 100)) {
	throw new Error(`--source-cover must be a percentage over 0 and at most 100, got ${flags["source-cover"]}`);
}

/** The scripts whose execution counts: this package's own source. */
const SOURCE = "/packages/markdown-lint/src/";

interface Range {
	readonly startOffset: number;
	readonly endOffset: number;
	readonly count: number;
}

interface ScriptCoverage {
	readonly url: string;
	readonly functions: ReadonlyArray<{ readonly ranges: ReadonlyArray<Range> }>;
}

/** One fixture's coverage: per source script, its ranges with parents ahead of the ranges they contain. */
type Report = ReadonlyMap<string, ReadonlyArray<Range>>;

const session = new Session();
session.connect();
await session.post("Profiler.enable");
// Counted, not binary: V8's binary mode reports a function once and then not again, which would credit only the
// first fixture to reach it.
await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });

const take = async (): Promise<Report> => {
	const { result } = (await session.post("Profiler.takePreciseCoverage")) as {
		readonly result: ReadonlyArray<ScriptCoverage>;
	};
	const report = new Map<string, ReadonlyArray<Range>>();
	for (const script of result) {
		if (!script.url.includes(SOURCE)) continue;
		const ranges = script.functions.flatMap((each) => [...each.ranges]);
		// A contained range starts no earlier and ends no later than its parent, so this order puts every parent first.
		ranges.sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
		report.set(script.url, ranges);
	}
	return report;
};

const lintBoth = (source: string): void => {
	for (const text of [source, source.replace(/\r?\n/g, "\r\n")]) {
		try {
			MarkdownLint.lint(text, rules, { config: { default: true } });
		} catch {
			// A fixture the kit cannot lint covers what it reached before failing; the differential tests own the failure.
		}
	}
};

// Pass 1.
const ruleCover = ruleCovers(fullCorpus);
const byRule = chooseCover(ruleCover);

// Pass 2. One discarded lint first, so module evaluation and first-call work are not credited to a fixture.
lintBoth(fullCorpus[0]?.source ?? "");
await take();
const reports = new Map<string, Report>();
for (const entry of fullCorpus) {
	lintBoth(entry.source);
	reports.set(entry.name, await take());
}
await session.post("Profiler.stopPreciseCoverage");
session.disconnect();

// Every offset any report mentions, per script: between two neighbours no report changes its mind, so the gaps are
// the atoms coverage is counted in.
const boundaries = new Map<string, Array<number>>();
for (const report of reports.values()) {
	for (const [url, ranges] of report) {
		const seen = boundaries.get(url) ?? [];
		for (const range of ranges) seen.push(range.startOffset, range.endOffset);
		boundaries.set(url, seen);
	}
}
for (const [url, offsets] of boundaries)
	boundaries.set(
		url,
		[...new Set(offsets)].sort((a, b) => a - b),
	);

const indexOf = (offsets: ReadonlyArray<number>, offset: number): number => {
	let low = 0;
	let high = offsets.length - 1;
	while (low < high) {
		const middle = (low + high) >> 1;
		if ((offsets[middle] as number) < offset) low = middle + 1;
		else high = middle;
	}
	return low;
};

/** The atoms a report executes, as `url#index` keys with their length in characters. */
const weights = new Map<string, number>();
const executed = (report: Report): ReadonlySet<string> => {
	const keys = new Set<string>();
	for (const [url, ranges] of report) {
		const offsets = boundaries.get(url) ?? [];
		const painted = new Uint8Array(Math.max(offsets.length - 1, 0));
		// Parents first, so a contained range overwrites the part of its parent it speaks for.
		for (const range of ranges) {
			painted.fill(range.count > 0 ? 1 : 0, indexOf(offsets, range.startOffset), indexOf(offsets, range.endOffset));
		}
		for (let index = 0; index < painted.length; index += 1) {
			if (painted[index] !== 1) continue;
			const key = `${url}#${index}`;
			keys.add(key);
			weights.set(key, (offsets[index + 1] as number) - (offsets[index] as number));
		}
	}
	return keys;
};

const atoms = new Map<string, ReadonlySet<string>>();
for (const [name, report] of reports) atoms.set(name, executed(report));

const weigh = (keys: Iterable<string>): number => {
	let total = 0;
	for (const key of keys) total += weights.get(key) ?? 0;
	return total;
};

const corpusAtoms = new Set<string>();
for (const keys of atoms.values()) for (const key of keys) corpusAtoms.add(key);
const corpusWeight = weigh(corpusAtoms);

const chosen = new Set(byRule);
const covered = new Set<string>();
for (const name of chosen) for (const key of atoms.get(name) ?? []) covered.add(key);
let coveredWeight = weigh(covered);
const names = [...atoms.keys()].sort();
while (coveredWeight * 100 < corpusWeight * sourceCover) {
	let best: string | undefined;
	let gain = 0;
	for (const name of names) {
		if (chosen.has(name)) continue;
		let adds = 0;
		for (const key of atoms.get(name) ?? []) if (!covered.has(key)) adds += weights.get(key) ?? 0;
		if (adds > gain) {
			best = name;
			gain = adds;
		}
	}
	if (best === undefined) break;
	chosen.add(best);
	for (const key of atoms.get(best) ?? []) covered.add(key);
	coveredWeight += gain;
}

const sample = [...chosen].sort();
const rulesReported = new Set<string>();
for (const found of ruleCover.values()) for (const name of found) rulesReported.add(name);

console.log(
	`corpus: ${fullCorpus.length} fixtures, ${rulesReported.size} rules reported, ${corpusWeight} source characters executed`,
);
console.log(`rule cover: ${byRule.length} fixtures`);
console.log(
	`sample: ${sample.length} fixtures, rules left uncovered: ${JSON.stringify(uncovered(ruleCover, sample))}, ` +
		`source cover ${((coveredWeight / corpusWeight) * 100).toFixed(2)}% (asked ${sourceCover}%)`,
);

const file = `// Generated by \`pnpm --filter @effected/markdown-lint run corpus:sample --write\`. Do not edit by hand:
// rerun the script, which chooses the list (see choose-sample.ts for how).
//
// The fixtures of the upstream markdownlint corpus that a pull request run compares on. The full corpus runs at
// full depth (EFFECTED_TEST_DEPTH=full): for a release, and on demand.
export const CORPUS_SAMPLE: ReadonlyArray<string> = [
${sample.map((name) => `\t${JSON.stringify(name)},`).join("\n")}
];
`;

if (flags.write) {
	writeFileSync(join(import.meta.dirname, "corpus-sample.ts"), file);
	console.log("wrote corpus-sample.ts");
} else {
	console.log(sample.join("\n"));
}
