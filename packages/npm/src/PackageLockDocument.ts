import { Effect, Schema } from "effect";
import { LockfileDocumentError } from "./LockfileDocumentError.js";

const DepRecord = Schema.optionalKey(Schema.Record(Schema.String, Schema.String));

const PeerMetaRecord = Schema.optionalKey(
	Schema.Record(Schema.String, Schema.Struct({ optional: Schema.optionalKey(Schema.Boolean) })),
);

/** One `packages` entry of a `package-lock.json`, keyed by install position. */
const PackageLockEntry = Schema.Struct({
	name: Schema.optionalKey(Schema.String),
	version: Schema.optionalKey(Schema.String),
	resolved: Schema.optionalKey(Schema.String),
	integrity: Schema.optionalKey(Schema.String),
	link: Schema.optionalKey(Schema.Boolean),
	dev: Schema.optionalKey(Schema.Boolean),
	dependencies: DepRecord,
	devDependencies: DepRecord,
	peerDependencies: DepRecord,
	peerDependenciesMeta: PeerMetaRecord,
	optionalDependencies: DepRecord,
	// The root entry's workspace globs: npm writes an array, a hand-edited
	// file may hold anything, so a reader decides how to read it.
	workspaces: Schema.optionalKey(Schema.Unknown),
});

/** The lowest `lockfileVersion` read. v1 and v2 trees record resolution in a shape not modeled here. */
const MINIMUM_LOCKFILE_VERSION = 3;

/**
 * The version gate's own input: `lockfileVersion` and nothing else. It is
 * decoded before the shape, because a v1 tree has no `packages` object and a
 * shape-first order would report it as malformed rather than too old.
 */
const VersionProbe = Schema.Struct({ lockfileVersion: Schema.Union([Schema.Number, Schema.String]) });

const shapeFailure = (cause: unknown) => LockfileDocumentError.make({ format: "npm", reason: "shape", cause });

/**
 * npm's `package-lock.json` as written on disk, `lockfileVersion` 3 and
 * newer: the top-level `name`, `version`, `lockfileVersion` and `requires`,
 * and the `packages` map keyed by install position (`""` for the root,
 * `node_modules/<name>` and nested `…/node_modules/<name>` for installed
 * packages, a workspace path for a workspace's own entry).
 *
 * @remarks
 * The native document only: no resolution, no normalisation. Reading it into
 * a manager-neutral model is `@effected/lockfiles`' job. Every entry field is
 * optional, as npm omits what does not apply.
 *
 * @public
 */
export class PackageLockDocument extends Schema.Class<PackageLockDocument>("PackageLockDocument")({
	name: Schema.optionalKey(Schema.String),
	version: Schema.optionalKey(Schema.String),
	lockfileVersion: Schema.Union([Schema.Number, Schema.String]),
	requires: Schema.optionalKey(Schema.Boolean),
	packages: Schema.Record(Schema.String, PackageLockEntry),
}) {
	/** The lowest `lockfileVersion` {@link PackageLockDocument.parse} reads. */
	static readonly minimumLockfileVersion: number = MINIMUM_LOCKFILE_VERSION;

	/**
	 * Read `package-lock.json` text as the native document. Pure: takes the
	 * text, performs no IO.
	 *
	 * @remarks
	 * Native `JSON.parse` runs inside the typed channel, so its throw on
	 * hostile input (V8's `RangeError` on pathological depth included) fails
	 * `reason: "syntax"`. The `lockfileVersion` gate runs before the shape
	 * decode.
	 *
	 * @param content - The `package-lock.json` text.
	 * @returns The decoded {@link PackageLockDocument}, or a
	 *   `LockfileDocumentError` with `reason` `"syntax"`, `"version"` or
	 *   `"shape"`.
	 */
	static readonly parse = Effect.fn("PackageLockDocument.parse")(function* (content: string) {
		const raw = yield* Effect.try({
			try: () => JSON.parse(content) as unknown,
			catch: (cause) => LockfileDocumentError.make({ format: "npm", reason: "syntax", cause }),
		});
		const probe = yield* Schema.decodeUnknownEffect(VersionProbe)(raw).pipe(Effect.mapError(shapeFailure));
		const version =
			typeof probe.lockfileVersion === "number" ? probe.lockfileVersion : Number.parseFloat(probe.lockfileVersion);
		if (!(Number.isFinite(version) && version >= MINIMUM_LOCKFILE_VERSION)) {
			return yield* LockfileDocumentError.make({
				format: "npm",
				reason: "version",
				lockfileVersion: probe.lockfileVersion,
				minimumSupported: MINIMUM_LOCKFILE_VERSION,
			});
		}
		return yield* Schema.decodeUnknownEffect(PackageLockDocument)(raw).pipe(Effect.mapError(shapeFailure));
	});
}
