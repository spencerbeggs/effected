import { ActionBuildResult } from "@effected/bundler";
import { Schema } from "effect";

/**
 * One action build's answer: the verdict a front end maps to an exit code or returns as data, and what the build did.
 *
 * @public
 */
export class ActionRunResult extends Schema.Class<ActionRunResult>("ActionRunResult")({
	/** `failed` when validation stopped the build or an entry failed to bundle or load. */
	verdict: Schema.Literals(["ok", "failed"]),
	/**
	 * What validation found, how bundling went and whether the build was persisted.
	 *
	 * @remarks
	 * When validation stops the build before bundling, `build` has no entries and `success: false`.
	 */
	result: ActionBuildResult,
}) {}
