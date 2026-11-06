import type { PlatformError } from "effect";
import { Effect, FileSystem, Path, Schema } from "effect";
import { ChangesetConfigError, UnsupportedChangesetModeError } from "./errors.js";

const Groups = Schema.Array(Schema.Array(Schema.String));

/**
 * The decoded `.changeset/config.json`, with the defaults changesets
 * documents. Keys the schema does not model (`changelog`, `$schema`,
 * `format`, ...) are kept on the instance rather than rejected.
 *
 * @public
 */
export class ChangesetConfig extends Schema.Class<ChangesetConfig>("ChangesetConfig")({
	/** The branch releases are cut against. Defaults to `main`. */
	baseBranch: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed("main"))),
	/** Groups of packages that always release together at one version. */
	fixed: Groups.pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
	/** Groups of packages whose versions are kept in step. */
	linked: Groups.pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
	/** Packages that never release. */
	ignore: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
	/** The bump a dependent receives when an internal dependency bumps. */
	updateInternalDependencies: Schema.Literals(["patch", "minor"]).pipe(
		Schema.withDecodingDefaultKey(Effect.succeed("patch" as const)),
	),
	/** Whether private packages are tagged and versioned. */
	privatePackages: Schema.Struct({
		tag: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
		version: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
	}).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
	/** The publish access level. Defaults to `restricted`. */
	access: Schema.Literals(["public", "restricted"]).pipe(
		Schema.withDecodingDefaultKey(Effect.succeed("restricted" as const)),
	),
	/** `false`, `true` or a commit-message generator spec; carried as-is. */
	commit: Schema.Unknown.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
	/**
	 * Every key of the file the schema does not model, such as `changelog` or
	 * `$schema`. A file key literally named `extra` is not carried: the field
	 * name is reserved.
	 */
	extra: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
}) {
	/**
	 * Read and decode `<root>/.changeset/config.json`.
	 *
	 * Fails with {@link ChangesetConfigError} when the file is missing
	 * (`reason: "missing"`), is not JSON, or has a malformed value, and with
	 * {@link UnsupportedChangesetModeError} when `.changeset/pre.json` exists.
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
		if (yield* fs.exists(path.join(dir, "pre.json"))) {
			return yield* new UnsupportedChangesetModeError({ mode: "pre" });
		}
		const json = yield* Effect.try({
			try: () => JSON.parse(text) as unknown,
			catch: (cause) => new ChangesetConfigError({ reason: `not valid JSON: ${(cause as Error).message}` }),
		});
		const decoded = yield* Schema.decodeUnknownEffect(ChangesetConfig)(json).pipe(
			Effect.mapError((error) => new ChangesetConfigError({ reason: error.message })),
		);
		const known = new Set(Object.keys(ChangesetConfig.fields));
		const extra = Object.fromEntries(
			Object.entries(json as Record<string, unknown>).filter(([key]) => !known.has(key)),
		);
		return ChangesetConfig.make({ ...decoded, extra });
	});
}
