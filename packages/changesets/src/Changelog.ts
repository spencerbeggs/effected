import type { WorkspacePackage } from "@effected/workspaces";
import { Effect, Option, Schema } from "effect";
import type { ChangesetConfig } from "./ChangesetConfig.js";
import { ChangesetConfigError, MissingPackageError } from "./errors.js";
import { causeMessage } from "./internal/causeMessage.js";
import { WORKSPACE, parseRange, shouldUpdate } from "./internal/versions.js";
import type { PendingChangeset } from "./PendingChangesets.js";
import type { PlannedRelease, ReleasePlan } from "./ReleasePlan.js";

// The contract's data shapes are schemas, so a caller can decode what a
// changelog module is handed. They are Structs, not Classes: the contract is
// structural, and @changesets hands a module plain objects. Every field is a
// mutableKey and every array mutable, because @changesets/types declares
// them mutable, and a ReadonlyArray is not assignable to a string[].

/**
 * A bump as a changelog module receives it: `@changesets/types`'
 * `VersionType`.
 *
 * @public
 */
export const VersionType = Schema.Literals(["major", "minor", "patch", "none"]).annotate({
	identifier: "VersionType",
	description: "A bump as a changelog module receives it",
});

/**
 * The decoded type of {@link (VersionType:variable)}.
 *
 * @public
 */
export type VersionType = typeof VersionType.Type;

/**
 * A changeset as a changelog module receives it: `@changesets/types`'
 * `NewChangeset`. `id` is the file name without `.md` (`pre/<name>` for one
 * under `.changeset/pre/`), and `summary` is the text after the front matter,
 * trimmed.
 *
 * @public
 */
export const NewChangeset = Schema.Struct({
	summary: Schema.mutableKey(Schema.String),
	releases: Schema.mutableKey(
		Schema.mutable(
			Schema.Array(Schema.Struct({ name: Schema.mutableKey(Schema.String), type: Schema.mutableKey(VersionType) })),
		),
	),
	id: Schema.mutableKey(Schema.String),
}).annotate({ identifier: "NewChangeset", description: "A changeset as a changelog module receives it" });

/**
 * The decoded type of {@link (NewChangeset:variable)}.
 *
 * @public
 */
export type NewChangeset = typeof NewChangeset.Type;

/**
 * {@link (NewChangeset:variable)} with the commit that added the file, when the caller
 * supplied one: `@changesets/types`' `NewChangesetWithCommit`.
 *
 * @public
 */
export const NewChangesetWithCommit = Schema.Struct({
	...NewChangeset.fields,
	commit: Schema.mutableKey(Schema.optionalKey(Schema.String)),
}).annotate({
	identifier: "NewChangesetWithCommit",
	description: "A changeset as a changelog module receives it, with the commit that added it",
});

/**
 * The decoded type of {@link (NewChangesetWithCommit:variable)}.
 *
 * @public
 */
export type NewChangesetWithCommit = typeof NewChangesetWithCommit.Type;

const releaseFields = {
	name: Schema.mutableKey(Schema.String),
	changesets: Schema.mutableKey(Schema.mutable(Schema.Array(Schema.String))),
};
const bumpedFields = {
	...releaseFields,
	oldVersion: Schema.mutableKey(Schema.String),
	newVersion: Schema.mutableKey(Schema.String),
};
const noneFields = {
	...releaseFields,
	type: Schema.mutableKey(Schema.Literal("none")),
	oldVersion: Schema.mutableKey(Schema.UndefinedOr(Schema.String)),
	newVersion: Schema.mutableKey(Schema.UndefinedOr(Schema.String)),
};

/**
 * A planned release as a changelog module receives one:
 * `@changesets/types`' `ComprehensiveRelease`. `changesets` holds ids, as
 * {@link (NewChangeset:variable)} does. Only a `none` entry may lack its versions.
 *
 * @public
 */
export const ComprehensiveRelease = Schema.Union([
	Schema.Struct({ ...bumpedFields, type: Schema.mutableKey(Schema.Literal("major")) }),
	Schema.Struct({ ...bumpedFields, type: Schema.mutableKey(Schema.Literal("minor")) }),
	Schema.Struct({ ...bumpedFields, type: Schema.mutableKey(Schema.Literal("patch")) }),
	Schema.Struct(noneFields),
]).annotate({
	identifier: "ComprehensiveRelease",
	description: "A planned release as a changelog module receives one",
});

/**
 * The decoded type of {@link (ComprehensiveRelease:variable)}.
 *
 * @public
 */
export type ComprehensiveRelease = typeof ComprehensiveRelease.Type;

const dependencyMap = Schema.mutableKey(Schema.optionalKey(Schema.Record(Schema.String, Schema.String)));

/**
 * A manifest as a changelog module receives one: `@changesets/types`'
 * `PackageJSON`. It is open: a key it does not name decodes and is kept,
 * because a manifest carries far more than these, and a module may read any
 * of them. `publishConfig` is open the same way for its `<scope>:registry`
 * keys.
 *
 * @public
 */
export const PackageJSON = Schema.StructWithRest(
	Schema.Struct({
		name: Schema.mutableKey(Schema.String),
		version: Schema.mutableKey(Schema.String),
		dependencies: dependencyMap,
		peerDependencies: dependencyMap,
		devDependencies: dependencyMap,
		optionalDependencies: dependencyMap,
		resolutions: dependencyMap,
		private: Schema.mutableKey(Schema.optionalKey(Schema.Boolean)),
		publishConfig: Schema.mutableKey(
			Schema.optionalKey(
				Schema.StructWithRest(
					Schema.Struct({
						access: Schema.mutableKey(Schema.optionalKey(Schema.Literals(["public", "restricted"]))),
						directory: Schema.mutableKey(Schema.optionalKey(Schema.String)),
						registry: Schema.mutableKey(Schema.optionalKey(Schema.String)),
					}),
					[Schema.Record(Schema.TemplateLiteral([Schema.String, ":registry"]), Schema.String)],
				),
			),
		),
	}),
	[Schema.Record(Schema.String, Schema.Unknown)],
).annotate({ identifier: "PackageJSON", description: "A manifest as a changelog module receives one" });

/**
 * The decoded type of {@link (PackageJSON:variable)}.
 *
 * @public
 */
export type PackageJSON = typeof PackageJSON.Type;

const withPackage = {
	packageJson: Schema.mutableKey(PackageJSON),
	dir: Schema.mutableKey(Schema.String),
	relativeDir: Schema.mutableKey(Schema.optionalKey(Schema.String)),
};

/**
 * A release with its package, as `getDependencyReleaseLine` receives the
 * dependencies a package's release updated: `@changesets/types`'
 * `ModCompWithPackage`. `dir` is the package's absolute directory.
 *
 * `relativeDir`, the directory relative to the workspace root, is optional
 * here and absent from `@changesets/types`' type, but `apply-release-plan`
 * passes it and so does {@link Changelog.entry}, so it is modelled and a
 * decode keeps it. An optional extra key leaves the two types mutually
 * assignable. Other unknown keys are dropped: this schema cannot be open the
 * way {@link (PackageJSON:variable)} is, because `@changesets/types` declares these
 * members as interfaces, which are not assignable to an index signature.
 *
 * @public
 */
export const ModCompWithPackage = Schema.Union([
	Schema.Struct({ ...bumpedFields, type: Schema.mutableKey(Schema.Literal("major")), ...withPackage }),
	Schema.Struct({ ...bumpedFields, type: Schema.mutableKey(Schema.Literal("minor")), ...withPackage }),
	Schema.Struct({ ...bumpedFields, type: Schema.mutableKey(Schema.Literal("patch")), ...withPackage }),
	Schema.Struct({ ...noneFields, ...withPackage }),
]).annotate({
	identifier: "ModCompWithPackage",
	description: "A release with its package, as a changelog module receives one",
});

/**
 * The decoded type of {@link (ModCompWithPackage:variable)}.
 *
 * @public
 */
export type ModCompWithPackage = typeof ModCompWithPackage.Type;

/**
 * Renders one changeset's line in a package's changelog block:
 * `@changesets/types`' `GetReleaseLine`.
 *
 * @public
 */
export type GetReleaseLine = (
	changeset: NewChangesetWithCommit,
	type: VersionType,
	changelogOpts: null | Record<string, unknown>,
) => string | Promise<string>;

/**
 * Renders the line for the dependencies a package's release updated:
 * `@changesets/types`' `GetDependencyReleaseLine`.
 *
 * @public
 */
export type GetDependencyReleaseLine = (
	changesets: NewChangesetWithCommit[],
	dependenciesUpdated: ModCompWithPackage[],
	changelogOpts: null | Record<string, unknown>,
) => string | Promise<string>;

/**
 * A changelog module: `@changesets/types`' `ChangelogFunctions`,
 * structurally identical, so one module loads under `@changesets/cli` and
 * here alike. `__test__/Changelog.types.test.ts` holds the identity both ways.
 * Functions are not schemas; their parameters are the schema types above.
 *
 * @public
 */
// biome-ignore lint/style/useConsistentTypeDefinitions: a type alias, as @changesets/types declares it, so a value stays assignable to Record<string, unknown>; an interface is not
export type ChangelogFunctions = {
	getReleaseLine: GetReleaseLine;
	getDependencyReleaseLine: GetDependencyReleaseLine;
};

/**
 * A changelog module's function threw or rejected while rendering a
 * package's block.
 *
 * @public
 */
export class ChangelogError extends Schema.TaggedError<ChangelogError>()("ChangelogError", {
	/** The package whose block was being rendered. */
	packageName: Schema.String,
	/** What the module threw. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		const detail = causeMessage(this.cause);
		return `The changelog functions failed for ${this.packageName}${detail === undefined ? "" : `: ${detail}`}`;
	}
}

/**
 * The inputs {@link Changelog.entry} reads besides the plan and the release.
 *
 * @public
 */
export interface ChangelogEntryOptions {
	/** Every package of the workspace, as given to {@link ReleasePlan.edits}. */
	readonly packages: ReadonlyArray<WorkspacePackage>;
	/** The config the plan was made with. */
	readonly config: ChangesetConfig;
	/**
	 * The commit that added each changeset, keyed by the changeset's `file`
	 * as {@link PendingChangeset} names it. A changeset with none is passed
	 * with no `commit`. Finding them (`changeset version` asks git) is the
	 * caller's job.
	 */
	readonly commits?: ReadonlyMap<string, string> | undefined;
	/**
	 * The options passed to each function as `changelogOpts`. Defaults to the
	 * second element of `config.changelog` when it is a pair, else `null`.
	 */
	readonly changelogOptions?: null | Record<string, unknown> | undefined;
}

const toNewChangeset = (changeset: PendingChangeset, commit: string | undefined): NewChangesetWithCommit => ({
	id: changeset.id,
	summary: changeset.summary.trim(),
	releases: [...changeset.releases].map(([name, type]) => ({ name, type })),
	...(commit === undefined ? {} : { commit }),
});

const nonEmpty = (map: Readonly<Record<string, string>>): { [key: string]: string } | undefined =>
	Object.keys(map).length > 0 ? { ...map } : undefined;

/**
 * The manifest a module is handed: discovery's `manifestRecord`, the whole
 * `package.json` as read, copied so a module that writes to it cannot reach
 * the `WorkspacePackage`. A package built without a record (by hand, not by
 * discovery) has nothing more than its typed fields, so it gets those.
 */
const toPackageJson = (pkg: WorkspacePackage): PackageJSON => {
	if (Object.keys(pkg.manifestRecord).length > 0) return structuredClone(pkg.manifestRecord) as PackageJSON;
	const fields: PackageJSON = { name: pkg.name, version: pkg.version ?? "" };
	for (const kind of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const) {
		const map = nonEmpty(pkg[kind]);
		if (map !== undefined) fields[kind] = map;
	}
	if (pkg.private) fields.private = true;
	if (pkg.publishConfig !== undefined)
		fields.publishConfig = { ...pkg.publishConfig } as NonNullable<PackageJSON["publishConfig"]>;
	return fields;
};

const toComprehensive = (release: PlannedRelease): ComprehensiveRelease =>
	({
		name: release.name,
		type: release.type,
		changesets: [...release.changesets],
		oldVersion: release.oldVersion,
		newVersion: release.newVersion,
	}) as ComprehensiveRelease;

const capitalize = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** `apply-release-plan`'s `generateMarkdownForVersionType`. */
const section = (type: "major" | "minor" | "patch", lines: ReadonlyArray<string>): string | undefined => {
	// Truthy, as the oracle filters: a module returning nothing drops out too.
	const kept = lines.filter((line) => Boolean(line));
	if (kept.length === 0) return undefined;
	let content = `### ${capitalize(type)} Changes`;
	let newLines = 2;
	for (const line of kept) {
		newLines += line.match(/^\n*/)?.[0].length ?? 0;
		content += "\n".repeat(Math.min(Math.max(newLines, 1), 2)) + line.trim();
		newLines = line.match(/\n*$/)?.[0].length ?? 0;
	}
	return content;
};

const changelogOptionsOf = (
	options: ChangelogEntryOptions,
): Effect.Effect<null | Record<string, unknown>, ChangesetConfigError> => {
	if (options.changelogOptions !== undefined) return Effect.succeed(options.changelogOptions);
	const changelog = options.config.changelog;
	if (typeof changelog !== "object") return Effect.succeed(null);
	const value = changelog[1];
	if (value === null) return Effect.succeed(null);
	if (typeof value === "object") return Effect.succeed(value as Record<string, unknown>);
	return Effect.fail(new ChangesetConfigError({ reason: "changelog options must be an object or null" }));
};

const unsafeOption = (config: ChangesetConfig, key: string): unknown => {
	const options = config.extra.___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH;
	return typeof options === "object" && options !== null ? (options as Record<string, unknown>)[key] : undefined;
};

/**
 * CHANGELOG assembly for a {@link ReleasePlan}, matching
 * `@changesets/apply-release-plan`.
 *
 * @remarks
 * This package never loads a changelog module. The caller resolves and
 * imports the module `config.changelog` names (or any other) and passes its
 * {@link ChangelogFunctions}; formatting the result (`changeset version`
 * runs prettier or another formatter over it) and writing the file are the
 * caller's too.
 *
 * Neither function reads `config.changelog` to decide whether to run:
 * {@link Changelog.entry} renders whatever functions it is given. A caller
 * whose config says `changelog: false` writes no changelog, as
 * `changeset version` writes none, and so does not call it.
 *
 * @public
 */
export class Changelog {
	/**
	 * Render `release`'s changelog block, the text `changeset version` inserts
	 * into its `CHANGELOG.md`: `Option.none()` for a `none` entry, which gets
	 * no block.
	 *
	 * As `apply-release-plan`'s `getChangelogEntry` does:
	 *
	 * - Each changeset in the plan naming the package with a real bump gets
	 *   `getReleaseLine`, under that bump's heading, in the plan's changeset
	 *   order.
	 * - `getDependencyReleaseLine` is called once, always, and its line goes
	 *   last under `Patch Changes`. It gets the plan's releases (`none`
	 *   entries included) that the package's `dependencies` (else
	 *   `peerDependencies`) range would be updated for, by the rule
	 *   {@link ReleasePlan.edits} applies, with a `workspace:` path counting
	 *   when it points at the dependency, and the changesets behind them.
	 * - The block is `## <newVersion>` then `### Major Changes`,
	 *   `### Minor Changes` and `### Patch Changes`, each only when it has a
	 *   non-empty line, blank-line separated; a line's own leading and
	 *   trailing newlines widen the gap to it, up to one blank line. With no
	 *   lines at all the block is `## <newVersion>` and
	 *   `No changes in this release.`
	 * - Every function is called before any is awaited, as the oracle calls
	 *   them.
	 *
	 * A module's `packageJson` is the dependency's whole manifest as
	 * discovery read it (`WorkspacePackage.manifestRecord`), before this
	 * release's version, as the oracle passes it.
	 *
	 * Difference, ruled: a changeset with no commit in `options.commits` has
	 * no `commit` key, where the oracle sets it to `undefined`.
	 *
	 * Fails with {@link ChangelogError} when a function throws or rejects,
	 * with {@link MissingPackageError} when a release names a package
	 * `options.packages` lacks, and with {@link ChangesetConfigError} when
	 * the options element of `config.changelog` is neither an object nor
	 * `null` and no `changelogOptions` override is given.
	 *
	 * @param plan - The plan the release belongs to.
	 * @param release - The release whose block to render.
	 * @param functions - The changelog module.
	 * @param options - The workspace's packages, the config, the commits and
	 * the module's options.
	 */
	static readonly entry = Effect.fn("Changelog.entry")(function* (
		plan: ReleasePlan,
		release: PlannedRelease,
		functions: ChangelogFunctions,
		options: ChangelogEntryOptions,
	) {
		if (release.type === "none") return Option.none<string>();
		const changelogOpts = yield* changelogOptionsOf(options);
		const byName = new Map(options.packages.map((pkg) => [pkg.name, pkg]));
		const packageOf = (name: string): Effect.Effect<WorkspacePackage, MissingPackageError> => {
			const pkg = byName.get(name);
			return pkg === undefined ? Effect.fail(new MissingPackageError({ packageName: name })) : Effect.succeed(pkg);
		};
		const pkg = yield* packageOf(release.name);
		const changesets = plan.changesets.map((changeset) =>
			toNewChangeset(changeset, options.commits?.get(changeset.file)),
		);
		const rule = {
			minimum: options.config.updateInternalDependencies,
			onlyPeersOutOfRange: unsafeOption(options.config, "onlyUpdatePeerDependentsWhenOutOfRange") === true,
		};

		const updated: Array<ModCompWithPackage> = [];
		for (const dependency of plan.releases) {
			const fromDependencies = Object.hasOwn(pkg.dependencies, dependency.name)
				? pkg.dependencies[dependency.name]
				: undefined;
			const fromPeers = Object.hasOwn(pkg.peerDependencies, dependency.name)
				? pkg.peerDependencies[dependency.name]
				: undefined;
			const range = fromDependencies || fromPeers;
			if (range === undefined || range === "") continue;
			if (!WORKSPACE.test(range) && parseRange(range) === undefined) continue;
			const dependencyPackage = yield* packageOf(dependency.name);
			const kind = fromDependencies ? "dependencies" : "peerDependencies";
			if (!shouldUpdate(dependency, range, kind, rule, dependencyPackage.relativePath)) continue;
			updated.push({
				...toComprehensive(dependency),
				packageJson: toPackageJson(dependencyPackage),
				dir: dependencyPackage.path,
				relativeDir: dependencyPackage.relativePath,
			} as ModCompWithPackage);
		}
		const behind = new Set(updated.flatMap((dependency) => dependency.changesets));

		const pending: Record<"major" | "minor" | "patch", Array<Promise<string>>> = { major: [], minor: [], patch: [] };
		yield* Effect.try({
			try: () => {
				for (const changeset of changesets) {
					const type = changeset.releases.find((r) => r.name === release.name)?.type;
					if (type === undefined || type === "none") continue;
					pending[type].push(Promise.resolve(functions.getReleaseLine(changeset, type, changelogOpts)));
				}
				pending.patch.push(
					Promise.resolve(
						functions.getDependencyReleaseLine(
							changesets.filter((changeset) => behind.has(changeset.id)),
							updated,
							changelogOpts,
						),
					),
				);
			},
			catch: (cause) => new ChangelogError({ packageName: release.name, cause }),
		});
		const lines = yield* Effect.tryPromise({
			try: async () => ({
				major: await Promise.all(pending.major),
				minor: await Promise.all(pending.minor),
				patch: await Promise.all(pending.patch),
			}),
			catch: (cause) => new ChangelogError({ packageName: release.name, cause }),
		});
		const rendered = [
			`## ${release.newVersion}`,
			section("major", lines.major),
			section("minor", lines.minor),
			section("patch", lines.patch),
		].filter((line): line is string => line !== undefined);
		if (rendered.length === 1) rendered.push("No changes in this release.");
		return Option.some(rendered.join("\n\n"));
	});

	/**
	 * Insert a block from {@link Changelog.entry} into a `CHANGELOG.md`'s
	 * text, as `apply-release-plan`'s `updateChangelog` does, and return the
	 * new text.
	 *
	 * - An empty `existing` (pass `""` for a file that does not exist) becomes
	 *   `# <packageName>`, a blank line, and the block.
	 * - Otherwise the block goes before the first version heading (a `#` to
	 *   `######` heading starting with `<n>.<n>`), followed by a blank line.
	 * - A file with no version heading gets the block after its first line,
	 *   which is where `# <packageName>` sits in a file changesets started;
	 *   a one-line file gets it appended.
	 *
	 * The block is trimmed and ends with one newline.
	 *
	 * @param existing - The changelog's current text, or `""`.
	 * @param block - The block to insert.
	 * @param packageName - The package name, for a new file's heading.
	 */
	static insert(existing: string, block: string, packageName: string): string {
		const template = `\n\n${block.trim()}\n`;
		if (existing === "") return `# ${packageName}${template}`;
		const firstVersion = existing.search(/^#{1,6}\s+\d+\.\d+/m);
		if (firstVersion >= 0) {
			return `${existing.slice(0, firstVersion)}${template.trimStart()}\n${existing.slice(firstVersion)}`;
		}
		const newline = existing.indexOf("\n");
		return newline === -1
			? existing + template
			: `${existing.slice(0, newline)}${template}${existing.slice(newline + 1)}`;
	}
}
