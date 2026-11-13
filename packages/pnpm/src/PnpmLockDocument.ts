import { Effect, Schema } from "effect";
import { framingFailure, splitPnpmStream } from "./internal/stream.js";
import { MINIMUM_PNPM_LOCKFILE_VERSION, gatePnpmVersion, shapeFailure } from "./internal/version.js";
import { PnpmExtension } from "./PnpmExtension.js";

const ImporterDeps = Schema.optionalKey(
	Schema.Record(Schema.String, Schema.Struct({ specifier: Schema.String, version: Schema.String })),
);

/** One `importers:` entry: the four dependency sections, each `{ specifier, version }` per name. */
const PnpmLockImporter = Schema.Struct({
	dependencies: ImporterDeps,
	devDependencies: ImporterDeps,
	peerDependencies: ImporterDeps,
	optionalDependencies: ImporterDeps,
	// pnpm records the directory a workspace package's links point AT,
	// importer-relative, when the package sets `publishConfig.directory`.
	publishDirectory: Schema.optionalKey(Schema.String),
});

/** One `packages:` entry: per-version metadata keyed `name@version`. */
const PnpmLockPackage = Schema.Struct({
	resolution: Schema.optionalKey(Schema.Struct({ integrity: Schema.optionalKey(Schema.String) })),
	peerDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	peerDependenciesMeta: Schema.optionalKey(
		Schema.Record(Schema.String, Schema.Struct({ optional: Schema.optionalKey(Schema.Boolean) })),
	),
	dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	optionalDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

/** One `snapshots:` entry: per-instance resolution, keyed `name@version` plus any peer suffix. */
const PnpmLockSnapshot = Schema.Struct({
	dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	optionalDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

/**
 * The lockfile document of a `pnpm-lock.yaml`, as pnpm writes it on disk,
 * `lockfileVersion` 9 and newer: the header (`settings`, `overrides`,
 * `catalogs`), `importers`, the per-version `packages:` section and the
 * per-instance `snapshots:` section.
 *
 * @remarks
 * The native document only: no resolution, no normalisation. Reading it into
 * a manager-neutral model is `@effected/lockfiles`' job. The header fields
 * share their schemas with {@link PnpmExtension}, which carries them on that
 * model.
 *
 * A `pnpm-lock.yaml` is a YAML stream of up to two documents: an env
 * preamble (`PnpmEnvDocument`) then this one. {@link PnpmLockDocument.parse}
 * always reads the last.
 *
 * @public
 */
export class PnpmLockDocument extends Schema.Class<PnpmLockDocument>("PnpmLockDocument")({
	lockfileVersion: Schema.Union([Schema.String, Schema.Number]),
	settings: PnpmExtension.fields.settings,
	overrides: PnpmExtension.fields.overrides,
	catalogs: PnpmExtension.fields.catalogs,
	importers: Schema.Record(Schema.String, PnpmLockImporter),
	packages: Schema.optionalKey(Schema.Record(Schema.String, PnpmLockPackage)),
	snapshots: Schema.optionalKey(Schema.Record(Schema.String, PnpmLockSnapshot)),
}) {
	/** The lowest `lockfileVersion` {@link PnpmLockDocument.parse} reads. */
	static readonly minimumLockfileVersion: number = MINIMUM_PNPM_LOCKFILE_VERSION;

	/**
	 * Read `pnpm-lock.yaml` text as its lockfile document. Pure: takes the
	 * text, performs no IO.
	 *
	 * @remarks
	 * The lockfile is the last document of the stream, so an env preamble is
	 * never read as the lockfile. The checks run in this order:
	 *
	 * - The text is YAML, else `reason: "syntax"`.
	 * - The stream carries at most two documents, else `reason: "framing"`
	 *   with `framing: "unexpectedDocuments"`.
	 * - The lockfile position is not empty, else `framing: "noLockfileDocument"`.
	 *   An env preamble followed by an empty document is what pnpm writes for
	 *   a config-dependency-only workspace and for an interrupted first
	 *   install alike, so whether that is a lockfile is the caller's decision.
	 * - The `lockfileVersion` is 9 or newer, else `reason: "version"`. This
	 *   runs before the shape decode, so an old lockfile fails as too old.
	 * - The document has the lockfile's shape, else `reason: "shape"`.
	 * - It declares at least one importer, else `framing: "noImporters"`:
	 *   pnpm always records the root importer, so an empty map describes no
	 *   workspace.
	 *
	 * @param content - The `pnpm-lock.yaml` text.
	 * @returns The decoded {@link PnpmLockDocument}, or a
	 *   `LockfileDocumentError`.
	 */
	static readonly parse = Effect.fn("PnpmLockDocument.parse")(function* (content: string) {
		const { main, documents } = yield* splitPnpmStream(content);
		if (main === undefined) return yield* framingFailure("noLockfileDocument", documents);
		yield* gatePnpmVersion(main);
		const document = yield* Schema.decodeUnknownEffect(PnpmLockDocument)(main).pipe(Effect.mapError(shapeFailure));
		if (Object.keys(document.importers).length === 0) return yield* framingFailure("noImporters", documents);
		return document;
	});
}
