import type { PlatformError } from "effect";
import { Effect, FileSystem, Path, Schema, SchemaGetter } from "effect";
import { ChangesetConfigError } from "./errors.js";

const Groups = Schema.Array(Schema.Array(Schema.String));

const ChangelogPair = Schema.Tuple([Schema.String, Schema.Unknown]);

/**
 * `@changesets/config` validates the tuple with valibot's `tuple`, which
 * ignores elements past the second, so a longer array decodes to its first
 * two rather than failing.
 */
const Changelog = Schema.Union([
	Schema.Literal(false),
	Schema.String,
	Schema.TupleWithRest(ChangelogPair, [Schema.Unknown]).pipe(
		Schema.decodeTo(ChangelogPair, {
			decode: SchemaGetter.transform((tuple) => [tuple[0], tuple[1]] as const),
			encode: SchemaGetter.transform((pair) => pair),
		}),
	),
]);

const snapshotDefaults = { useCalculatedVersion: false } as const;

const Snapshot = Schema.Struct({
	useCalculatedVersion: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
	prereleaseTemplate: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
});

/**
 * The two shapes `@changesets/config` accepts that the class schema alone
 * would not: the boolean `privatePackages`, which sets both flags, and an
 * array `snapshot`, which valibot's `object` admits and reads as no keys set.
 */
const normalizeWritten = (json: unknown): unknown => {
	if (json === null || typeof json !== "object") return json;
	const written = json as Record<string, unknown>;
	const flag = written.privatePackages;
	return {
		...written,
		...(typeof flag === "boolean" ? { privatePackages: { tag: flag, version: flag } } : {}),
		...(Array.isArray(written.snapshot) ? { snapshot: {} } : {}),
	};
};

/**
 * The decoded `.changeset/config.json`, with the defaults changesets
 * documents. Keys the schema does not model (`$schema`, `format`,
 * `changedFilePatterns`, ...) are kept on `extra` rather than rejected.
 *
 * @public
 */
export class ChangesetConfig extends Schema.Class<ChangesetConfig>("ChangesetConfig")({
	/** The branch releases are cut against. Defaults to `main`. */
	baseBranch: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed("main"))),
	/**
	 * Groups of packages that always release together at one version: when
	 * one bumps, every member does, by the group's highest bump, from the
	 * group's highest current version. Entries are globs over the
	 * workspace's names, with `!` negation applying in order.
	 */
	fixed: Groups.pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
	/**
	 * Groups of packages whose versions are kept in step: the members that
	 * release take the group's highest bump from its highest current version,
	 * and members with nothing to release stay out. Entries are globs, as in
	 * `fixed`.
	 */
	linked: Groups.pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
	/**
	 * Packages that never bump: globs over the workspace's package names, with
	 * `!` negation applying in order. A release plan can still list a matching
	 * package as `none` when it depends on something in the plan.
	 */
	ignore: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
	/**
	 * The smallest bump for which `changeset version` rewrites an internal
	 * dependency range. It is not the bump a dependent receives: a release plan
	 * always bumps a dependent `patch`.
	 */
	updateInternalDependencies: Schema.Literals(["patch", "minor"]).pipe(
		Schema.withDecodingDefaultKey(Effect.succeed("patch" as const)),
	),
	/**
	 * Whether private packages are tagged and versioned. Both default to `false`,
	 * as `@changesets/config` has them, so a private package releases only when
	 * the file opts in. {@link ChangesetConfig.read} also takes the boolean form,
	 * which sets both.
	 */
	privatePackages: Schema.Struct({
		tag: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
		version: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
	}).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
	/** The publish access level. Defaults to `restricted`. */
	access: Schema.Literals(["public", "restricted"]).pipe(
		Schema.withDecodingDefaultKey(Effect.succeed("restricted" as const)),
	),
	/** `false`, `true` or a commit-message generator spec; carried as-is. */
	commit: Schema.Unknown.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
	/**
	 * The changelog generator, as the file writes it: `false` for none, a
	 * module id, or a `[moduleId, options]` pair. Defaults to
	 * `"@changesets/cli/changelog"`, the written default `@changesets/config`
	 * fills in.
	 *
	 * It is kept as written, not normalised: `@changesets/config` turns a bare
	 * id into `[id, null]`, and a caller wanting that form maps the string
	 * itself. Resolving and loading the module is the caller's job; this
	 * package only names it.
	 *
	 * Decoding accepts every shape `@changesets/config` accepts. A tuple longer
	 * than two keeps its first two elements, as the oracle does. The options
	 * element is carried as `unknown`, so a non-object there decodes here
	 * though the oracle rejects it: validating the options is the generator's
	 * concern.
	 */
	changelog: Changelog.pipe(
		Schema.withDecodingDefaultKey(Effect.succeed("@changesets/cli/changelog")),
		Schema.withConstructorDefault(Effect.succeed("@changesets/cli/changelog")),
	),
	/**
	 * Options for `changeset version --snapshot`.
	 *
	 * - `useCalculatedVersion` bases a snapshot version on the version the plan
	 *   calculates rather than `0.0.0`. Defaults to `false`.
	 * - `prereleaseTemplate` replaces the default `<tag>-<datetime>` suffix.
	 *   It may use `{tag}`, `{commit}`, `{commit-short}`, `{timestamp}` and `{datetime}`. Absent
	 *   when the file sets none, which is also `@changesets/config`'s default;
	 *   an empty string is rejected, as the oracle rejects it.
	 *
	 * Defaults to `{ useCalculatedVersion: false }`.
	 */
	snapshot: Snapshot.pipe(
		Schema.withDecodingDefaultKey(Effect.succeed(snapshotDefaults)),
		Schema.withConstructorDefault(Effect.succeed(snapshotDefaults)),
	),
	/**
	 * Every key of the file the schema does not model, such as `$schema` or
	 * `format`. A file key literally named `extra` is not carried: the field
	 * name is reserved.
	 */
	extra: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
}) {
	/**
	 * Read and decode `<root>/.changeset/config.json`.
	 *
	 * Fails with {@link ChangesetConfigError} when the file is missing
	 * (`reason: "missing"`), is not JSON, or has a malformed value. Whether the
	 * repository is in pre-release mode is `.changeset/pre.json`, which
	 * {@link PreState.read} reads.
	 *
	 * @param root - The repository root.
	 */
	static readonly read = Effect.fn("ChangesetConfig.read")(function* (root: string) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const dir = path.join(root, ".changeset");
		const text = yield* fs
			.readFileString(path.join(dir, "config.json"))
			.pipe(
				Effect.catch(
					(error): Effect.Effect<never, ChangesetConfigError | PlatformError.PlatformError> =>
						error.reason._tag === "NotFound"
							? Effect.fail(new ChangesetConfigError({ reason: "missing" }))
							: Effect.fail(error),
				),
			);
		const json = yield* Effect.try({
			try: () => JSON.parse(text) as unknown,
			catch: (cause) => new ChangesetConfigError({ reason: `not valid JSON: ${(cause as Error).message}` }),
		});
		const decoded = yield* Schema.decodeUnknownEffect(ChangesetConfig)(normalizeWritten(json)).pipe(
			Effect.mapError((error) => new ChangesetConfigError({ reason: error.message })),
		);
		const known = new Set(Object.keys(ChangesetConfig.fields));
		const extra = Object.fromEntries(
			Object.entries(json as Record<string, unknown>).filter(([key]) => !known.has(key)),
		);
		return ChangesetConfig.make({ ...decoded, extra });
	});
}
