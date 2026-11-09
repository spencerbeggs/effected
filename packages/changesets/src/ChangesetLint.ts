import type {
	LintContext,
	LintDiagnostic,
	LintRule as LintRuleType,
	MarkdownLintOptions,
} from "@effected/markdown-lint";
import { LintRule, MarkdownLint } from "@effected/markdown-lint";
import { readFrontMatter } from "./internal/frontMatter.js";

const RELEASE_TYPES: ReadonlySet<unknown> = new Set(["major", "minor", "patch", "none"]);

const TAGS = ["changeset", "front-matter"] as const;

/** The entries of a front matter `@changesets/parse` accepts; none when it refuses one, which `frontMatter` reports. */
const entriesOf = (context: LintContext) => {
	const read = readFrontMatter(context.source);
	return read.ok ? read.entries : [];
};

const frontMatter = LintRule.make({
	names: ["changeset-front-matter", "CF001"],
	description: "A changeset starts with a front matter block of YAML mapping package names to release types",
	tags: [...TAGS],
	check: (context, report) => {
		const read = readFrontMatter(context.source);
		if (!read.ok) report(context.diagnostic({ at: read.at, detail: read.detail }));
	},
});

const packageName = LintRule.make({
	names: ["changeset-package-name", "CF002"],
	description: "Every front matter key names a package",
	tags: [...TAGS],
	check: (context, report) => {
		for (const entry of entriesOf(context)) {
			if (entry.name.trim() !== "") continue;
			report(
				context.diagnostic({
					at: entry.at,
					detail: `${JSON.stringify(entry.name)} is not a package name: a key must name a package.`,
				}),
			);
		}
	},
});

const releaseType = LintRule.make({
	names: ["changeset-release-type", "CF003"],
	description: "Every front matter value is major, minor, patch or none",
	tags: [...TAGS],
	check: (context, report) => {
		for (const entry of entriesOf(context)) {
			if (RELEASE_TYPES.has(entry.type)) continue;
			report(
				context.diagnostic({
					at: entry.at,
					detail: `${entry.name}: ${JSON.stringify(entry.type) ?? String(entry.type)} is not a release type; use major, minor, patch or none.`,
					context: entry.name,
				}),
			);
		}
	},
});

/**
 * Options for {@link ChangesetLint.lint}: `MarkdownLint`'s parse options,
 * plus the rules to run.
 *
 * @public
 */
export interface ChangesetLintOptions extends MarkdownLintOptions {
	/**
	 * The workspace's package names. When given, the
	 * {@link ChangesetLint.knownPackages} rule runs over them; without them,
	 * a name is never checked against the workspace.
	 */
	readonly packages?: Iterable<string> | undefined;
	/** Rules run after the defaults: a house style's own, for example. */
	readonly rules?: ReadonlyArray<LintRuleType> | undefined;
	/**
	 * The default set to run, replacing {@link ChangesetLint.defaults}; pass
	 * `[]` to run only `rules`.
	 */
	readonly defaults?: ReadonlyArray<LintRuleType> | undefined;
}

/**
 * Lint rules for changeset files that hold under any house style: only what
 * the changesets tool itself refuses a file for, as `@changesets/parse`
 * reads one, plus, when the workspace's names are given, that each named
 * package exists.
 *
 * @remarks
 * Each rule is an `@effected/markdown-lint` `LintRule`, so one definition
 * runs in `MarkdownLint` and, through `MarkdownlintAdapter`, in markdownlint
 * and markdownlint-cli2. A house style (section headings, summary layout)
 * is not here: pass its rules as `rules`, or beside these to
 * `MarkdownlintAdapter.rules`.
 *
 * The rules, named in their own scheme: `CF` for changeset front matter.
 *
 * - `CF001` `changeset-front-matter`: the file is not empty, has a front
 *   matter block between `---` lines, the block is YAML, and a non-empty
 *   value is a mapping. The block is found with `@changesets/parse`'s own
 *   pattern, which allows leading whitespace and does not require the block
 *   at the start of the file.
 * - `CF002` `changeset-package-name`: every key is a package name, which
 *   `@changesets/parse` checks only as not blank, and neither does this: an
 *   npm-name check would refuse files changesets accepts.
 * - `CF003` `changeset-release-type`: every value is `major`, `minor`,
 *   `patch` or `none`.
 * - `CF004` `changeset-known-package`, from
 *   {@link ChangesetLint.knownPackages}: every key names a package of the
 *   workspace. It runs only when the names are given.
 *
 * An empty front matter and an empty summary are both legal: they are what
 * `changeset add --empty` writes. `CF002` to `CF004` read only a front
 * matter `CF001` accepts, so a broken block is reported once.
 * `__test__/ChangesetLint.test.ts` holds the defaults to `@changesets/parse`:
 * a file it parses fails none of them, and a file it refuses fails one.
 *
 * @example
 * ```ts
 * import { MarkdownlintAdapter } from "@effected/markdown-lint";
 * import { ChangesetLint } from "@effected/changesets/lint";
 *
 * // .markdownlint-cli2.mjs
 * export default { customRules: MarkdownlintAdapter.rules(ChangesetLint.defaults) };
 * ```
 *
 * @public
 */
export class ChangesetLint {
	/** `CF001`: a front matter block of YAML, a mapping when not empty. */
	static readonly frontMatter: LintRuleType = frontMatter;
	/** `CF002`: every key names a package. */
	static readonly packageName: LintRuleType = packageName;
	/** `CF003`: every value is a release type. */
	static readonly releaseType: LintRuleType = releaseType;

	/** The default rules, `CF001` to `CF003`, in that order. */
	static readonly defaults: ReadonlyArray<LintRuleType> = [frontMatter, packageName, releaseType];

	/**
	 * `CF004` `changeset-known-package`: every front matter key names one of
	 * `packages`, the workspace's package names.
	 *
	 * @param packages - The workspace's package names.
	 */
	static knownPackages(packages: Iterable<string>): LintRuleType {
		const known = new Set(packages);
		return LintRule.make({
			names: ["changeset-known-package", "CF004"],
			description: "Every front matter key names a package of the workspace",
			tags: [...TAGS],
			check: (context, report) => {
				for (const entry of entriesOf(context)) {
					if (entry.name.trim() === "" || known.has(entry.name)) continue;
					report(
						context.diagnostic({
							at: entry.at,
							detail: `${entry.name} is not a package of this workspace.`,
							context: entry.name,
						}),
					);
				}
			},
		});
	}

	/**
	 * Lint one changeset file's text: `MarkdownLint.lint` over
	 * {@link ChangesetLint.defaults} (or `options.defaults`), then
	 * {@link ChangesetLint.knownPackages} when `options.packages` is given,
	 * then `options.rules`. Line numbers count the whole file, front matter
	 * included.
	 *
	 * @param source - The changeset file's text.
	 * @param options - The rules and the parse options.
	 */
	static lint(source: string, options?: ChangesetLintOptions): ReadonlyArray<LintDiagnostic> {
		const { packages, rules, defaults, ...parse } = options ?? {};
		return MarkdownLint.lint(
			source,
			[
				...(defaults ?? ChangesetLint.defaults),
				...(packages === undefined ? [] : [ChangesetLint.knownPackages(packages)]),
				...(rules ?? []),
			],
			parse,
		);
	}
}
