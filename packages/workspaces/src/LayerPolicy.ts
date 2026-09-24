import { GlobSet } from "@effected/glob";
import { DependencyField } from "@effected/npm";
import { Effect, FileSystem, Result, Schema } from "effect";
import { ALL_DEPENDENCY_FIELDS } from "./internal/dependencyFields.js";

const REQUIRED_EDGE = /^\S+ -> \S+$/;

/**
 * Raised when a layer policy cannot be read, parsed or decoded.
 *
 * @public
 */
export class LayerPolicyError extends Schema.TaggedError<LayerPolicyError>()("LayerPolicyError", {
	/** `read`: the file could not be read. `json`: it is not JSON. `decode`: it is not a `LayerPolicy`. */
	reason: Schema.Literals(["read", "json", "decode"]),
	/** The file, when the policy came from one. */
	path: Schema.optionalKey(Schema.String),
	/** The originating failure. */
	cause: Schema.Defect(),
}) {
	/** Renders the failure kind and the file into one line. */
	override get message(): string {
		const at = this.path === undefined ? "" : ` at ${this.path}`;
		switch (this.reason) {
			case "read":
				return `Could not read the layer policy${at}`;
			case "json":
				return `The layer policy${at} is not valid JSON`;
			default:
				return `The layer policy${at} does not match the LayerPolicy shape`;
		}
	}
}

/**
 * A committed dependency-layering policy (`layers.json`).
 *
 * @remarks
 * `layers` is top-down: an edge may only point from a layer to one BELOW it
 * (a higher index), or into `tooling`. `tooling` packages may depend on each
 * other but never reach a layer. `unconstrained` holds globs (through
 * `@effected/glob`) for packages whose own edges are not checked (a test
 * harness, the private root). `fields` narrows which dependency maps count,
 * defaulting to all four. `requiredEdges` (`"a -> b"`) are edges that must
 * exist in a checked field: the non-vacuity guard against a discovery that
 * quietly drops real edges.
 *
 * @example
 * ```ts
 * import { NodeServices } from "@effect/platform-node";
 * import { LayerPolicy } from "@effected/workspaces/testing";
 * import { Effect } from "effect";
 *
 * const policy = LayerPolicy.load("/repo/layers.json").pipe(Effect.provide(NodeServices.layer));
 * ```
 *
 * @public
 */
export class LayerPolicy extends Schema.Class<LayerPolicy>("LayerPolicy")({
	/** Package names per layer, top layer first. */
	layers: Schema.Array(Schema.Array(Schema.String)),
	/** Packages any layer may depend on that never depend on a layer. */
	tooling: Schema.Array(Schema.String),
	/** Globs naming packages whose own edges are not checked. */
	unconstrained: Schema.Array(Schema.String).check(
		Schema.makeFilter((patterns) => Result.isSuccess(GlobSet.compileResult(patterns)), {
			title: "compilable glob patterns",
		}),
	),
	/** The dependency maps to check. Absent means all four. */
	fields: Schema.optionalKey(Schema.Array(DependencyField)),
	/** Edges that must exist, written `"a -> b"`. */
	requiredEdges: Schema.optionalKey(Schema.Array(Schema.String.check(Schema.isPattern(REQUIRED_EDGE)))),
}) {
	/** The dependency maps a check reads: `fields`, or all four. */
	get effectiveFields(): ReadonlyArray<DependencyField> {
		return this.fields ?? ALL_DEPENDENCY_FIELDS;
	}

	/** Decode a policy from a parsed JSON value. */
	static readonly decode = Effect.fn("LayerPolicy.decode")(
		(input: unknown, path?: string): Effect.Effect<LayerPolicy, LayerPolicyError> =>
			Schema.decodeUnknownEffect(LayerPolicy)(input).pipe(
				Effect.mapError(
					(cause) => new LayerPolicyError({ reason: "decode", cause, ...(path === undefined ? {} : { path }) }),
				),
			),
	);

	/** Read, parse and decode the policy file at `path`. */
	static readonly load = Effect.fn("LayerPolicy.load")(function* (path: string) {
		const fs = yield* FileSystem.FileSystem;
		const text = yield* fs
			.readFileString(path)
			.pipe(Effect.mapError((cause) => new LayerPolicyError({ reason: "read", path, cause })));
		const json = yield* Effect.try({
			try: () => JSON.parse(text) as unknown,
			catch: (cause) => new LayerPolicyError({ reason: "json", path, cause }),
		});
		return yield* LayerPolicy.decode(json, path);
	});
}
