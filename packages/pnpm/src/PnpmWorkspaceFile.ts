// The pnpm-workspace.yaml editor: targeted edits over the YAML the file
// already holds, so comments, key order and unchanged lines survive. The
// internals restate rolldown-pnpm-config's editor on @effected/yaml.

import type { YamlNode, YamlPath, YamlScalar } from "@effected/yaml";
import { Yaml, YamlDocument, YamlFormat, YamlLint, YamlLintConfig, YamlStringifyOptions } from "@effected/yaml";
import { Effect, Option, Order, Predicate, Result, Schema } from "effect";

// lineWidth 0 disables wrapping.
const STRINGIFY_OPTIONS = YamlStringifyOptions.make({ indent: 2, lineWidth: 0 });

/**
 * The lint config style inference resolves over: the renderer's historical
 * defaults (2-space, unindented sequences, single quotes), so a dimension the
 * source gives no votes to falls back to that output rather than the lint
 * preset's double-quote default.
 */
const STYLE_BASE = YamlLintConfig.make({
	rules: {
		...YamlLintConfig.default.rules,
		indentation: { spaces: 2, indentSequences: false },
		"quoted-strings": { quoteType: "single" },
	},
});

/** True when every element is a string/number/boolean (safe to sort). */
const allPrimitive = (arr: readonly unknown[]): boolean =>
	arr.every((v) => v === null || (typeof v !== "object" && typeof v !== "function"));

/**
 * The deepest container nesting the editor reads or writes: @effected/yaml's
 * own cap, past which it parses to a diagnostic and stringifies to a failure.
 */
const MAX_DEPTH = 256;

/** The most values a written mapping may hold: bounds a shared-reference DAG that is finite yet exponential to walk. */
const MAX_NODES = 1_000_000;

const canonicalizeAt = (value: unknown, depth: number): unknown => {
	// Past the cap the value is returned as is: no recursion, so a cycle cannot overflow the stack.
	if (depth > MAX_DEPTH) return value;
	if (Array.isArray(value)) {
		const mapped = value.map((v) => canonicalizeAt(v, depth + 1));
		return allPrimitive(mapped) ? [...mapped].sort((a, b) => Order.String(String(a), String(b))) : mapped;
	}
	if (Predicate.isObject(value)) {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([a], [b]) => Order.String(a, b))
				.map(([k, v]) => [k, canonicalizeAt(v, depth + 1)]),
		);
	}
	return value;
};

const canonicalize = (value: unknown): unknown => canonicalizeAt(value, 0);

const unrepresentable = (cause: unknown): PnpmWorkspaceFileError =>
	new PnpmWorkspaceFileError({ reason: "unrepresentable", cause });

/**
 * Copy caller data into plain objects, failing typed when it has no YAML form:
 * cyclic or nested past the depth cap, too many values, or holding a function
 * or symbol. Every read of caller data (spread, `Object.values`, getters,
 * proxies) happens here, so a throw from one is the caller's input failing,
 * and nothing past this point can reach a caller-controlled accessor.
 */
const snapshot = (value: unknown): Result.Result<unknown, PnpmWorkspaceFileError> => {
	let nodes = 0;
	const copy = (v: unknown, depth: number): unknown => {
		if (typeof v === "function" || typeof v === "symbol") throw new TypeError(`a ${typeof v} has no YAML form`);
		if (typeof v !== "object" || v === null) return v;
		if (depth > MAX_DEPTH || ++nodes > MAX_NODES) {
			throw new RangeError("value is cyclic, nested past the depth cap, or too large");
		}
		return Array.isArray(v)
			? v.map((item) => copy(item, depth + 1))
			: Object.fromEntries(Object.entries(v).map(([k, item]) => [k, copy(item, depth + 1)]));
	};
	try {
		return Result.succeed(copy(value, 1));
	} catch (cause) {
		return Result.fail(unrepresentable(cause));
	}
};

/** Snapshot a caller's mapping, then run `body` over the copy; only a `PnpmWorkspaceFileError` is folded, every other throw is an editor defect. */
const guarded = (
	value: Readonly<Record<string, unknown>>,
	body: (copy: Record<string, unknown>) => string,
): Result.Result<string, PnpmWorkspaceFileError> => {
	const copied = snapshot(value);
	if (Result.isFailure(copied)) return Result.fail(copied.failure);
	try {
		return Result.succeed(body(copied.success as Record<string, unknown>));
	} catch (cause) {
		if (cause instanceof PnpmWorkspaceFileError) return Result.fail(cause);
		throw cause;
	}
};

const renderResult = (obj: Record<string, unknown>, options: YamlStringifyOptions = STRINGIFY_OPTIONS) =>
	Result.mapError(Yaml.stringifyResult(canonicalize(obj), options), unrepresentable);

const renderWorkspace = (obj: Record<string, unknown>, options: YamlStringifyOptions = STRINGIFY_OPTIONS): string =>
	Result.getOrThrow(renderResult(obj, options));

const inferStyle = (source: string): YamlStringifyOptions => {
	const { rules } = YamlLint.resolveLenient(YamlLint.observe(source, YamlLint.builtins), STYLE_BASE);
	const indentation = rules.indentation as { spaces?: unknown; indentSequences?: unknown };
	const quoted = rules["quoted-strings"] as { quoteType?: unknown };
	return YamlStringifyOptions.make({
		indent: typeof indentation.spaces === "number" ? indentation.spaces : 2,
		indentSequences: indentation.indentSequences === true,
		quoteStyle: quoted.quoteType === "double" ? "double" : "single",
		lineWidth: 0,
	});
};

/** Order-insensitive structural equality over canonical forms. */
function sameValue(a: unknown, b: unknown): boolean {
	return structEqual(canonicalize(a), canonicalize(b));
}

/** Structural equality: NaN equals NaN, a bigint equals only itself, null equals only null, key order is ignored. */
function structEqual(a: unknown, b: unknown): boolean {
	if (a === b || (Number.isNaN(a) && Number.isNaN(b))) return true;
	if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => structEqual(v, b[i]));
	if (isMapping(a) && isMapping(b)) {
		const keys = Object.keys(a);
		return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && structEqual(a[k], b[k]));
	}
	return false;
}

/** A mapping (not a sequence, not null) — the only node the diff descends into. */
function isMapping(v: unknown): v is Record<string, unknown> {
	return Predicate.isObject(v) && !Array.isArray(v);
}

/** One planned write: the path and the new value (`undefined` removes). */
interface Change {
	readonly path: YamlPath;
	readonly value: unknown;
	/** True when the path's last segment is a mapping key the source lacks. */
	readonly newKey?: true;
}

/**
 * Per-item edits for a primitive sequence present on both sides: remove the
 * items `next` no longer holds (highest index first, so earlier indices stay
 * valid) and append the ones it adds, in canonical order. Every other item's
 * line is untouched. Matching is by multiset, so a reorder is not a change.
 */
function sequenceChanges(path: YamlPath, prev: readonly unknown[], next: readonly unknown[]): Change[] {
	// Items here are primitives (the caller checked): the type tag keeps 1, "1", 1n and null apart.
	const key = (v: unknown) => `${v === null ? "null" : typeof v}:${String(v)}`;
	const pending = new Map<string, number>();
	for (const v of next) pending.set(key(v), (pending.get(key(v)) ?? 0) + 1);
	const removed: number[] = [];
	prev.forEach((v, i) => {
		const n = pending.get(key(v)) ?? 0;
		if (n > 0) pending.set(key(v), n - 1);
		else removed.push(i);
	});
	const added: unknown[] = [];
	for (const v of next) {
		const n = pending.get(key(v)) ?? 0;
		if (n > 0) {
			added.push(v);
			pending.set(key(v), n - 1);
		}
	}
	added.sort((a, b) => Order.String(String(a), String(b)));
	const changes: Change[] = added.map((v, i) => ({ path: [...path, prev.length + i], value: v }));
	for (const i of removed.reverse()) changes.push({ path: [...path, i], value: undefined });
	return changes;
}

/**
 * The minimal path-targeted changes taking `before` to `after`: descend
 * through mappings present on both sides, edit primitive sequences item by
 * item, and replace (or remove) any other value whose canonical form differs.
 */
function workspaceChanges(
	before: Record<string, unknown>,
	after: Record<string, unknown>,
	prefix: YamlPath = [],
): Change[] {
	const changes: Change[] = [];
	for (const key of Object.keys(before)) {
		if (!Object.hasOwn(after, key)) changes.push({ path: [...prefix, key], value: undefined });
	}
	for (const [key, next] of Object.entries(after)) {
		const path = [...prefix, key];
		if (!Object.hasOwn(before, key)) {
			changes.push({ path, value: canonicalize(next), newKey: true });
			continue;
		}
		const prev = before[key];
		if (sameValue(prev, next)) continue;
		if (isMapping(prev) && isMapping(next)) changes.push(...workspaceChanges(prev, next, path));
		else if (
			Array.isArray(prev) &&
			Array.isArray(next) &&
			next.length > 0 &&
			allPrimitive(prev) &&
			allPrimitive(next)
		) {
			changes.push(...sequenceChanges(path, prev, next));
		} else changes.push({ path, value: canonicalize(next) });
	}
	return changes;
}

/** Where a scalar sits: a mapping key, a mapping value, or a sequence item. */
type Role = "key" | "value" | "item";

/** Every scalar under `node`, with its role. */
function* scalarsOf(node: YamlNode | null, role: Role): Generator<readonly [YamlScalar, Role]> {
	if (node === null) return;
	if (node._tag === "YamlScalar") yield [node, role];
	else if (node._tag === "YamlMap") {
		for (const pair of node.items) {
			yield* scalarsOf(pair.key, "key");
			yield* scalarsOf(pair.value, "value");
		}
	} else if (node._tag === "YamlSeq") for (const item of node.items) yield* scalarsOf(item, "item");
}

/** True when `s` would render plain, i.e. quoting it is a style choice rather than a requirement. */
function couldBePlain(s: string): boolean {
	const out = Yaml.stringifyResult(s, STRINGIFY_OPTIONS);
	return Result.isSuccess(out) && !/^['"]/.test(out.success);
}

/**
 * The quoting vote over `scalars`: positive when, among strings that need no
 * quotes, more are quoted than plain. Strings that must be quoted (`@scope/*`)
 * cast no vote, so scalars quoted only where required read as plain.
 */
function quoteVote(scalars: Iterable<readonly [YamlScalar, Role]>): number {
	let vote = 0;
	for (const [scalar] of scalars) {
		if (typeof scalar.value !== "string" || !couldBePlain(scalar.value)) continue;
		vote += scalar.style === "plain" ? -1 : 1;
	}
	return vote;
}

/** The roles in which the whole document quotes strings by choice: the fallback when siblings give no vote. */
function quotedRoles(doc: YamlNode | null): ReadonlySet<Role> {
	const all = [...scalarsOf(doc, "value")];
	return new Set(
		(["key", "value", "item"] as const).filter((r) => quoteVote(all.filter(([, role]) => role === r)) > 0),
	);
}

/** `s` as a quoted scalar in the given quote character. */
function quote(s: string, style: "single" | "double"): string {
	return style === "double" ? JSON.stringify(s) : `'${s.replaceAll("'", "''")}'`;
}

/** The scalar directly at `node` (not nested), with its role. */
function directScalar(node: YamlNode | null, role: Role): Array<readonly [YamlScalar, Role]> {
	return node?._tag === "YamlScalar" ? [[node, role]] : [];
}

/**
 * Quote the plain string scalars a change just wrote, where the file quotes
 * by choice. The stringifier only quotes what it must, so without this a
 * catalog that quotes every key gains a bare `vitest:` beside `"effect":`.
 * The written node's own key, value or item follows its siblings' vote, which
 * keeps the choice local (a file can quote catalog keys yet leave top-level
 * keys plain); scalars nested deeper in a new subtree, or a node whose
 * siblings cast no vote, follow the whole document's roles. Only the written
 * subtree is touched (plus its key when the key is new).
 */
function requoteWritten(text: string, change: Change, docRoles: ReadonlySet<Role>, style: "single" | "double"): string {
	if (change.value === undefined) return text;
	const doc = YamlDocument.parseResult(text);
	if (Result.isFailure(doc) || doc.success.contents === null) return text;
	const root = doc.success.contents;
	const last = change.path[change.path.length - 1];
	const parent = change.path.length > 1 ? root.find(change.path.slice(0, -1)) : Option.some(root);
	if (Option.isNone(parent)) return text;
	const container = parent.value;
	const decide = (vote: number, role: Role) => (vote !== 0 ? vote > 0 : docRoles.has(role));
	const targets: Array<readonly [YamlScalar, boolean]> = [];
	const deep = (node: YamlNode | null) => {
		if (node === null || node._tag === "YamlScalar") return;
		for (const [scalar, role] of scalarsOf(node, "value")) targets.push([scalar, docRoles.has(role)]);
	};
	if (container._tag === "YamlMap") {
		const index = container.items.findIndex((p) => p.key._tag === "YamlScalar" && String(p.key.value) === String(last));
		const pair = container.items[index];
		if (pair === undefined) return text;
		const siblings = container.items.filter((_, i) => i !== index);
		if (change.newKey) {
			const vote = quoteVote(siblings.flatMap((p) => directScalar(p.key, "key")));
			for (const [scalar] of directScalar(pair.key, "key")) targets.push([scalar, decide(vote, "key")]);
		}
		const vote = quoteVote(siblings.flatMap((p) => directScalar(p.value, "value")));
		for (const [scalar] of directScalar(pair.value, "value")) targets.push([scalar, decide(vote, "value")]);
		deep(pair.value);
	} else if (container._tag === "YamlSeq" && typeof last === "number") {
		const item = container.items[last] ?? null;
		const vote = quoteVote(container.items.filter((_, i) => i !== last).flatMap((n) => directScalar(n, "item")));
		for (const [scalar] of directScalar(item, "item")) targets.push([scalar, decide(vote, "item")]);
		deep(item);
	}
	const edits = targets
		.filter(([s, quoted]) => quoted && s.style === "plain" && typeof s.value === "string" && s.tag === undefined)
		.map(([s]) => ({ offset: s.offset, length: s.length, content: quote(s.value as string, style) }))
		.sort((a, b) => b.offset - a.offset);
	let out = text;
	for (const e of edits) out = out.slice(0, e.offset) + e.content + out.slice(e.offset + e.length);
	return out;
}

/** True when some mapping in `node` holds two keys that read as the same string (`1:` and `'1':`). */
function hasCollidingKeys(node: YamlNode | null): boolean {
	if (node === null) return false;
	if (node._tag === "YamlMap") {
		const seen = new Set<string>();
		for (const { key, value } of node.items) {
			const k =
				key._tag === "YamlScalar"
					? String(key.value)
					: JSON.stringify(key, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
			if (seen.has(k)) return true;
			seen.add(k);
			if (hasCollidingKeys(value)) return true;
		}
	} else if (node._tag === "YamlSeq") return node.items.some(hasCollidingKeys);
	return false;
}

/**
 * True when `text` parses to exactly `next` (canonically) with no colliding
 * keys. The edit model and the parsed object can disagree — anchors and
 * aliases (a removed `&b` leaves a dangling `*b`; a splice under an anchor
 * changes every alias), merge keys, non-string keys — and this is the one
 * check that catches all of them.
 */
function faithful(text: string, next: Record<string, unknown>): boolean {
	const doc = YamlDocument.parseResult(text);
	if (Result.isFailure(doc) || hasCollidingKeys(doc.success.contents)) return false;
	const value = Yaml.parseResult(text);
	return Result.isSuccess(value) && sameValue(isMapping(value.success) ? value.success : {}, next);
}

/**
 * Whether a change puts a primitive over an existing scalar. `modify` splices
 * that in place, keeping the scalar's own quotes and trailing comment, so it
 * must not be re-quoted to match its siblings: the author's spelling of that
 * one value stands.
 */
function replacesScalar(text: string, change: Change): boolean {
	const { value } = change;
	if (change.newKey || (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")) {
		return false;
	}
	const doc = YamlDocument.parseResult(text);
	if (Result.isFailure(doc) || doc.success.contents === null) return false;
	const target = doc.success.contents.find(change.path);
	return Option.isSome(target) && target.value._tag === "YamlScalar";
}

/** Apply every change as an edit; `None` when the editor refuses one. */
function applyChanges(source: string, changes: readonly Change[], style: YamlStringifyOptions): Option.Option<string> {
	const docRoot = YamlDocument.parseResult(source);
	const roles = Result.isSuccess(docRoot) ? quotedRoles(docRoot.success.contents) : new Set<Role>();
	const quoteChar = style.quoteStyle ?? "single";
	let text = source;
	for (const change of changes) {
		const keepSpelling = replacesScalar(text, change);
		const result = YamlFormat.modifyToStringResult(text, change.path, change.value, style);
		if (Result.isFailure(result)) return Option.none();
		text = keepSpelling ? result.success : requoteWritten(result.success, change, roles, quoteChar);
	}
	return Option.some(text);
}

/** Re-edit `source` into `next`; the whole of {@link PnpmWorkspaceFile}'s `writeResult`. */
const writeWorkspace = (
	source: string,
	parsed: Option.Option<unknown>,
	given: Readonly<Record<string, unknown>>,
): Result.Result<string, PnpmWorkspaceFileError> =>
	guarded(given, (next) => {
		if (source.trim() === "") return renderWorkspace(next);
		const style = inferStyle(source);
		const crlf = source.includes("\r\n");
		const base = Option.getOrUndefined(parsed);
		const edited = isMapping(base) ? applyChanges(source, workspaceChanges(base, next), style) : Option.none<string>();
		const text = Option.isSome(edited) && faithful(edited.value, next) ? edited.value : renderWorkspace(next, style);
		return crlf ? text.replace(/\r?\n/g, "\r\n") : text;
	});

/** What a file's text parsed to: `None` when it is not well-formed YAML. */
const memo = new WeakMap<
	object,
	{ readonly parsed: Option.Option<unknown>; readonly value: Record<string, unknown> }
>();

/** The mapping a parse holds, as a copy: `value` never aliases the tree writes are diffed against. */
const mappingCopy = (parsed: unknown): Record<string, unknown> => (isMapping(parsed) ? structuredClone(parsed) : {});

const readMemo = (file: PnpmWorkspaceFile) => {
	const hit = memo.get(file);
	if (hit !== undefined) return hit;
	const parsed = Yaml.parseResult(file.source);
	const entry = Result.isSuccess(parsed)
		? { parsed: Option.some(parsed.success), value: mappingCopy(parsed.success) }
		: { parsed: Option.none<unknown>(), value: {} };
	memo.set(file, entry);
	return entry;
};

/**
 * Why a `pnpm-workspace.yaml` could not be read.
 *
 * @remarks
 * `"invalid-yaml"` — the text is not well-formed YAML; `cause` carries the
 * YAML engine's own error with its positioned diagnostics.
 * `"unrepresentable"` — a value handed to `write` or `render` has no YAML
 * form: it is cyclic, nested deeper than the YAML engine's cap, holds a
 * function or symbol, or the engine refused it; `cause` says which. A document that is
 * well-formed but not a mapping (a top-level sequence or scalar) is not a
 * failure: pnpm reads it as an empty workspace and so does
 * {@link PnpmWorkspaceFile}.
 *
 * @public
 */
export class PnpmWorkspaceFileError extends Schema.TaggedError<PnpmWorkspaceFileError>()("PnpmWorkspaceFileError", {
	/** What was wrong. */
	reason: Schema.Literals(["invalid-yaml", "unrepresentable"]),
	/** The underlying error. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		const detail = this.cause instanceof Error ? this.cause.message : "no detail";
		return this.reason === "invalid-yaml"
			? `Cannot read pnpm-workspace.yaml: ${detail}`
			: `Cannot write pnpm-workspace.yaml: the value has no YAML form (${detail})`;
	}
}

/**
 * A `pnpm-workspace.yaml` as text plus the mapping it holds, with an editor
 * that writes a new mapping over the text as targeted edits.
 *
 * @remarks
 * {@link PnpmWorkspaceFile.write} splices a changed scalar in place keeping its
 * quotes and trailing comment, adds or drops only the items of a primitive
 * list that changed, appends new keys to their mapping, and gives inserted
 * content the style the file already follows (indent width, indented
 * sequences, quote character, quoting by choice). A CRLF file stays CRLF.
 * Canonical order (keys alphabetical by code unit, primitive lists sorted)
 * applies to content written from scratch and to inserted lists, never to what
 * the file already says: an author's key order stands. A source with no
 * mapping to edit, one the editor refuses (multi-document, directives), or an
 * edit that would not parse back to exactly the new value (anchors and
 * aliases, merge keys, colliding keys) is re-rendered whole in its inferred
 * style instead. Discovering the file is not this class's job.
 *
 * @example
 * ```ts
 * import { Result } from "effect";
 * import { PnpmWorkspaceFile } from "@effected/pnpm";
 *
 * const parsed = PnpmWorkspaceFile.parseResult("packages:\n  - pkg/*  # all\n");
 * if (Result.isSuccess(parsed)) {
 *   const text = parsed.success.write({ packages: ["pkg/*"], strictDepBuilds: true });
 *   console.log(text);
 *   // => packages:\n  - pkg/*  # all\nstrictDepBuilds: true\n
 * }
 * ```
 *
 * @public
 */
export class PnpmWorkspaceFile extends Schema.Class<PnpmWorkspaceFile>("PnpmWorkspaceFile")({
	/** The text as read; `write` edits over it. */
	source: Schema.String,
}) {
	/**
	 * The mapping the text holds, derived from `source` once: empty for empty
	 * text, a document that is not a mapping, or text that is not well-formed
	 * YAML (only a file built with `make` can hold such text;
	 * {@link PnpmWorkspaceFile.parseResult} rejects it).
	 */
	get value(): Readonly<Record<string, unknown>> {
		return readMemo(this).value;
	}

	/**
	 * Read `pnpm-workspace.yaml` text, synchronously and without an Effect
	 * runtime.
	 *
	 * @remarks
	 * Empty or whitespace-only text, and a document that is not a mapping,
	 * yield an empty `value`. Malformed YAML fails {@link PnpmWorkspaceFileError};
	 * nothing throws. Effect callers use {@link PnpmWorkspaceFile.parse}, the
	 * spanned form.
	 */
	static parseResult(text: string): Result.Result<PnpmWorkspaceFile, PnpmWorkspaceFileError> {
		const parsed = Yaml.parseResult(text);
		if (Result.isFailure(parsed)) {
			return Result.fail(new PnpmWorkspaceFileError({ reason: "invalid-yaml", cause: parsed.failure }));
		}
		const file = PnpmWorkspaceFile.make({ source: text });
		memo.set(file, { parsed: Option.some(parsed.success), value: mappingCopy(parsed.success) });
		return Result.succeed(file);
	}

	/** {@link PnpmWorkspaceFile.parseResult} as an Effect, behind a `PnpmWorkspaceFile.parse` span. */
	static readonly parse = Effect.fn("PnpmWorkspaceFile.parse")((text: string) =>
		Effect.fromResult(PnpmWorkspaceFile.parseResult(text)),
	);

	/**
	 * Canonical form for deterministic output and diffing: object keys sorted
	 * recursively by code unit (locale-independent); arrays of only primitives
	 * sorted lexicographically; arrays holding objects keep their order.
	 */
	static canonicalize(value: unknown): unknown {
		return canonicalize(value);
	}

	/**
	 * Render a mapping from scratch in canonical order, 2-space, unindented
	 * sequences, single quotes, no line wrapping.
	 *
	 * @remarks
	 * A value with no YAML form (cyclic, nested past 256 levels, holding a
	 * function or symbol) fails {@link PnpmWorkspaceFileError} with reason
	 * `"unrepresentable"`; a bigint, NaN or infinity is representable and
	 * renders. Nothing throws.
	 */
	static renderResult(value: Readonly<Record<string, unknown>>): Result.Result<string, PnpmWorkspaceFileError> {
		return guarded(value, (copy) => renderWorkspace(copy));
	}

	/**
	 * {@link PnpmWorkspaceFile.renderResult} as a plain string.
	 *
	 * @remarks
	 * Throws {@link PnpmWorkspaceFileError} (and nothing else) when the value
	 * has no YAML form.
	 */
	static render(value: Readonly<Record<string, unknown>>): string {
		return Result.getOrThrow(PnpmWorkspaceFile.renderResult(value));
	}

	/**
	 * The stringify options matching the style `source` already follows: indent
	 * width, whether block sequences sit indented under their key, and quote
	 * character.
	 *
	 * @remarks
	 * Lenient: a mixed file takes the dominant spelling, and a dimension with
	 * no votes keeps the default (2-space, unindented, single quotes).
	 */
	static inferStyle(source: string): YamlStringifyOptions {
		return inferStyle(source);
	}

	/**
	 * Write `next` over this file's text as targeted edits.
	 *
	 * @remarks
	 * Text with nothing in it renders from scratch exactly as
	 * {@link PnpmWorkspaceFile.renderResult} does. A `next` with no YAML form
	 * (cyclic, nested past 256 levels, holding a function or symbol) fails
	 * {@link PnpmWorkspaceFileError} with reason `"unrepresentable"`; a bigint,
	 * NaN or infinity is representable and is written. Nothing throws.
	 */
	writeResult(next: Readonly<Record<string, unknown>>): Result.Result<string, PnpmWorkspaceFileError> {
		return writeWorkspace(this.source, readMemo(this).parsed, next);
	}

	/**
	 * {@link PnpmWorkspaceFile.writeResult} as a plain string.
	 *
	 * @remarks
	 * Throws {@link PnpmWorkspaceFileError} (and nothing else) when `next` has
	 * no YAML form.
	 */
	write(next: Readonly<Record<string, unknown>>): string {
		return Result.getOrThrow(this.writeResult(next));
	}
}
