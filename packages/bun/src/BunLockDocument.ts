import { Jsonc } from "@effected/jsonc";
import { LockfileDocumentError } from "@effected/npm";
import { Effect, Schema } from "effect";
import { BunExtension } from "./BunExtension.js";

const DepRecord = Schema.optionalKey(Schema.Record(Schema.String, Schema.String));

/** One `workspaces` entry, keyed by workspace path (`""` for the root). */
const BunLockWorkspace = Schema.Struct({
	name: Schema.optionalKey(Schema.String),
	version: Schema.optionalKey(Schema.String),
	dependencies: DepRecord,
	devDependencies: DepRecord,
	peerDependencies: DepRecord,
	optionalDependencies: DepRecord,
	// bun spells optional peers as an array of names rather than a meta object.
	optionalPeers: Schema.optionalKey(Schema.Array(Schema.String)),
});

/**
 * bun's text lockfile, `bun.lock`, as bun writes it on disk: JSONC with
 * `lockfileVersion`, the `workspaces` map keyed by workspace path, the
 * `packages` map of tuples keyed by install position, and the header fields
 * (`catalog`, `catalogs`, `overrides`, `trustedDependencies`).
 *
 * @remarks
 * The native document only: no resolution, no normalisation. Reading it into
 * a manager-neutral model is `@effected/lockfiles`' job. A package tuple's
 * shape is under-documented upstream (`"name@version"` first, an info object
 * at index 2, the integrity at index 3), so each tuple is kept as an array of
 * unknown values for the reader to inspect. The header fields share their
 * schemas with {@link BunExtension}, which carries them on that model.
 *
 * bun records no lockfile format version older than the one read, so no
 * `lockfileVersion` is rejected.
 *
 * @public
 */
export class BunLockDocument extends Schema.Class<BunLockDocument>("BunLockDocument")({
	lockfileVersion: Schema.Number,
	workspaces: Schema.optionalKey(Schema.Record(Schema.String, BunLockWorkspace)),
	packages: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(Schema.Unknown))),
	catalog: BunExtension.fields.catalog,
	catalogs: BunExtension.fields.catalogs,
	overrides: BunExtension.fields.overrides,
	trustedDependencies: BunExtension.fields.trustedDependencies,
}) {
	/**
	 * Read `bun.lock` text as the native document. Pure: takes the text,
	 * performs no IO.
	 *
	 * @param content - The `bun.lock` text.
	 * @returns The decoded {@link BunLockDocument}, or a
	 *   `LockfileDocumentError` with `reason: "syntax"` (not well-formed
	 *   JSONC, `line` from the first diagnostic) or `reason: "shape"`.
	 */
	static readonly parse = Effect.fn("BunLockDocument.parse")(function* (content: string) {
		const parsed = yield* Jsonc.parse(content).pipe(
			Effect.mapError((cause) => {
				const line = cause.errors[0]?.line;
				return LockfileDocumentError.make({
					format: "bun",
					reason: "syntax",
					cause,
					...(line !== undefined ? { line } : {}),
				});
			}),
		);
		return yield* Schema.decodeUnknownEffect(BunLockDocument)(parsed).pipe(
			Effect.mapError((cause) => LockfileDocumentError.make({ format: "bun", reason: "shape", cause })),
		);
	});
}
