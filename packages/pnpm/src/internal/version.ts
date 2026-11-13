import { LockfileDocumentError } from "@effected/npm";
import { Effect, Schema } from "effect";

/**
 * The lowest pnpm `lockfileVersion` read. Older lockfiles record resolution
 * inline in `packages:` with no `snapshots:` section, a shape not modeled.
 *
 * @internal
 */
export const MINIMUM_PNPM_LOCKFILE_VERSION = 9;

/**
 * The version gate's own input: `lockfileVersion` and nothing else.
 *
 * The gate reads the version *before* the shape decode, because the shape it
 * decodes against is the shape of a supported version. `importers` is a
 * required key and a pre-v9 single-project lockfile has none, so a shape-first
 * order would report a lockfile rejected for being too old as malformed.
 *
 * @internal
 */
const VersionProbe = Schema.Struct({
	lockfileVersion: Schema.Union([Schema.String, Schema.Number]),
});

/**
 * A located pnpm document's schema failure as the document error's `shape`
 * reason.
 *
 * @internal
 */
export const shapeFailure = (cause: unknown): LockfileDocumentError =>
	LockfileDocumentError.make({ format: "pnpm", reason: "shape", cause });

/**
 * Gate a located pnpm document (lockfile or env preamble) on its format
 * version. A version that is not a number at all (`"next"`) is not a
 * supported version either. Call it BEFORE the shape decode.
 *
 * Succeeds with the gated version as the recorded value spelled as a string.
 *
 * @internal
 */
export const gatePnpmVersion = (document: unknown): Effect.Effect<string, LockfileDocumentError> =>
	Effect.gen(function* () {
		const { lockfileVersion } = yield* Schema.decodeUnknownEffect(VersionProbe)(document).pipe(
			Effect.mapError(shapeFailure),
		);
		const parsed = typeof lockfileVersion === "number" ? lockfileVersion : Number.parseFloat(lockfileVersion);
		if (!(Number.isFinite(parsed) && parsed >= MINIMUM_PNPM_LOCKFILE_VERSION)) {
			return yield* LockfileDocumentError.make({
				format: "pnpm",
				reason: "version",
				lockfileVersion,
				minimumSupported: MINIMUM_PNPM_LOCKFILE_VERSION,
			});
		}
		return String(lockfileVersion);
	});
