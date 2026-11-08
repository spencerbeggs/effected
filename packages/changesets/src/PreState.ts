import type { PlatformError } from "effect";
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { ChangesetConfigError } from "./errors.js";

/**
 * The decoded `.changeset/pre.json`: the repository is in pre-release mode
 * (`changeset pre enter <tag>`), or leaving it (`changeset pre exit`).
 *
 * @remarks
 * In `pre` mode a release plan appends `-<tag>.<n>` to every bumped version
 * and leaves out the changesets under `.changeset/pre/`, which an earlier
 * pre-release already consumed. In `exit` mode those changesets count again,
 * no suffix is appended, and every package still on a numbered prerelease
 * bumps at least `patch`. The file's other keys are not kept.
 *
 * @public
 */
export class PreState extends Schema.Class<PreState>("PreState")({
	/** `pre` while pre-releasing, `exit` once `changeset pre exit` has run. */
	mode: Schema.Literals(["pre", "exit"]),
	/** The prerelease tag, such as `next` or `beta`. */
	tag: Schema.String,
	/**
	 * The changesets an earlier pre-release consumed, by id (the file name
	 * without `.md`), as the older `pre.json` layout lists them. The current
	 * layout moves those files into `.changeset/pre/` instead.
	 */
	changesets: Schema.optionalKey(Schema.Array(Schema.String)),
}) {
	/**
	 * Read `<root>/.changeset/pre.json`: `Option.none()` when the repository
	 * is not in pre-release mode.
	 *
	 * Fails with {@link ChangesetConfigError} when the file is not JSON or does
	 * not match the shape. Unlike `@changesets/pre`, it never rewrites an
	 * older-layout file or moves a changeset.
	 *
	 * @param root - The repository root.
	 */
	static readonly read = Effect.fn("PreState.read")(function* (root: string) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const text = yield* fs.readFileString(path.join(root, ".changeset", "pre.json")).pipe(
			Effect.map(Option.some),
			Effect.catch(
				(error): Effect.Effect<Option.Option<string>, PlatformError.PlatformError> =>
					error.reason._tag === "NotFound" ? Effect.succeed(Option.none()) : Effect.fail(error),
			),
		);
		if (Option.isNone(text)) return Option.none<PreState>();
		const json = yield* Effect.try({
			try: () => JSON.parse(text.value) as unknown,
			catch: (cause) => new ChangesetConfigError({ reason: `pre.json is not valid JSON: ${(cause as Error).message}` }),
		});
		const decoded = yield* Schema.decodeUnknownEffect(PreState)(json).pipe(
			Effect.mapError((error) => new ChangesetConfigError({ reason: `pre.json: ${error.message}` })),
		);
		return Option.some(decoded);
	});
}
