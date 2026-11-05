// The verdicts `effected schema` turns into exit codes. The engine answers a failing gate, refused drift, a blocked
// catalog or a stale tree as data, because the MCP returns them as data; here they become failures, after the report
// has been emitted.

import { Schema } from "effect";

const DriftedSchema = Schema.Struct({
	$id: Schema.String,
	change: Schema.Literals(["none", "created", "annotations", "contract"]),
	version: Schema.optionalKey(Schema.String),
	nextVersion: Schema.optionalKey(Schema.String),
});

/**
 * A published schema drifted under `onDrift: "error"`, so nothing was written. Exit `1`.
 *
 * @public
 */
export class DriftError extends Schema.TaggedError<DriftError>()("DriftError", {
	drifted: Schema.Array(DriftedSchema),
}) {
	get count(): number {
		return this.drifted.length;
	}
	override get message(): string {
		const lines = this.drifted.map(
			(s) =>
				`  ${s.$id}: ${s.change}${s.version !== undefined ? ` at published ${s.version}` : ""}${s.nextVersion !== undefined ? ` → suggest ${s.nextVersion}` : ""}`,
		);
		return `${this.count} published schema(s) drifted; nothing was written.\n${lines.join("\n")}\nBump the drifting versions in the config, or re-run with --force to write anyway.`;
	}
}

/**
 * A schema failed the lint/validation gate, so nothing was written. Exit `1`.
 *
 * @public
 */
export class GateError extends Schema.TaggedError<GateError>()("GateError", { count: Schema.Number }) {
	override get message(): string {
		return `${this.count} schema(s) failed the lint/validation gate; nothing was written.`;
	}
}

/**
 * The merged catalog could not be assembled: a catalog URL or entry name is advertised more than once across the
 * slices, or a slice is not a catalog entry array. Nothing is merged silently, so the merged catalog was left as it
 * is. Exit `1` under both `build` and `check`: only an edit to the slices or the configs clears it.
 *
 * @public
 */
export class CatalogMergeError extends Schema.TaggedError<CatalogMergeError>()("CatalogMergeError", {
	path: Schema.String,
	conflicts: Schema.Array(
		Schema.Union([
			Schema.Struct({ kind: Schema.Literal("url"), url: Schema.String, slices: Schema.Array(Schema.String) }),
			Schema.Struct({ kind: Schema.Literal("name"), name: Schema.String, slices: Schema.Array(Schema.String) }),
		]),
	),
	invalid: Schema.Array(Schema.Struct({ path: Schema.String, reason: Schema.String })),
}) {
	override get message(): string {
		const lines = [
			...this.conflicts.map(
				(conflict) =>
					`  ${conflict.kind === "url" ? `url ${conflict.url}` : `name ${conflict.name}`} is advertised by ${conflict.slices.join(", ")}`,
			),
			...this.invalid.map(({ path, reason }) => `  ${path} is invalid: ${reason}`),
		];
		return `The merged catalog ${this.path} was not written.\n${lines.join("\n")}\nGive each catalog URL and name to exactly one config, and fix or delete every invalid slice.`;
	}
}

/**
 * `check` found committed documents that differ from what the config generates, or outputs nothing claims, which
 * `build` never deletes. `check` is the CI drift gate, so a stale tree fails it. Exit `1`. `count` is every finding;
 * `orphaned` the part of it a build cannot clear, so the message names both remedies.
 *
 * @public
 */
export class StaleError extends Schema.TaggedError<StaleError>()("StaleError", {
	count: Schema.Number,
	orphaned: Schema.optionalKey(Schema.Number),
}) {
	override get message(): string {
		const orphaned = this.orphaned ?? 0;
		const stale = this.count - orphaned;
		const parts = [
			...(stale > 0 ? [`${stale} document(s) are stale; run \`effected schema build\` and commit the result.`] : []),
			...(orphaned > 0 ? [`${orphaned} orphaned output(s) must be deleted by hand; build never will.`] : []),
		];
		return parts.join(" ");
	}
}

/**
 * The payload does not conform to the resolved document: the engine answered findings, each already reported. Exit
 * `1`: a validation verdict, the reason CI runs the command.
 *
 * @public
 */
export class ValidationFailedError extends Schema.TaggedError<ValidationFailedError>()("ValidationFailedError", {
	count: Schema.Number,
	payload: Schema.String,
	schema: Schema.String,
}) {
	override get message(): string {
		return `${this.count} finding(s): ${this.payload} does not conform to ${this.schema}`;
	}
}

/**
 * No schemastore config was found. Exit `2`: the command could not run, where exit `1` means it ran and found a
 * problem. The engine's error says what was searched; this adds the way out, which is the front end's to state because
 * it names the command that was run.
 *
 * @public
 */
export class NoConfigError extends Schema.TaggedError<NoConfigError>()("NoConfigError", {
	/** The file names looked for. */
	names: Schema.Array(Schema.String),
	/** The directories walked, or the one explicit path checked. */
	searched: Schema.Array(Schema.String),
	/** The subcommand that was run. */
	command: Schema.String,
}) {
	override get message(): string {
		return `No schemastore config found. Looked for ${this.names.join(", ")} in: ${this.searched.join(", ")}.\nRun next to a config, or pass its path, for example: effected schema ${this.command} lib/schemastore.config.ts`;
	}
}
