import { Effect, Option, Schema } from "effect";
import { splitPnpmStream } from "./internal/stream.js";
import { gatePnpmVersion, shapeFailure } from "./internal/version.js";

const EnvImporterDeps = Schema.optionalKey(
	Schema.Record(Schema.String, Schema.Struct({ specifier: Schema.String, version: Schema.String })),
);

/**
 * The env ("preamble") document of a `pnpm-lock.yaml`, as pnpm writes it on
 * disk ahead of the lockfile document when a workspace declares
 * `devEngines.packageManager` or `configDependencies`.
 *
 * @remarks
 * The native document only. The importers record the package manager
 * (`packageManagerDependencies`) and the config dependencies
 * (`configDependencies`) as `{ specifier, version }` per name, the
 * `packages:` section their integrity and the `snapshots:` section the
 * package manager's native optional dependencies. Reading those claims, and
 * failing the ones the document cannot back, is `@effected/lockfiles`'
 * `PnpmEnvLockfile`.
 *
 * The preamble is always the **first** of two documents; the lockfile
 * document (`PnpmLockDocument`) is the last. Both declare `lockfileVersion`,
 * `importers` and `packages`, so position is the only discriminator.
 *
 * @public
 */
export class PnpmEnvDocument extends Schema.Class<PnpmEnvDocument>("PnpmEnvDocument")({
	lockfileVersion: Schema.Union([Schema.String, Schema.Number]),
	importers: Schema.optionalKey(
		Schema.Record(
			Schema.String,
			Schema.Struct({
				packageManagerDependencies: EnvImporterDeps,
				configDependencies: EnvImporterDeps,
			}),
		),
	),
	packages: Schema.optionalKey(
		Schema.Record(
			Schema.String,
			Schema.Struct({
				resolution: Schema.optionalKey(Schema.Struct({ integrity: Schema.optionalKey(Schema.String) })),
			}),
		),
	),
	snapshots: Schema.optionalKey(
		Schema.Record(
			Schema.String,
			Schema.Struct({
				optionalDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
			}),
		),
	),
}) {
	/**
	 * Read the env preamble out of `pnpm-lock.yaml` text. Pure: takes the
	 * text, performs no IO.
	 *
	 * @remarks
	 * The stream is split exactly as `PnpmLockDocument.parse` splits it, so
	 * the two cannot disagree about which document is the preamble. A located
	 * preamble is gated on `lockfileVersion` 9 and newer before its shape is
	 * decoded.
	 *
	 * @param content - The `pnpm-lock.yaml` text.
	 * @returns `Option.none()` when the stream carries no preamble (a single
	 *   document, or an empty first position), otherwise the decoded
	 *   {@link PnpmEnvDocument}. Fails with a `LockfileDocumentError`:
	 *   `reason: "syntax"` for broken YAML, `"framing"`
	 *   (`unexpectedDocuments`) for more than two documents, `"version"` or
	 *   `"shape"` for a preamble the kit does not read.
	 */
	static readonly parse = Effect.fn("PnpmEnvDocument.parse")(function* (content: string) {
		const { preamble } = yield* splitPnpmStream(content);
		if (preamble === undefined) return Option.none<PnpmEnvDocument>();
		yield* gatePnpmVersion(preamble);
		const document = yield* Schema.decodeUnknownEffect(PnpmEnvDocument)(preamble).pipe(Effect.mapError(shapeFailure));
		return Option.some(document);
	});
}
