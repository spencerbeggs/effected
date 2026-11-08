// Ported from @isaacs/nonrecursive-glob-match@1.1.0 (https://github.com/isaacs/nonrecursive-glob-match)
// Copyright: Isaac Z. Schlueter and Contributors
// License: BlueOak-1.0.0 (https://blueoakcouncil.org/license/1.0.0)
// Port notes: src/index.ts, the one-portion matcher minimatch 11.0.5 runs. The
// kit answers every extglob portion, and every `.`, `..` or dotfile path
// portion, with it, so those answers are 11's own. Changes from upstream:
// 1. No `normalize` option (the kit has none), and no `show`/`toString` debug
//    listing. `rangeMark` is ported, with numeric-range.ts as numericRange.ts
//    (its digit classes built through `compile`). Three more
//    changes, none behavioural: only `testUnchecked` is ported (upstream's
//    `test` adds a `/` check and a surrogate pre-scan; every caller passes
//    one portion, as 11.0.5's own `portionMatch` does); `itemLengths` loops
//    where upstream spreads `Math.min(...alts)`, which would throw a
//    `RangeError` on a very wide alternation; and the fold regexps are cached
//    per matcher, not in upstream's global 1,000-entry cache.
// 2. Every regexp is built at construction through the caller's `compile`
//    (compileOrFail: a typed InvalidRegExp, its first exec forced), the
//    nocase literal fold included, which upstream built on first use. So
//    matching builds no regexp and can not throw.
// 3. Sim#add walks a state's threads with an explicit stack instead of
//    recursing on each node's `next`, so a long chain of nullable or starred
//    items (`*(a)` sixteen thousand times) can not exhaust the call stack.
//    A state's threads are a set (their order is sorted away in `done`), so
//    the walk's order does not matter.
// 4. build counts its descent and throws GuardExceeded("NestingDepthExceeded")
//    past MAX_NESTING_DEPTH, which bounds every other recursion on nesting
//    (compile, lengths, the negation runs of Sim#step, stateKey, sameState).
// 5. Consecutive `*` items in a sequence are one: a run of `*` matches what
//    one does, and a `*` restricted at an index ends the path whichever of the
//    run it is. It keeps the graph from holding one node per star. It is a
//    speed change only (a few ms on thirty thousand stars), so no test can
//    tell it from upstream by its answers.
// 6. Every graph item is charged to the caller's compile budget (`charge`)
//    before the graph is built: a numeric range's items as numericRange
//    makes them, every other token as one. Brace alternatives around a kept
//    range make distinct portions, each with its own copy of the range's
//    graph (`{$,a}{-9007199254740991..9007199254740991}` twelve times, 504
//    characters, built 4,096 graphs of 8,200 items: 16.7 s and 4.2 GB).
//    Upstream has no such bound; minimatch 11 refuses those patterns as too
//    long.

import { GuardExceeded, MAX_NESTING_DEPTH } from "./limits.js";
import { parseMatcherClass } from "./matcherClass.js";
import { numericRange } from "./numericRange.js";

/** Options of one portion matcher. */
export interface MatcherOptions {
	/** perform a case-insensitive match */
	readonly nocase?: boolean;
	/** do not treat strings starting with `.` specially */
	readonly dot?: boolean;
	/** do not match extglobs (treat them as normal strings) */
	readonly noext?: boolean;
	/**
	 * the char that marks a numeric range, as `<mark>lo..hi<mark>`, which is
	 * matched as the numbers from lo to hi
	 */
	readonly rangeMark?: string;
}

// parsed pattern items
type Item =
	| { readonly t: "lit"; readonly ch: string }
	| { readonly t: "any" | "star" }
	| { readonly t: "class"; readonly re: RegExp }
	| { readonly t: "ext"; readonly type: string; readonly alts: Array<Array<Item>> };

// extglob syntax tokens become literals if they are not part of a
// closed extglob
type Token = Item | { readonly t: "open"; readonly type: string } | { readonly t: "bar" } | { readonly t: "close" };

/** A literal char. With `nocase`, `re` folds case, and `ascii` holds its results for ASCII chars, by char code: 1 for a match, and 2 for not. */
interface Lit {
	readonly ch: string;
	readonly re?: RegExp;
	ascii?: Uint8Array;
}

// state machine nodes
interface NegNode {
	readonly t: "neg";
	readonly id: number;
	readonly sub: Node;
	readonly next: Node;
}
interface SplitNode {
	readonly t: "split";
	readonly id: number;
	readonly out: Array<Node>;
}
type Node =
	| ({ readonly t: "lit"; readonly id: number; readonly next: Node } & Lit)
	| { readonly t: "any" | "star"; readonly id: number; readonly next: Node }
	| { readonly t: "class"; readonly id: number; readonly re: RegExp; readonly next: Node }
	| SplitNode
	| NegNode
	| { readonly t: "match"; readonly id: number };

/** Builds a regexp at construction; a source the runtime rejects throws the typed guard. */
export type Compile = (source: string, flags: string) => RegExp;

/**
 * Counts graph items against the caller's compile budget before they are
 * built, and throws the typed guard past it (port note 6).
 */
export type Charge = (items: number) => void;

// the end of the pattern, or of a negated sub-pattern
const MATCH: Node = { t: "match", id: 0 };

const extTypes = "!?+*@";

const lit = (ch: string): Item => ({ t: "lit", ch });

const reEscape = (s: string): string => s.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");

const litMatch = (l: Lit, c: string): boolean => {
	if (c === l.ch) return true;
	if (!l.re) return false;
	const code = c.charCodeAt(0);
	if (code >= 128) return l.re.test(c);
	l.ascii ??= new Uint8Array(128);
	const ascii = l.ascii;
	ascii[code] ||= l.re.test(c) ? 1 : 2;
	return ascii[code] === 1;
};

const tokenize = (
	p: string,
	nocase: boolean,
	noext: boolean,
	compile: Compile,
	mark: string | undefined,
	charge: Charge,
): Array<Token> => {
	const toks: Array<Token> = [];
	// one class-parser memo for this pattern
	const deadEnds = new Set<number>();
	for (let i = 0; i < p.length; ) {
		const c = String.fromCodePoint(p.codePointAt(i) as number);
		if (mark) {
			// a \ before a range would only escape its first char
			const m = c === "\\" && p.startsWith(mark, i + 1) ? 1 : 0;
			if (m || c === mark) {
				const start = i + m + mark.length;
				const end = p.indexOf(mark, start);
				const r = /^(-?\d+)\.\.(-?\d+)$/.exec(p.slice(start, end));
				const alts =
					end !== -1 && r
						? numericRange<Item>(r[1] as string, r[2] as string, lit, (a, b) => ({
								t: "class",
								re: compile(`^[${a}-${b}]$`, ""),
							}))
						: undefined;
				if (alts) {
					// port note 6: a range is charged by its items (56 alternatives
					// and 684 items for the widest ends)
					let items = alts.length;
					for (const alt of alts) items += alt.length;
					charge(items);
					toks.push({ t: "ext", type: "@", alts });
					i = end + mark.length;
					continue;
				}
			}
		}
		if (c === "\\") {
			// a trailing \ is a literal \
			const e = p.codePointAt(i + 1);
			const ch = e === undefined ? c : String.fromCodePoint(e);
			toks.push(lit(ch));
			i += 1 + ch.length;
			continue;
		}
		if (c === "[") {
			const [source, consumed] = parseMatcherClass(p, i, deadEnds);
			if (consumed && source !== null) {
				toks.push({ t: "class", re: compile(source, nocase ? "iu" : "u") });
				i += consumed;
				continue;
			}
		}
		if (!noext && extTypes.includes(c) && p[i + 1] === "(") {
			toks.push({ t: "open", type: c });
			i += 2;
			continue;
		}
		toks.push(
			!noext && c === "|"
				? { t: "bar" }
				: !noext && c === ")"
					? { t: "close" }
					: c === "*"
						? { t: "star" }
						: c === "?"
							? { t: "any" }
							: lit(c),
		);
		i += c.length;
	}
	return toks;
};

// map each open token index to the index of its close token
const pair = (toks: ReadonlyArray<Token>): Map<number, number> => {
	const pairs = new Map<number, number>();
	const stack: Array<number> = [];
	toks.forEach((tok, i) => {
		if (tok.t === "open") stack.push(i);
		else if (tok.t === "close" && stack.length) pairs.set(stack.pop() as number, i);
	});
	return pairs;
};

// build the alternatives between start and end. An open token that
// is not closed is never inside a closed extglob, so bar and close
// tokens are only literal at the top level.
const build = (
	toks: ReadonlyArray<Token>,
	pairs: ReadonlyMap<number, number>,
	start: number,
	end: number,
	top: boolean,
	depth: number,
): Array<Array<Item>> => {
	// Port note 4: the nesting bound for every recursion on nesting. For an
	// extglob #parseAST descends into (one that adopts its child, `@(`, `+(`),
	// #parseAST's structural guard fires first at the same depth; for one it
	// stops descending past maxExtglobRecursion (a `!(` in a `!(`), only this
	// guard sees the depth, so it is load-bearing.
	if (depth > MAX_NESTING_DEPTH) {
		throw new GuardExceeded("NestingDepthExceeded", MAX_NESTING_DEPTH, depth);
	}
	let seq: Array<Item> = [];
	const alts = [seq];
	for (let i = start; i < end; i++) {
		const tok = toks[i] as Token;
		const close = pairs.get(i);
		if (tok.t === "open" && close !== undefined) {
			const sub = build(toks, pairs, i + 1, close, false, depth + 1);
			seq.push({ t: "ext", type: tok.type, alts: sub });
			i = close;
		} else if (tok.t === "bar" && !top) {
			seq = [];
			alts.push(seq);
		} else if (tok.t === "open") {
			seq.push(lit(tok.type), lit("("));
		} else if (tok.t === "bar") {
			seq.push(lit("|"));
		} else if (tok.t === "close") {
			seq.push(lit(")"));
		} else if (tok.t === "star" && seq[seq.length - 1]?.t === "star") {
			// Port note 5: a run of `*` is one `*`.
		} else {
			seq.push(tok);
		}
	}
	return alts;
};

// the start node, and the number of node ids. Ids are dense, from 0
// for the match node.
const compileNodes = (
	items: ReadonlyArray<Item>,
	fold: (ch: string) => RegExp | undefined,
): readonly [start: Node, size: number] => {
	let id = 1;
	const split = (out: Array<Node>): SplitNode => ({ t: "split", id: id++, out });
	const seq = (its: ReadonlyArray<Item>, next: Node): Node => its.reduceRight((n, it) => item(it, n), next);
	const item = (it: Item, next: Node): Node => {
		switch (it.t) {
			case "lit": {
				const re = fold(it.ch);
				return re === undefined ? { t: "lit", id: id++, ch: it.ch, next } : { t: "lit", id: id++, ch: it.ch, re, next };
			}
			case "any":
			case "star":
				return { t: it.t, id: id++, next };
			case "class":
				return { t: "class", id: id++, re: it.re, next };
		}
		const alts = (n: Node): Array<Node> => it.alts.map((a) => seq(a, n));
		switch (it.type) {
			case "@":
				return split(alts(next));
			case "?":
				return split([next, ...alts(next)]);
			case "!":
				return { t: "neg", id: id++, sub: split(alts(MATCH)), next };
		}
		// * and +, loop back after each match
		const after = split([]);
		const entry = split(alts(after));
		after.out.push(next, entry);
		return it.type === "*" ? after : entry;
	};
	const start = seq(items, MATCH);
	return [start, id];
};

// A thread inside a !(...) negation. It holds the threads of the
// negated sub-pattern, started where the negation started. The
// negation matches the chars so far if the sub-pattern does not.
interface Run {
	readonly t: "run";
	readonly neg: NegNode;
	readonly state: State;
}

// The threads at one position in the string. Each node thread is
// only kept once, and runs with the same state are only kept once,
// so that identical threads merge. The match node is not in
// `threads`, because it can not step. It sets `match` instead.
class State {
	// set by the Sim, to mark the nodes that this state has
	readonly gen: number;
	threads: Array<Node> = [];
	match = false;
	runs: Array<Run> = [];
	// the sorted ids of the threads, with 0 for a match, once the
	// state is done
	ids: Array<number> = [];

	constructor(gen: number) {
		this.gen = gen;
	}

	// no threads, so nothing more can match
	get dead(): boolean {
		return !this.threads.length && !this.match && !this.runs.length;
	}
}

// true if the two states hold the same threads
const sameState = (a: State, b: State): boolean => {
	if (a.ids.length !== b.ids.length) return false;
	if (a.runs.length !== b.runs.length) return false;
	if (a.ids.some((id, i) => id !== b.ids[i])) return false;
	return a.runs.every((r) => b.runs.some((o) => o.neg === r.neg && sameState(o.state, r.state)));
};

/**
 * For each node id, the gen of the last state that has the node as a thread,
 * and of the last state that walked through it. A state is built to the end
 * before the states around it go on, and the nodes of a negated sub-pattern
 * are only in its states (other than the match node, which is never marked).
 * So one mark for each node is enough to know if the state being built has
 * it. The Sims of a matcher never run at the same time, so they share one
 * Marks.
 */
interface Marks {
	readonly has: Float64Array;
	readonly seen: Float64Array;
	gen: number;
}

const marks = (size: number): Marks => ({
	has: new Float64Array(size),
	seen: new Float64Array(size),
	gen: 0,
});

class Sim {
	// `.` and `..` only match literal dots, even with `dot:true`
	readonly dots: boolean;
	// the string starts with `.`, and `dot:true` is not set
	readonly dotStart: boolean;
	readonly #marks: Marks;

	constructor(dots: boolean, dotStart: boolean, m: Marks) {
		this.dots = dots;
		this.dotStart = dotStart;
		this.#marks = m;
	}

	state(): State {
		return new State(++this.#marks.gen);
	}

	// sort the ids of a state, once it has all of its threads
	done(state: State): State {
		state.ids = state.threads.map((n) => n.id).sort((a, b) => a - b);
		if (state.match) state.ids.unshift(MATCH.id);
		return state;
	}

	// true the first time that the state walks through the node, so
	// that loops in the graph stop
	#visit(state: State, node: Node): boolean {
		const { seen } = this.#marks;
		if (seen[node.id] === state.gen) return false;
		seen[node.id] = state.gen;
		return true;
	}

	#addThread(state: State, node: Node): boolean {
		const { has } = this.#marks;
		if (has[node.id] === state.gen) return false;
		has[node.id] = state.gen;
		state.threads.push(node);
		return true;
	}

	// wildcards only match a leading dot if `dot:true`. In a negated
	// sub-pattern, this does not apply, because the negation itself
	// can not match a leading dot.
	restricted(i: number, top: boolean): boolean {
		return top && (this.dots || (this.dotStart && i === 0));
	}

	// Port note 3: the nodes reachable from `first` without taking a char,
	// walked with an explicit stack.
	add(state: State, first: Node, i: number, top: boolean): void {
		const stack: Array<Node> = [first];
		while (stack.length) {
			const node = stack.pop() as Node;
			switch (node.t) {
				case "split":
					if (!this.#visit(state, node)) continue;
					for (let o = node.out.length - 1; o >= 0; o--) stack.push(node.out[o] as Node);
					continue;
				case "neg": {
					if (!this.#visit(state, node)) continue;
					const sub = this.state();
					this.add(sub, node.sub, i, false);
					this.done(sub);
					const next = this.#addRun(state, { t: "run", neg: node, state: sub });
					if (next !== undefined) stack.push(next);
					continue;
				}
				case "star":
					// a * can not start a dotfile, even if it matches nothing
					if (this.restricted(i, top)) continue;
					if (this.#addThread(state, node)) stack.push(node.next);
					continue;
				case "match":
					state.match = true;
					continue;
				default:
					this.#addThread(state, node);
			}
		}
	}

	// keeps the run unless the state has the same one; answers the node to
	// walk next when the negation matches so far
	#addRun(state: State, run: Run): Node | undefined {
		for (const r of state.runs) {
			if (r.neg === run.neg && sameState(r.state, run.state)) return undefined;
		}
		state.runs.push(run);
		return run.state.match ? undefined : run.neg.next;
	}

	addRun(state: State, run: Run, i: number, top: boolean): void {
		const next = this.#addRun(state, run);
		if (next !== undefined) this.add(state, next, i, top);
	}

	// the threads after char `c`, at index `i`
	step(state: State, c: string, i: number, top: boolean): State {
		const next = this.state();
		for (const th of state.threads) {
			switch (th.t) {
				case "lit":
					if (litMatch(th, c)) {
						this.add(next, th.next, i + 1, top);
					}
					break;
				case "any":
					if (!this.restricted(i, top)) this.add(next, th.next, i + 1, top);
					break;
				case "class":
					if (!this.restricted(i, top) && th.re.test(c)) {
						this.add(next, th.next, i + 1, top);
					}
					break;
				case "star":
					if (!this.restricted(i, top)) this.add(next, th, i + 1, top);
			}
		}
		if (!this.restricted(i, top)) {
			for (const run of state.runs) {
				// a sub-pattern with no threads can not match again, so the
				// run stays the same
				if (run.state.dead) {
					this.addRun(next, run, i + 1, top);
					continue;
				}
				const sub = this.step(run.state, c, i, false);
				this.addRun(next, { t: "run", neg: run.neg, state: sub }, i + 1, top);
			}
		}
		return this.done(next);
	}
}

// A canonical key for the threads in a state. States with the same
// key hold the same threads, so they match the same strings.
const stateKey = (state: State): string => {
	const ids = state.ids.join();
	if (!state.runs.length) return ids;
	const runs = state.runs.map((r) => `${r.neg.id}(${stateKey(r.state)})`);
	return `${ids}|${runs.sort().join("|")}`;
};

// A cached state of the simulation, and the states that each char
// leads to.
interface DState {
	readonly state: State;
	readonly match: boolean;
	// no threads, so nothing more can match
	readonly dead: boolean;
	// the next state for each ASCII char, by char code, and for the
	// other chars
	ascii?: Array<DState | undefined>;
	readonly next: Map<string, DState>;
}

// The cache can hold about this many chars of state keys and
// transitions. When it is full, it is cleared, so that a pattern
// can not use an unbounded amount of memory.
const DFA_BUDGET = 1 << 18;

// A cache of the states that the simulation reaches, built as the
// matcher is used. Each char of a string is then one Map lookup,
// once the states that it leads to are known.
//
// The dot rules only restrict the first char of a dotfile (strings
// that are only `.` or `..` do not use the cache). So a dotfile
// starts at its own state, which takes its first step with the
// restriction, and every other state takes steps without it.
class Dfa {
	readonly #start: Node;
	#states = new Map<string, DState>();
	#size = 0;
	#plain: DState | undefined;
	#dotStart: DState | undefined;
	readonly #sim: Sim;
	readonly #dotSim: Sim;

	constructor(start: Node, m: Marks) {
		this.#start = start;
		this.#sim = new Sim(false, false, m);
		this.#dotSim = new Sim(false, true, m);
	}

	#make(state: State): DState {
		return {
			state,
			match: state.match,
			dead: state.dead,
			next: new Map(),
		};
	}

	#intern(state: State): DState {
		const key = stateKey(state);
		const found = this.#states.get(key);
		if (found) return found;
		if (this.#size > DFA_BUDGET) this.#clear();
		const d = this.#make(state);
		this.#states.set(key, d);
		this.#size += key.length + 1;
		return d;
	}

	#clear(): void {
		this.#states.clear();
		this.#size = 0;
		this.#plain = undefined;
		this.#dotStart = undefined;
	}

	start(dotStart: boolean): DState {
		if (dotStart) {
			if (this.#dotStart) return this.#dotStart;
			const state = this.#dotSim.state();
			this.#dotSim.add(state, this.#start, 0, true);
			this.#dotStart = this.#make(this.#dotSim.done(state));
			return this.#dotStart;
		}
		if (this.#plain) return this.#plain;
		const state = this.#sim.state();
		this.#sim.add(state, this.#start, 0, true);
		this.#plain = this.#intern(this.#sim.done(state));
		return this.#plain;
	}

	// the next state, after a miss in `d.ascii`
	next(d: DState, c: string): DState {
		const code = c.charCodeAt(0);
		const found = code < 128 ? undefined : d.next.get(c);
		if (found) return found;
		// the dotfile start is not in the cache, so it is never shared
		const n =
			d === this.#dotStart
				? this.#intern(this.#dotSim.step(d.state, c, 0, true))
				: this.#intern(this.#sim.step(d.state, c, 1, true));
		if (code < 128) {
			if (!d.ascii) {
				d.ascii = new Array(128);
				this.#size += 128;
			}
			d.ascii[code] = n;
		} else {
			d.next.set(c, n);
		}
		this.#size++;
		return n;
	}
}

/** A node in a graph with no splits or negations: a chain of nodes that each match one char, or a `*`. */
type LinearNode = Exclude<Node, SplitNode | NegNode | { readonly t: "match" }>;

// the nodes in order, if the graph is a single chain
const linear = (start: Node): Array<LinearNode> | undefined => {
	const nodes: Array<LinearNode> = [];
	for (let n = start; n.t !== "match"; n = n.next) {
		if (n.t === "split" || n.t === "neg") return undefined;
		nodes.push(n);
	}
	return nodes;
};

// Match a chain of nodes. Each node other than `*` matches exactly
// one char, so on a failure it is enough to go back to the last `*`
// and let it match one more char. This takes at most
// nodes.length * chars.length steps.
const testLinear = (
	nodes: ReadonlyArray<LinearNode>,
	chars: ArrayLike<string>,
	start: number,
	end: number,
): boolean => {
	let ni = 0;
	let ci = start;
	let starNi = -1;
	let starCi = 0;
	while (ci < end) {
		const n = nodes[ni];
		if (n?.t === "star") {
			starNi = ni++;
			starCi = ci;
			continue;
		}
		const c = chars[ci] as string;
		if (n && (n.t === "any" || (n.t === "lit" && litMatch(n, c)) || (n.t === "class" && n.re.test(c)))) {
			ni++;
			ci++;
			continue;
		}
		if (starNi === -1) return false;
		ni = starNi + 1;
		ci = ++starCi;
	}
	while (nodes[ni]?.t === "star") ni++;
	return ni === nodes.length;
};

// The least and most chars that the items can match. These are only
// bounds: a negation can match a string of any length, so it counts
// as 0 to Infinity.
const lengths = (items: ReadonlyArray<Item>): readonly [min: number, max: number] => {
	let min = 0;
	let max = 0;
	for (const it of items) {
		const [lo, hi] = itemLengths(it);
		min += lo;
		max += hi;
	}
	return [min, max];
};

const itemLengths = (it: Item): readonly [min: number, max: number] => {
	if (it.t === "star") return [0, Number.POSITIVE_INFINITY];
	if (it.t !== "ext") return [1, 1];
	if (it.type === "!") return [0, Number.POSITIVE_INFINITY];
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const a of it.alts) {
		const [lo, hi] = lengths(a);
		if (lo < min) min = lo;
		if (hi > max) max = hi;
	}
	// a loop of alternatives that only match the empty string is empty
	const loop = max === 0 ? 0 : Number.POSITIVE_INFINITY;
	return it.type === "@" ? [min, max] : it.type === "?" ? [0, max] : it.type === "*" ? [0, loop] : [min, loop];
};

// true if the chars from `start` match the literals
const hasAffix = (lits: ReadonlyArray<Lit>, chars: ArrayLike<string>, start: number): boolean => {
	for (let j = 0; j < lits.length; j++) {
		if (!litMatch(lits[j] as Lit, chars[start + j] as string)) return false;
	}
	return true;
};

const surrogate = /[\ud800-\udfff]/;

// a string can be indexed by code point, unless it has surrogate
// pairs
const codePoints = (s: string): ArrayLike<string> => (surrogate.test(s) ? [...s] : s);

/** One path portion pattern, matched as minimatch 11.0.5 matches it. */
export class Matcher {
	readonly pattern: string;
	readonly options: MatcherOptions;
	readonly #start: Node;
	// the number of node ids
	readonly #size: number;
	#marks: Marks | undefined;
	// the Sim for strings that are only `.` or `..`
	#dotsSim: Sim | undefined;
	// the string to compare, if the pattern has no magic, and with
	// `nocase` the RegExp that folds case (port note 2: built now)
	readonly #literal: string | undefined;
	readonly #literalRe: RegExp | undefined;
	// the nodes between the prefix and suffix, if the graph is a
	// single chain
	#linear: Array<LinearNode> | undefined;
	// the linear nodes are only `*` and `?`, so the length bounds and
	// the prefix and suffix decide the match
	#wild = false;
	// the least and most chars that a match can have
	#min = 0;
	#max = Number.POSITIVE_INFINITY;
	// the literals that a match must start and end with. Each one
	// matches exactly one char, and they are distinct items in the
	// pattern, so a string that does not have them can not match.
	readonly #prefix: Array<Lit> = [];
	readonly #suffix: Array<Lit> = [];
	// the prefix and suffix as strings, if they do not fold case
	#prefixStr: string | undefined;
	#suffixStr: string | undefined;
	// there is a prefix or suffix to check
	#affix = false;
	#dfa: Dfa | undefined;

	constructor(pattern: string, options: MatcherOptions, compile: Compile, charge: Charge = () => {}) {
		this.pattern = pattern;
		this.options = options;
		const nocase = options.nocase ?? false;
		const noext = options.noext ?? false;
		// foldRe for each literal char, built now and shared in this matcher
		const folds = new Map<string, RegExp>();
		const fold = (ch: string): RegExp | undefined => {
			if (!nocase) return undefined;
			let re = folds.get(ch);
			if (re === undefined) {
				re = compile(`^${reEscape(ch)}$`, "iu");
				folds.set(ch, re);
			}
			return re;
		};
		// a pattern that is only an empty extglob is a literal string,
		// except for `!()`, which matches any non-empty string
		const literal = /^[?*+@]\(\)$/.test(pattern);
		const toks = tokenize(pattern, nocase, noext || literal, compile, options.rangeMark, charge);
		// port note 6: every other token is one item of the graph
		charge(toks.length);
		const items = build(toks, pair(toks), 0, toks.length, true, 0)[0] as Array<Item>;
		const [start, size] = compileNodes(items, fold);
		this.#start = start;
		this.#size = size;
		if (items.every((it) => it.t === "lit")) {
			this.#literal = items.map((it) => (it as { readonly ch: string }).ch).join("");
			this.#literalRe = nocase ? compile(`^${reEscape(this.#literal)}$`, "iu") : undefined;
		} else {
			this.#literal = undefined;
			this.#literalRe = undefined;
			const litOf = (it: Item): Lit | undefined => {
				if (it.t !== "lit") return undefined;
				const re = fold(it.ch);
				return re === undefined ? { ch: it.ch } : { ch: it.ch, re };
			};
			for (const it of items) {
				const l = litOf(it);
				if (!l) break;
				this.#prefix.push(l);
			}
			for (let j = items.length - 1; j >= 0; j--) {
				const l = litOf(items[j] as Item);
				if (!l) break;
				this.#suffix.unshift(l);
			}
			this.#affix = !!(this.#prefix.length || this.#suffix.length);
			if (!nocase) {
				this.#prefixStr = this.#prefix.map((l) => l.ch).join("");
				this.#suffixStr = this.#suffix.map((l) => l.ch).join("");
			}
			this.#linear = linear(this.#start)?.slice(this.#prefix.length, -this.#suffix.length || undefined);
			this.#wild = !!this.#linear?.every((n) => n.t === "star" || n.t === "any");
			const [min, max] = lengths(items);
			this.#min = min;
			this.#max = max;
		}
	}

	/** Whether one path portion (a string with no `/`) matches. */
	testUnchecked(s: string): boolean {
		return this.#test(s);
	}

	#test(s: string): boolean {
		if (this.#literal !== undefined) {
			return this.#literalRe === undefined ? s === this.#literal : this.#literalRe.test(s);
		}
		// the length check means that the prefix and suffix do not
		// overlap. Without the chars, the length in code points is from
		// half of the UTF-16 length (if each one is a surrogate pair) to
		// all of it, which is often enough to know.
		const min = this.#min;
		const max = this.#max;
		let chars: ArrayLike<string> | undefined;
		const most = s.length;
		const least = (most + 1) >> 1;
		if (most < min || least > max) return false;
		if (least < min || most > max) chars = codePoints(s);
		if (chars !== undefined && (chars.length < min || chars.length > max)) {
			return false;
		}
		const prefix = this.#prefix.length;
		if (this.#affix) {
			if (this.#prefixStr !== undefined && this.#suffixStr !== undefined) {
				if (!s.startsWith(this.#prefixStr) || !s.endsWith(this.#suffixStr)) {
					return false;
				}
			} else {
				chars ??= codePoints(s);
				const end = chars.length - this.#suffix.length;
				if (!hasAffix(this.#prefix, chars, 0) || !hasAffix(this.#suffix, chars, end)) {
					return false;
				}
			}
		}
		const dotStart = !this.options.dot && s.startsWith(".");
		if (this.#linear) {
			// `.` and `..` only match literal dots, even with `dot:true`
			if (s === "." || s === "..") return false;
			// only a literal can match the leading dot. A `*` can not
			// start a dotfile, even if it matches nothing.
			if (dotStart && !prefix) return false;
			if (this.#wild) return true;
			chars ??= codePoints(s);
			const end = chars.length - this.#suffix.length;
			return testLinear(this.#linear, chars, prefix, end);
		}
		chars ??= codePoints(s);
		if (s === "." || s === "..") {
			this.#marks ??= marks(this.#size);
			this.#dotsSim ??= new Sim(true, false, this.#marks);
			const sim = this.#dotsSim;
			const start = sim.state();
			sim.add(start, this.#start, 0, true);
			let state = sim.done(start);
			for (let i = 0; i < chars.length; i++) {
				state = sim.step(state, chars[i] as string, i, true);
			}
			return state.match;
		}
		this.#marks ??= marks(this.#size);
		this.#dfa ??= new Dfa(this.#start, this.#marks);
		const dfa = this.#dfa;
		let d = dfa.start(dotStart);
		// read char codes from the string, so that a one-char string is
		// only made for a cache miss
		const str = chars === s;
		for (let i = 0; i < chars.length; i++) {
			if (d.dead) return false;
			const code = str ? s.charCodeAt(i) : (chars[i] as string).charCodeAt(0);
			d = d.ascii?.[code] ?? dfa.next(d, chars[i] as string);
		}
		return d.match;
	}
}
