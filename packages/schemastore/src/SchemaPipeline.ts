// The verb `SchemaTarget` was defined for: generate each target's document,
// lint it, validate it with the real engine, gate on the findings, and write
// it. Orchestration only — every step belongs to a module this package
// already owns, and no JSON Schema capability is added here.
//
// A plain function rather than a `Context.Service`: it needs `SchemaFile`
// and `SchemaValidator`, which compose through `R` for free. A service would
// add a layer to wire for no capability the consumer does not already have.

import { Effect, Schema } from "effect";
import type { CanonicalJsonError } from "./CanonicalJson.js";
import { DocumentLint } from "./DocumentLint.js";
import type {
	SchemaFileReadError,
	SchemaFileWriteError,
	SchemaWriteOptions,
	WriteChange,
	WriteOutcome,
} from "./SchemaFile.js";
import { SchemaFile } from "./SchemaFile.js";
import type { SchemaTarget } from "./SchemaTarget.js";
import type { SchemaValidatorError, SchemaValidatorOptions } from "./SchemaValidator.js";
import { SchemaValidator } from "./SchemaValidator.js";
import { SchemaVersion, SchemaVersioning } from "./SchemaVersioning.js";
import type { SchemaConversionError } from "./StoreDocument.js";
import { StoreDocument } from "./StoreDocument.js";

/**
 * One problem found while emitting a target, from either gate, normalized
 * so a single policy predicate can judge both.
 *
 * `DocumentLint` findings keep their own severity; engine findings are
 * `"warning"` — a document the engine rejects is not advisory.
 *
 * @public
 */
export class PipelineFinding extends Schema.Class<PipelineFinding>("PipelineFinding")({
	/** Which gate produced it. */
	source: Schema.Literals(["lint", "validator"]),
	/** `"warning"` blocks under the default policy; `"advisory"` does not. */
	severity: Schema.Literals(["warning", "advisory"]),
	/** The lint check's name, or the engine keyword, when one is named. */
	check: Schema.optionalKey(Schema.String),
	/** JSON pointer into the flat document (`""` is the root). */
	path: Schema.String,
	/** Human-readable explanation. */
	message: Schema.String,
}) {
	/**
	 * What to call this finding when rendering it: the check name when the
	 * gate named one, the gate itself otherwise.
	 *
	 * Engine findings do not always carry a keyword, so without this every
	 * consumer that logs findings writes the same `finding.check ?? …`
	 * fallback.
	 */
	get label(): string {
		return this.check ?? this.source;
	}
}

/**
 * Indicates that at least one target's findings blocked under the active
 * gating policy. Carries every blocking finding, so a caller renders one
 * report instead of discovering problems one run at a time.
 *
 * @public
 */
export class SchemaGateError extends Schema.TaggedError<SchemaGateError>()("SchemaGateError", {
	/** The `$id` of the target that failed the gate. */
	$id: Schema.String,
	/** Every finding that blocked, in discovery order. */
	findings: Schema.Array(PipelineFinding),
}) {
	override get message(): string {
		return `Schema "${this.$id}" failed its gate with ${this.findings.length} blocking finding(s)`;
	}
}

/**
 * How {@link SchemaPipeline.run} treats a target whose document would change
 * its validation contract.
 *
 * - `"block-versioned"` (the default) — a target carrying a PINNED `version`
 *   ({@link SchemaVersioning.isPinned}) is a published, URL-pinned document:
 *   a `"contract"` change fails with {@link SchemaContractChangeError} BEFORE
 *   any write. A target with no `version`, or with a prerelease label, is a
 *   document that replaces its predecessor in place and is rewritten as
 *   before.
 * - `"allow"` — classify and report only, never refuse: the pre-guard
 *   behaviour. Also the sanctioned REPAIR path for a published file whose
 *   text no longer parses — `SchemaFile` classifies unparseable text as
 *   `"contract"` so it stays regenerable, and under the default that
 *   classification is refused.
 *
 * The policy reads `change`, which is content-classified under either
 * `write.compare` mode, so `"bytes"` neither strengthens nor weakens it.
 *
 * The policy is only coherent when the version participates in `path`
 * (`schemas/<version>/<name>-<version>.json`): a versioned target at a fixed
 * path compares the same file forever, and bumping `version` does not move
 * it.
 *
 * @public
 */
export type ContractChangePolicy = "block-versioned" | "allow";

/**
 * One published document whose validation contract would change.
 *
 * @public
 */
export class ContractChangeTarget extends Schema.Class<ContractChangeTarget>("ContractChangeTarget")({
	/** The target's `$id`. */
	$id: Schema.String,
	/** The path the document would have been written to. */
	path: Schema.String,
	/** The target's pinned label. */
	version: SchemaVersion,
	/** The label to publish under instead — {@link SchemaVersioning.next} of `version`. */
	nextVersion: SchemaVersion,
}) {}

/**
 * Indicates that at least one published target's contract changed under the
 * active {@link ContractChangePolicy}. Raised BEFORE any target is written
 * and total over the targets, so two broken documents surface in one run.
 *
 * @public
 */
export class SchemaContractChangeError extends Schema.TaggedError<SchemaContractChangeError>()(
	"SchemaContractChangeError",
	{
		/** Every published target whose contract would change, in target order. */
		targets: Schema.Array(ContractChangeTarget),
	},
) {
	override get message(): string {
		return (
			`${this.targets.length} published schema document(s) would change their validation contract; ` +
			`nothing was written. Bump each target's version, $id and path together — ` +
			`${this.targets.map((target) => `${target.$id}: ${target.version} → ${target.nextVersion}`).join(", ")} — ` +
			`or pass contractChanges: "allow" to rewrite in place.`
		);
	}
}

/**
 * What the pipeline did with one target.
 *
 * @public
 */
export interface PipelineResult {
	/** The target's `$id`. */
	readonly $id: string;
	/** The path the document was written to (or compared against). */
	readonly path: string;
	/** Whether the file was written. Absent from {@link SchemaPipeline.check}'s results. */
	readonly outcome: WriteOutcome;
	/** What differs between the previous content and the new document. */
	readonly change: WriteChange;
	/**
	 * Every finding, blocking or not — returned as a value, never logged.
	 * The package does not choose your log wording; a run that reached a
	 * result had no blocking findings under the active policy.
	 */
	readonly findings: ReadonlyArray<PipelineFinding>;
}

/**
 * What {@link SchemaPipeline.check} found for one target — the same report
 * without the write.
 *
 * @public
 */
export interface PipelineCheckResult {
	/** The target's `$id`. */
	readonly $id: string;
	/** The path compared against. */
	readonly path: string;
	/** Whether a run would touch this file. */
	readonly wouldWrite: boolean;
	/**
	 * Whether this target's findings would block a {@link SchemaPipeline.run}
	 * under the active policy — so a document that could never be written is
	 * never mistaken for clean drift.
	 */
	readonly blocked: boolean;
	/**
	 * Whether the {@link ContractChangePolicy} would refuse this write.
	 *
	 * Read it side by side with {@link PipelineCheckResult.blocked}: `blocked`
	 * answers "would findings block a run under `blocking`", while
	 * `contractBlocked` answers "would the contract policy refuse this write
	 * under `contractChanges`". A drift test that reads `contractBlocked` can
	 * print the right remedy — "regenerate" is wrong advice for a target the
	 * generator will refuse; the fix is a version bump.
	 */
	readonly contractBlocked: boolean;
	/** What differs between the on-disk content and the new document. */
	readonly change: WriteChange;
	/** Every finding, blocking or not. */
	readonly findings: ReadonlyArray<PipelineFinding>;
}

/**
 * Options for {@link SchemaPipeline.run} and {@link SchemaPipeline.check}.
 *
 * @public
 */
export interface SchemaPipelineOptions {
	/**
	 * Which findings block. Defaults to
	 * `(finding) => finding.severity === "warning"`.
	 *
	 * The default is a policy call, not a mechanism: `UnresolvedRef`,
	 * `UnknownKeyword` and `DepthExceeded` each describe a document that is
	 * broken for the editors it exists to serve, and `UnknownKeyword` is by
	 * construction the ajv-strict rejection set — tolerating it means
	 * shipping something the engine gate rejects. A consumer who disagrees
	 * replaces this predicate rather than re-implementing the loop.
	 *
	 * **Which findings can actually reach you here.** A `SchemaTarget`
	 * carries a `Schema`, so the pipeline's documents come from
	 * `StoreDocument.fromSchema` — and the Draft-07 lowering drops every
	 * keyword outside its copy-list, so an undeclared keyword never
	 * survives to be linted. Through this entry point `UnknownKeyword` is
	 * therefore effectively unreachable, and **the engine gate is what
	 * blocks in practice**. The lint's warning checks earn their keep on
	 * documents this pipeline did not build — a hand-assembled
	 * `StoreDocument.draft07`, or one read back off disk — and on depth,
	 * which a schema can genuinely exceed.
	 */
	readonly blocking?: (finding: PipelineFinding) => boolean;
	/**
	 * How {@link SchemaPipeline.run} treats a target whose document would
	 * change its validation contract. Defaults to `"block-versioned"`: a
	 * target carrying a pinned `version` is refused rather than rewritten in
	 * place. Pass `"allow"` to classify and report only — including to repair
	 * a published file whose on-disk text no longer parses.
	 */
	readonly contractChanges?: ContractChangePolicy;
	/** Passed through to `SchemaValidator.validate`. */
	readonly validator?: SchemaValidatorOptions;
	/** Passed through to `SchemaFile.write` / `SchemaFile.check`. */
	readonly write?: SchemaWriteOptions;
}

const defaultBlocking = (finding: PipelineFinding): boolean => finding.severity === "warning";

// ONE pair of predicates, on the `SchemaFile.compare` precedent: `run`'s
// guard and `check`'s reported field are answered from the same test, so the
// two can never disagree about the same target.
const contractGuardApplies = (target: SchemaTarget, options?: SchemaPipelineOptions): boolean =>
	(options?.contractChanges ?? "block-versioned") === "block-versioned" &&
	target.version !== undefined &&
	SchemaVersioning.isPinned(target.version);

const contractBlocks = (target: SchemaTarget, change: WriteChange, options?: SchemaPipelineOptions): boolean =>
	contractGuardApplies(target, options) && change === "contract";

// Collect both gates' findings for one target, normalized.
const gather = (
	document: StoreDocument,
	options?: SchemaPipelineOptions,
): Effect.Effect<ReadonlyArray<PipelineFinding>, SchemaValidatorError, SchemaValidator> =>
	Effect.gen(function* () {
		const validator = yield* SchemaValidator;
		const lint = DocumentLint.lint(document).map((finding) =>
			PipelineFinding.make({
				source: "lint",
				severity: finding.severity === "warning" ? "warning" : "advisory",
				check: finding.check,
				path: finding.path,
				message: finding.message,
			}),
		);
		const validation = (yield* validator.validate(document.toJson(), options?.validator)).map((finding) =>
			PipelineFinding.make({
				source: "validator",
				severity: "warning",
				path: finding.path,
				message: finding.message,
				...(finding.keyword !== undefined ? { check: finding.keyword } : {}),
			}),
		);
		return [...lint, ...validation];
	});

const blockingFindings = (
	findings: ReadonlyArray<PipelineFinding>,
	options?: SchemaPipelineOptions,
): ReadonlyArray<PipelineFinding> => findings.filter(options?.blocking ?? defaultBlocking);

const gate = (
	target: SchemaTarget,
	findings: ReadonlyArray<PipelineFinding>,
	options?: SchemaPipelineOptions,
): Effect.Effect<void, SchemaGateError> => {
	const blocking = blockingFindings(findings, options);
	return blocking.length > 0 ? Effect.fail(SchemaGateError.make({ $id: target.$id, findings: blocking })) : Effect.void;
};

/**
 * The emit pipeline over a target manifest: generate, lint, validate, gate,
 * write — the loop every consumer of this package was writing by hand.
 *
 * Requires `SchemaFile` and `SchemaValidator` in `R`; provide
 * `SchemaFile.layer` and `SchemaValidator.layer` (plus a platform
 * `FileSystem` / `Path`) at the edge. Findings come back as **values**, so
 * the package never chooses your log wording — but the gating decision,
 * which is the part that must not silently differ between consumers, has
 * one default and one override point.
 *
 * @example
 * ```ts
 * import { SchemaFile, SchemaPipeline, SchemaTarget, SchemaValidator } from "@effected/schemastore";
 * import { NodeServices } from "@effect/platform-node";
 * import { Effect, Layer, Schema } from "effect";
 *
 * const targets = [
 *   SchemaTarget.make({
 *     schema: Schema.Struct({ name: Schema.String }),
 *     $id: "https://example.com/config.schema.json",
 *     path: "schemas/config.schema.json",
 *   }),
 * ];
 *
 * const program = SchemaPipeline.run(targets).pipe(
 *   Effect.provide(Layer.mergeAll(SchemaFile.layer, SchemaValidator.layer)),
 *   Effect.provide(NodeServices.layer),
 * );
 * ```
 *
 * @public
 */
export class SchemaPipeline {
	private constructor() {}

	/**
	 * Run every target: build its document, gather both gates' findings,
	 * fail with a {@link SchemaGateError} if any block, refuse a published
	 * target whose contract changed, and write otherwise.
	 *
	 * **The run writes nothing unless every target passes both gates.** It
	 * is two-phase: every target is generated, gated and (for a target the
	 * {@link ContractChangePolicy} guards) compared against its predecessor
	 * before any file is touched, and only then are the held documents
	 * written in target order. A gate failure on the third target therefore
	 * leaves the first two unwritten.
	 *
	 * Phase 2 itself is sequential and **not transactional**: a filesystem or
	 * serialization failure part-way through it leaves the targets already
	 * written in place, with no rollback. The guarantee is "no writes unless
	 * every gate passes", not "every write or none".
	 *
	 * The gates run in a fixed precedence: {@link SchemaGateError} is
	 * fail-fast on the first blocked target, because a document the engine
	 * rejects would never be written under any contract policy, so its
	 * classification is noise. {@link SchemaContractChangeError} is total
	 * over the remaining targets, so two published documents whose contracts
	 * moved surface in one run.
	 *
	 * @example
	 * ```ts
	 * import { SchemaContractChangeError, SchemaPipeline } from "@effected/schemastore";
	 * import { Effect } from "effect";
	 *
	 * declare const targets: Parameters<typeof SchemaPipeline.run>[0];
	 *
	 * const program = SchemaPipeline.run(targets).pipe(
	 *   Effect.catchTag("SchemaContractChangeError", (error: SchemaContractChangeError) =>
	 *     Effect.succeed(
	 *       error.targets.map((target) => `${target.$id}: ${target.version} -> ${target.nextVersion}`),
	 *     ),
	 *   ),
	 * );
	 * ```
	 */
	static run(
		targets: ReadonlyArray<SchemaTarget>,
		options?: SchemaPipelineOptions,
	): Effect.Effect<
		ReadonlyArray<PipelineResult>,
		| SchemaGateError
		| SchemaContractChangeError
		| SchemaConversionError
		| SchemaValidatorError
		| CanonicalJsonError
		| SchemaFileReadError
		| SchemaFileWriteError,
		SchemaFile | SchemaValidator
	> {
		return Effect.gen(function* () {
			const files = yield* SchemaFile;
			const held: Array<{
				readonly target: SchemaTarget;
				readonly document: StoreDocument;
				readonly findings: ReadonlyArray<PipelineFinding>;
			}> = [];
			const blocked: Array<ContractChangeTarget> = [];

			// Phase 1 — generate, gate and classify. Nothing is written here.
			for (const target of targets) {
				const document = yield* StoreDocument.fromSchema(target.schema, { $id: target.$id });
				const findings = yield* gather(document, options);
				yield* gate(target, findings, options);
				const version = target.version;
				if (version !== undefined && contractGuardApplies(target, options)) {
					// The guarded target is read twice — once here, once by the
					// `write` in phase 2. Accepted deliberately: deduplicating it
					// would mean widening `SchemaFileShape` with a compare-then-
					// write member, and the read is only paid by targets that
					// declare themselves published. The two phases are a snapshot;
					// a concurrent writer between them is not defended against — and
					// neither is one target in the SAME manifest sharing another's
					// `path`, which phase 1 classifies against the on-disk file both
					// will write. That is a caller error, and it reads as a
					// post-write classification: the second target compares against
					// what the first one just wrote, so two different documents at
					// one path report `change` `"contract"`.
					const { change } = yield* files.check(target.path, document, options?.write);
					if (contractBlocks(target, change, options)) {
						blocked.push(
							ContractChangeTarget.make({
								$id: target.$id,
								path: target.path,
								version,
								nextVersion: SchemaVersioning.next(version, "contract"),
							}),
						);
					}
				}
				held.push({ target, document, findings });
			}
			if (blocked.length > 0) {
				return yield* Effect.fail(SchemaContractChangeError.make({ targets: blocked }));
			}

			// Phase 2 — write the held documents, in target order.
			const results: Array<PipelineResult> = [];
			for (const { target, document, findings } of held) {
				const { outcome, change } = yield* files.write(target.path, document, options?.write);
				results.push({ $id: target.$id, path: target.path, outcome, change, findings });
			}
			return results;
		});
	}

	/**
	 * The same walk with **no writes** — the drift-check counterpart, for a
	 * CI job asserting the committed schemas are current.
	 *
	 * Unlike {@link SchemaPipeline.run} this is **total over the targets**:
	 * it never stops at a failing gate, and reports `blocked` per target
	 * instead of failing. Reporting is the job here, and a repo with three
	 * broken documents should learn that in one run rather than fixing them
	 * one run at a time. A blocked target is still never mistaken for clean
	 * drift — `blocked` says so explicitly.
	 *
	 * The error channel is left to the mechanisms that genuinely cannot
	 * produce a report (generation, serialization, the engine, the read).
	 */
	static check(
		targets: ReadonlyArray<SchemaTarget>,
		options?: SchemaPipelineOptions,
	): Effect.Effect<
		ReadonlyArray<PipelineCheckResult>,
		SchemaConversionError | SchemaValidatorError | CanonicalJsonError | SchemaFileReadError,
		SchemaFile | SchemaValidator
	> {
		return Effect.gen(function* () {
			const files = yield* SchemaFile;
			const results: Array<PipelineCheckResult> = [];
			for (const target of targets) {
				const document = yield* StoreDocument.fromSchema(target.schema, { $id: target.$id });
				const findings = yield* gather(document, options);
				const { wouldWrite, change } = yield* files.check(target.path, document, options?.write);
				results.push({
					$id: target.$id,
					path: target.path,
					wouldWrite,
					blocked: blockingFindings(findings, options).length > 0,
					contractBlocked: contractBlocks(target, change, options),
					change,
					findings,
				});
			}
			return results;
		});
	}

	/**
	 * {@link SchemaPipeline.run} for a single target, answering its one
	 * result directly — so a caller with one target does not index into an
	 * array and prove to the type system that element zero exists.
	 */
	static runOne(
		target: SchemaTarget,
		options?: SchemaPipelineOptions,
	): Effect.Effect<
		PipelineResult,
		| SchemaGateError
		| SchemaContractChangeError
		| SchemaConversionError
		| SchemaValidatorError
		| CanonicalJsonError
		| SchemaFileReadError
		| SchemaFileWriteError,
		SchemaFile | SchemaValidator
	> {
		return SchemaPipeline.run([target], options).pipe(Effect.map((results) => results[0] as PipelineResult));
	}

	/**
	 * {@link SchemaPipeline.check} for a single target, answering its one
	 * result directly.
	 */
	static checkOne(
		target: SchemaTarget,
		options?: SchemaPipelineOptions,
	): Effect.Effect<
		PipelineCheckResult,
		SchemaConversionError | SchemaValidatorError | CanonicalJsonError | SchemaFileReadError,
		SchemaFile | SchemaValidator
	> {
		return SchemaPipeline.check([target], options).pipe(Effect.map((results) => results[0] as PipelineCheckResult));
	}
}
