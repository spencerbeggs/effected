// The selector grammar of pnpm's `overrides` keys and of
// `peerDependencyRules.allowedVersions` keys. A restatement of
// `pnpm_config_parse_overrides::parse_pkg_and_parent_selector` and
// `parse_wanted_dependency` (pnpm/pnpm, `pnpm/crates/config-parse-overrides`
// and `pnpm/crates/resolving-parse-wanted-dependency`).

import { Option, Result, Schema } from "effect";

/**
 * Why an {@link OverrideKey} could not be parsed.
 *
 * @remarks
 * `"invalid-selector"` — a segment does not resolve to a package name (empty,
 * not a valid name, a range containing `:`, a dependency-type suffix on the
 * parent, a glob or dependency type on an empty-range selector, or more than
 * one `parent>` step). `"empty-range-with-parent"` — a `pkg@` convergence
 * selector beside a parent, which pnpm reserves for standalone selectors.
 *
 * @public
 */
export class OverrideKeyError extends Schema.TaggedError<OverrideKeyError>()("OverrideKeyError", {
	/** The key as supplied. */
	key: Schema.String,
	/** What was wrong with it. */
	reason: Schema.Literals(["invalid-selector", "empty-range-with-parent"]),
}) {
	override get message(): string {
		return this.reason === "invalid-selector"
			? `Cannot parse the "${this.key}" overrides selector`
			: `Cannot use an empty range in the "${this.key}" selector: a convergence selector ("pkg@") cannot be combined with parent>child`;
	}
}

const DEP_TYPES = ["prod", "optional", "peer"] as const;

/** `validate-npm-package-name`'s old-package rule: the name must survive URI encoding unchanged. */
const isValidOldName = (name: string): boolean => {
	if (name.length === 0 || name.trim() !== name) return false;
	if (name.startsWith(".") || name.startsWith("_")) return false;
	if (name === "node_modules" || name === "favicon.ico") return false;
	const safe = (part: string): boolean => part.length > 0 && encodeURIComponent(part) === part;
	if (name.startsWith("@")) {
		const slash = name.indexOf("/");
		if (slash === -1) return false;
		return safe(name.slice(1, slash)) && safe(name.slice(slash + 1));
	}
	return safe(name);
};

/** The `>` that separates parent from child: not preceded by a space, `|` or `@`. */
const findParentDelimiter = (selector: string): number => {
	for (let i = 0; i + 1 < selector.length; i++) {
		const before = selector[i];
		if (before === " " || before === "|" || before === "@") continue;
		if (selector[i + 1] === ">") return i + 1;
	}
	return -1;
};

interface Segment {
	readonly name: string;
	readonly range: Option.Option<string>;
	readonly depType?: (typeof DEP_TYPES)[number];
}

const parseSegment = (raw: string): Segment | undefined => {
	let text = raw.trim();
	let depType: (typeof DEP_TYPES)[number] | undefined;
	for (const candidate of DEP_TYPES) {
		const suffix = `:${candidate}`;
		if (text.endsWith(suffix)) {
			const rest = text.slice(0, -suffix.length);
			if (rest.length > 0 && !rest.endsWith("@")) {
				text = rest;
				depType = candidate;
				break;
			}
		}
	}
	const at = text.indexOf("@", 1);
	const name = at === -1 ? text : text.slice(0, at);
	if (!isValidOldName(name)) return undefined;
	const range = at === -1 ? undefined : text.slice(at + 1);
	if (range?.includes(":")) return undefined;
	return {
		name,
		range: range === undefined ? Option.none() : Option.some(range),
		...(depType === undefined ? {} : { depType }),
	};
};

/**
 * An `overrides` key, or a `peerDependencyRules.allowedVersions` key: an
 * optional parent package and the target package, each a name with an optional
 * version range.
 *
 * @remarks
 * The grammar is pnpm's: `name`, `name@range`, `parent>name`,
 * `parent@range>name@range`, with an optional `:prod`, `:optional` or `:peer`
 * suffix on the target and surrounding whitespace trimmed. The parent delimiter
 * is the first `>` not preceded by a space, `|` or `@`, so a range operator
 * (`bar@>=1>foo`) never splits. A segment's name is a valid npm package name or
 * a glob over one; a range is carried as written. An empty range (`pkg@`) is
 * pnpm's convergence selector and is kept as `Option.some("")`.
 *
 * pnpm splits at the first delimiter only, so a path holds one segment or two;
 * `a>b>c` does not parse. `path` is parent first, target last. For
 * `allowedVersions`, the key `react` names the peer alone and `parent>peer`
 * names a declaring package; this class reads both shapes.
 *
 * @example
 * ```ts
 * import { OverrideKey } from "@effected/pnpm";
 * import { Result } from "effect";
 *
 * const key = OverrideKey.parse("@s/a@1>@s/b");
 * console.log(Result.isSuccess(key) && key.success.format());
 * // => @s/a@1>@s/b
 * ```
 *
 * @public
 */
export class OverrideKey extends Schema.Class<OverrideKey>("OverrideKey")({
	/** The selector segments, parent first and target last. */
	path: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			range: Schema.Option(Schema.String),
			depType: Schema.optionalKey(Schema.Literals(DEP_TYPES)),
		}),
	),
}) {
	/**
	 * Parse one key.
	 *
	 * @param key - The key as written in the settings.
	 * @returns The structured key, or an `OverrideKeyError` naming the reason.
	 */
	static parse(key: string): Result.Result<OverrideKey, OverrideKeyError> {
		const trimmed = key.trim();
		const fail = (reason: OverrideKeyError["reason"]) => Result.fail(new OverrideKeyError({ key, reason }));
		const delimiter = findParentDelimiter(trimmed);
		const parts = delimiter === -1 ? [trimmed] : [trimmed.slice(0, delimiter), trimmed.slice(delimiter + 1)];
		const segments: Array<Segment> = [];
		for (const part of parts) {
			const segment = parseSegment(part);
			if (segment === undefined) return fail("invalid-selector");
			segments.push(segment);
		}
		const target = segments[segments.length - 1] as Segment;
		const parent = segments.length === 2 ? segments[0] : undefined;
		if (parent !== undefined && parent.depType !== undefined) return fail("invalid-selector");
		const emptyRange = (segment: Segment | undefined): boolean =>
			segment !== undefined && Option.isSome(segment.range) && segment.range.value === "";
		if (parent !== undefined && (emptyRange(parent) || emptyRange(target))) return fail("empty-range-with-parent");
		if (emptyRange(target) && (target.name.includes("*") || target.depType !== undefined)) {
			return fail("invalid-selector");
		}
		return Result.succeed(OverrideKey.make({ path: segments }));
	}

	/** The dependency the key targets: the last segment. */
	get target(): this["path"][number] {
		return this.path[this.path.length - 1] as this["path"][number];
	}

	/** The declaring package of a `parent>target` key, when there is one. */
	get parent(): Option.Option<this["path"][number]> {
		return this.path.length > 1 ? Option.some(this.path[0] as this["path"][number]) : Option.none();
	}

	/** The key in its canonical spelling; `parse` of it yields an equal key. */
	format(): string {
		return this.path
			.map(
				(segment) =>
					`${segment.name}${Option.isSome(segment.range) ? `@${segment.range.value}` : ""}${segment.depType === undefined ? "" : `:${segment.depType}`}`,
			)
			.join(">");
	}
}
