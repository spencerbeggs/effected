import type { WriteChange } from "./SchemaFile.js";

/**
 * How much change a PUBLISHED schema document may absorb before a build is
 * refused.
 *
 * @remarks
 * - `"strict"` — any content change (`annotations` or `contract`) is drift.
 * - `"semantic"` — only a `contract` change is drift; documentation-only
 *   keywords rewrite in place.
 * - `"allow"` — nothing is drift; the document rewrites in place.
 *
 * @public
 */
export type DriftTolerance = "strict" | "semantic" | "allow";

/**
 * What a build does when it finds drift: refuse to write anything, or write
 * and warn.
 *
 * @public
 */
export type OnDrift = "error" | "warn";

/**
 * The drift settings a config declares and a CLI flag may override.
 *
 * @public
 */
export interface DriftOptions {
	readonly policy: DriftTolerance;
	readonly onDrift: OnDrift;
}

/**
 * The verdict for one target: write it, or hold it as drift.
 *
 * @public
 */
export type DriftVerdict = "write" | "drift";

/**
 * Classifies one target's change against a drift tolerance.
 *
 * @remarks
 * Pure and synchronous. The lifecycle rule is fixed here so no caller
 * relitigates it: an unpublished target is NEVER drift — it is regenerated
 * in place until someone depends on its label. Gate failures (lint warnings,
 * validator findings) are not drift either and are not this module's
 * concern.
 *
 * @public
 */
export class DriftPolicy {
	private constructor() {}

	/** `{ policy: "semantic", onDrift: "error" }` — what a config gets when it says nothing. */
	static readonly defaults: DriftOptions = { policy: "semantic", onDrift: "error" };

	static classify(
		input: { readonly published: boolean; readonly change: WriteChange },
		policy: DriftTolerance,
	): DriftVerdict {
		if (!input.published || policy === "allow") {
			return "write";
		}
		if (input.change === "contract") {
			return "drift";
		}
		if (input.change === "annotations" && policy === "strict") {
			return "drift";
		}
		return "write";
	}
}
