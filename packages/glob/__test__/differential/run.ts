// Differential runner: @effected/glob's engine against the installed minimatch.
//
//   pnpm --filter @effected/glob differential -- --seed 1 --count 5000
//
// Generates posix and win32 (pattern, path, options) triples from a weighted
// alphabet, runs each in a worker process under a per-triple watchdog (the
// vendored backtracking regexp stalls one process on nested quantified
// extglobs), compares match, hasMagic and throw/typed-failure with the oracle,
// and writes a divergence table. It is not a vitest test: no `.test.ts` name,
// so the default project never collects it, and CI never runs it.

import type { ChildProcess } from "node:child_process";
import { fork } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Alphabet } from "./generate.js";
import { DEFAULT_ALPHABET, generate } from "./generate.js";
import type { Outcome, Result, ToParent, ToWorker } from "./worker.js";

const here = dirname(fileURLToPath(import.meta.url));

// pnpm forwards a literal `--` ahead of the flags; drop one leading occurrence
const argv = process.argv.slice(2);
if (argv[0] === "--") argv.shift();

const { values: flags } = parseArgs({
	args: argv,
	options: {
		seed: { type: "string", default: "1" },
		count: { type: "string", default: "2000" },
		platform: { type: "string", default: "both" },
		workers: { type: "string", default: "4" },
		timeout: { type: "string", default: "2000" },
		weights: { type: "string", default: "" },
		alphabet: { type: "string", default: "" },
		"min-tokens": { type: "string", default: "1" },
		"max-tokens": { type: "string", default: "5" },
		out: { type: "string", default: "" },
		"max-rows": { type: "string", default: "60" },
		help: { type: "boolean", default: false },
	},
	allowPositionals: false,
});

if (flags.help) {
	process.stdout.write(`flags: --seed N --count N --platform posix|win32|both --workers N --timeout MS
       --weights class=N,class=N (0 turns a class off) --alphabet file.json ({class:{tokens,weight}})
       --min-tokens N --max-tokens N --out file.md --max-rows N
classes: ${Object.keys(DEFAULT_ALPHABET).join(", ")}\n`);
	process.exit(0);
}

const seed = Number(flags.seed);
const count = Number(flags.count);
const timeoutMs = Number(flags.timeout);
const workerCount = Math.max(1, Number(flags.workers));
const platforms = flags.platform === "both" ? (["posix", "win32"] as const) : ([flags.platform] as ["posix" | "win32"]);
if (![seed, count, timeoutMs].every(Number.isFinite) || platforms.some((p) => p !== "posix" && p !== "win32")) {
	process.stderr.write("invalid --seed/--count/--timeout/--platform\n");
	process.exit(2);
}

let alphabet: Alphabet = flags.alphabet
	? (JSON.parse(readFileSync(resolve(flags.alphabet), "utf8")) as Alphabet)
	: DEFAULT_ALPHABET;
for (const pair of flags.weights ? flags.weights.split(",") : []) {
	const [name, w] = pair.split("=");
	const cls = name === undefined ? undefined : alphabet[name];
	if (!cls || w === undefined || !Number.isFinite(Number(w))) {
		process.stderr.write(`bad --weights entry: ${pair}\n`);
		process.exit(2);
	}
	alphabet = { ...alphabet, [name as string]: { ...cls, weight: Number(w) } };
}

const cfg = {
	seed,
	alphabet,
	platforms,
	minTokens: Number(flags["min-tokens"]),
	maxTokens: Number(flags["max-tokens"]),
};

// ── the watchdog pool ──────────────────────────────────────────────────────

interface Slot {
	child: ChildProcess;
	current: number | undefined;
	side: "oracle" | "engine";
	timer: NodeJS.Timeout | undefined;
}

const results: Array<Result> = [];
const timeouts: Array<{ index: number; side: string }> = [];
let next = 0;
let finished = 0;

const spawnWorker = (): ChildProcess =>
	fork(resolve(here, "worker.ts"), [], {
		// the session's own NODE_OPTIONS may carry a tsx import; the worker loads its own
		env: { ...process.env, NODE_OPTIONS: "" },
		execArgv: ["--import", "tsx", "--stack-size=1800"],
	});

const done = new Promise<void>((resolveAll) => {
	const dispatch = (slot: Slot): void => {
		if (next >= count) {
			slot.child.kill();
			if (finished >= count) resolveAll();
			return;
		}
		const index = next++;
		slot.current = index;
		slot.side = "oracle";
		const msg: ToWorker = { index, triple: generate(cfg, index) };
		slot.timer = setTimeout(() => {
			// the watchdog: a stalled worker cannot be asked to stop, only killed
			timeouts.push({ index, side: slot.side });
			finished++;
			slot.child.removeAllListeners();
			slot.child.kill("SIGKILL");
			slot.child = attach(slot);
			dispatch(slot);
		}, timeoutMs);
		slot.child.send(msg);
	};
	const attach = (slot: Slot): ChildProcess => {
		const child = spawnWorker();
		child.on("message", (m: ToParent) => {
			if (m.t === "phase") {
				slot.side = m.side;
				return;
			}
			clearTimeout(slot.timer);
			results.push(m.result);
			finished++;
			dispatch(slot);
		});
		child.on("exit", (code, sig) => {
			if (slot.current !== undefined && slot.timer && sig !== "SIGKILL" && code !== 0 && code !== null) {
				// a crash is a result too: record it and move on
				clearTimeout(slot.timer);
				timeouts.push({ index: slot.current, side: `crash(${code})` });
				finished++;
				slot.child = attach(slot);
				dispatch(slot);
			}
		});
		return child;
	};
	for (let i = 0; i < Math.min(workerCount, count); i++) {
		const slot: Slot = {
			child: undefined as unknown as ChildProcess,
			current: undefined,
			side: "oracle",
			timer: undefined,
		};
		slot.child = attach(slot);
		dispatch(slot);
	}
	if (count === 0) resolveAll();
});

const started = Date.now();
await done;
const elapsed = Date.now() - started;

// ── classification ─────────────────────────────────────────────────────────

const show = (o: Outcome): string =>
	o.kind === "ok"
		? `match=${o.match} magic=${o.hasMagic}`
		: o.kind === "typed"
			? `typed:${o.reason}`
			: `throw:${o.message.slice(0, 60)}`;

interface Row {
	readonly kind: string;
	readonly index: number;
	readonly pattern: string;
	readonly path: string;
	readonly options: string;
	readonly oracle: string;
	readonly engine: string;
	readonly exceptions: string;
}

const classify = (r: Result): string | undefined => {
	const { oracle: o, engine: e } = r;
	if (o.kind === "throw" && e.kind === "ok") return "oracle-throws-engine-accepts";
	if (e.kind === "throw") return "engine-defect";
	if (e.kind === "typed" && o.kind === "ok")
		return e.reason === "InvalidRegExp" ? "InvalidRegExp-on-accepted" : "typed-failure-on-accepted";
	if (o.kind === "ok" && e.kind === "ok") {
		if (o.match !== e.match) return "match";
		if (o.hasMagic !== e.hasMagic) return "hasMagic";
	}
	return undefined;
};

const rows: Array<Row> = [];
const excepted = new Map<string, number>();
let agreed = 0;
for (const r of results.sort((a, b) => a.index - b.index)) {
	const kind = classify(r);
	if (kind === undefined) {
		agreed++;
		continue;
	}
	const t = generate(cfg, r.index);
	// InvalidRegExp-on-accepted is its own report (#1279), never an exception
	if (r.exceptions.length > 0 && kind !== "InvalidRegExp-on-accepted") {
		for (const name of r.exceptions) excepted.set(`${name} / ${kind}`, (excepted.get(`${name} / ${kind}`) ?? 0) + 1);
		continue;
	}
	rows.push({
		kind,
		index: r.index,
		pattern: t.pattern,
		path: t.path,
		options: JSON.stringify(t.options),
		oracle: show(r.oracle),
		engine: show(r.engine),
		exceptions: r.exceptions.join(","),
	});
}

const cell = (s: string): string => {
	const short = s.length > 120 ? `${s.slice(0, 120)}… (${s.length} chars)` : s;
	// Escape backslashes before pipes, so a win32 path's `\|` cannot become `\\|`, which GFM reads as an escaped
	// backslash followed by a live cell separator.
	return `\`${short.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/`/g, "'")}\``;
};
const byKind = new Map<string, Array<Row>>();
for (const row of rows) byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), row]);
const maxRows = Number(flags["max-rows"]);

const out: Array<string> = [
	"# glob differential run",
	"",
	`seed ${seed}, ${count} triples (${platforms.join("+")}), ${workerCount} workers, ${timeoutMs} ms watchdog, ${elapsed} ms`,
	`rerun: pnpm --filter @effected/glob differential -- --seed ${seed} --count ${count} --platform ${flags.platform}${flags.weights ? ` --weights ${flags.weights}` : ""}`,
	"",
	"## Summary",
	"",
	"| bucket | count |",
	"| --- | --- |",
	`| agreed | ${agreed} |`,
	`| excepted (named) | ${[...excepted.values()].reduce((n, c) => n + c, 0)} |`,
	`| watchdog kills / crashes | ${timeouts.length} |`,
	...[...byKind].map(([k, v]) => `| ${k} | ${v.length} |`),
	"",
];
if (excepted.size > 0) {
	out.push("## Excepted", "", "| exception / divergence | count |", "| --- | --- |");
	for (const [k, n] of excepted) out.push(`| ${k} | ${n} |`);
	out.push("");
}
if (timeouts.length > 0) {
	out.push("## Watchdog kills", "", "| index | side | pattern | path | options |", "| --- | --- | --- | --- | --- |");
	for (const t of timeouts.sort((a, b) => a.index - b.index).slice(0, maxRows)) {
		const tr = generate(cfg, t.index);
		out.push(
			`| ${t.index} | ${t.side} | ${cell(tr.pattern)} | ${cell(tr.path)} | ${cell(JSON.stringify(tr.options))} |`,
		);
	}
	out.push("");
}
for (const [kind, list] of byKind) {
	out.push(
		`## ${kind} (${list.length})`,
		"",
		"| index | pattern | path | options | oracle | engine |",
		"| --- | --- | --- | --- | --- | --- |",
	);
	for (const row of list.slice(0, maxRows)) {
		out.push(
			`| ${row.index} | ${cell(row.pattern)} | ${cell(row.path)} | ${cell(row.options)} | ${cell(row.oracle)} | ${cell(row.engine)} |`,
		);
	}
	if (list.length > maxRows) out.push("", `... ${list.length - maxRows} more`);
	out.push("");
}

const outFile = resolve(flags.out || resolve(here, "../../.cache/differential", `seed-${seed}.md`));
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${out.join("\n")}\n`);

process.stdout.write(`${out.slice(0, 20 + excepted.size).join("\n")}\n\ntable: ${outFile}\n`);
process.exit(rows.length > 0 || timeouts.length > 0 ? 1 : 0);
