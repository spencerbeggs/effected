import { Schema } from "effect";
import { BuildReport } from "./report/schema.js";

/**
 * The part of a build a {@link BundlerError} failed in.
 *
 * @public
 */
export const BundlerPhase = Schema.Literals(["validate", "js", "dts", "meta", "exe", "manifest"]);

/**
 * The decoded type of {@link (BundlerPhase:variable)}.
 *
 * @public
 */
export type BundlerPhase = typeof BundlerPhase.Type;

/**
 * A build ended before it finished.
 *
 * @remarks
 * `report` is the collector's snapshot at the moment of failure, so a caller can still render the diagnostics
 * the build gathered. `dist/prod/issues.json` was written with `buildOk: false` before this failure was raised,
 * unless writing it failed too.
 *
 * @public
 */
export class BundlerError extends Schema.TaggedError<BundlerError>()("BundlerError", {
	/** The part of the build that failed. */
	phase: BundlerPhase,
	/** What went wrong, read from the thrown value and its cause chain. */
	message: Schema.String,
	/** The thrown value, carried structurally. */
	cause: Schema.optionalKey(Schema.Defect()),
	/** Everything the build recorded before it failed. */
	report: BuildReport,
}) {}
