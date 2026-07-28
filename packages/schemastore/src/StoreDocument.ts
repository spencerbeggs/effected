import { Effect, JsonSchema, Result, Schema } from "effect";
import type { CanonicalJsonError, CanonicalJsonOptions } from "./CanonicalJson.js";
import { CanonicalJson } from "./CanonicalJson.js";
import { MAX_NESTING_DEPTH } from "./internal/limits.js";

/**
 * The Draft-07 meta-schema URL SchemaStore documents declare as `$schema`.
 *
 * Deliberately carries the trailing `#` fragment: the SchemaStore corpus
 * (and the extraction source's committed files) use the fragment form,
 * where core's `JsonSchema.META_SCHEMA_URI_DRAFT_07` omits it.
 *
 * @public
 */
export const DRAFT_07_META_SCHEMA = "http://json-schema.org/draft-07/schema#";

/**
 * Indicates that an Effect Schema could not be converted into a SchemaStore
 * document — core's JSON Schema generation rejected the schema, or the
 * generated document nested past the hardening cap.
 *
 * Raised by {@link StoreDocument.fromSchema}. The `cause` carries the
 * underlying failure for the operator; calling code branches on the tag.
 *
 * @public
 */
export class SchemaConversionError extends Schema.TaggedErrorClass<SchemaConversionError>()("SchemaConversionError", {
	/** The `$id` of the document that failed to build. */
	$id: Schema.String,
	/** The underlying conversion failure. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `Failed to build SchemaStore document "${this.$id}"`;
	}
}

/**
 * Options for {@link StoreDocument.fromSchema}.
 *
 * @public
 */
export interface StoreDocumentOptions {
	/** The canonical `$id` URL the document declares. */
	readonly $id: string;
	/**
	 * Passed through to core's `Schema.toJsonSchemaDocument`
	 * (`additionalProperties`, `generateDescriptions`,
	 * `includeAnnotationKey`).
	 *
	 * Know the boundary: keys admitted by `includeAnnotationKey` reach the
	 * Draft 2020-12 document but are **dropped by the Draft-07 lowering**
	 * (its keyword walk copies a fixed subset) — verified against the
	 * installed beta. Carrying non-standard keyword families into the
	 * emitted document is the phase-2 annotation-carrier work, which must
	 * re-graft them after the lowering rather than ride this option alone.
	 */
	readonly jsonSchema?: Schema.ToJsonSchemaOptions;
}

// Matches a Draft-07 `#/definitions/...` `$ref` pointer prefix. Core's
// Draft-07 lowering rewrites `#/$defs/...` refs to the canonical
// `#/definitions/...` form; the SchemaStore document keeps its pool under
// `$defs` (a Draft-07-valid alias), so refs are rewritten back to stay
// resolvable against that pool.
const DEFINITIONS_REF_PREFIX = /^#\/definitions(?=\/|$)/;

class RewriteDepthExceeded {
	readonly _tag = "RewriteDepthExceeded";
}

// Recursively rewrites `#/definitions/...` `$ref` string values back to
// `#/$defs/...`. Only `$ref` values are touched: keys, non-string `$ref`s
// and prose containing "#/definitions" pass through untouched.
const restoreDefsRefs = (node: unknown, depth: number): unknown => {
	if (depth >= MAX_NESTING_DEPTH) {
		throw new RewriteDepthExceeded();
	}
	if (Array.isArray(node)) {
		return node.map((item) => restoreDefsRefs(item, depth + 1));
	}
	if (typeof node === "object" && node !== null) {
		const out: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(node)) {
			out[key] =
				key === "$ref" && typeof value === "string"
					? value.replace(DEFINITIONS_REF_PREFIX, "#/$defs")
					: restoreDefsRefs(value, depth + 1);
		}
		return out;
	}
	return node;
};

/**
 * A SchemaStore-shaped Draft-07 JSON Schema document assembled from an
 * Effect Schema source: `$schema` (the Draft-07 meta-schema) + `$id` + the
 * root schema + the `$defs` pool.
 *
 * {@link StoreDocument.fromSchema} owns the whole pipeline: core's
 * `Schema.toJsonSchemaDocument` (Draft 2020-12), core's
 * `JsonSchema.toDocumentDraft07` lowering, and the `#/definitions` →
 * `#/$defs` `$ref` rewrite the lowering makes necessary — so every `$ref`
 * in a built document already resolves against the `$defs` pool. The
 * package owns assembly and publication shape, not a JSON Schema engine.
 *
 * @public
 */
export class StoreDocument extends Schema.Class<StoreDocument>("StoreDocument")({
	/** The meta-schema URL ({@link DRAFT_07_META_SCHEMA}). */
	$schema: Schema.String,
	/** The canonical `$id` URL. */
	$id: Schema.String,
	/** The root schema's keywords, without the definitions pool. */
	root: Schema.Record(Schema.String, Schema.Unknown),
	/** The definitions pool, emitted under `$defs`. */
	defs: Schema.Record(Schema.String, Schema.Unknown),
}) {
	/**
	 * Builds the document for an Effect Schema source. Pure and
	 * synchronous — the primitive form; {@link StoreDocument.fromSchema} is
	 * the same pipeline behind a span.
	 */
	static fromSchemaResult(
		source: Schema.Constraint,
		options: StoreDocumentOptions,
	): Result.Result<StoreDocument, SchemaConversionError> {
		try {
			const lowered = JsonSchema.toDocumentDraft07(Schema.toJsonSchemaDocument(source, options.jsonSchema));
			const root = restoreDefsRefs(lowered.schema, 0) as Record<string, unknown>;
			const defs: Record<string, unknown> = {};
			for (const [name, definition] of Object.entries(lowered.definitions)) {
				defs[name] = restoreDefsRefs(definition, 1);
			}
			return Result.succeed(StoreDocument.make({ $schema: DRAFT_07_META_SCHEMA, $id: options.$id, root, defs }));
		} catch (cause) {
			return Result.fail(SchemaConversionError.make({ $id: options.$id, cause }));
		}
	}

	/**
	 * Effect form of {@link StoreDocument.fromSchemaResult}, adding only the
	 * `StoreDocument.fromSchema` span. Defined in terms of the `Result`
	 * primitive — synchronous callers can use that variant directly.
	 */
	static readonly fromSchema = Effect.fn("StoreDocument.fromSchema")(
		(source: Schema.Constraint, options: StoreDocumentOptions): Effect.Effect<StoreDocument, SchemaConversionError> =>
			Effect.fromResult(StoreDocument.fromSchemaResult(source, options)),
	);

	/**
	 * The flat SchemaStore publication shape: `$schema`, `$id`, the root
	 * schema's keywords spread at the top level, then the `$defs` pool.
	 * `$defs` is omitted when the pool is empty (a deliberate divergence
	 * from the extraction source, which always emitted the key).
	 */
	toJson(): Record<string, unknown> {
		return {
			$schema: this.$schema,
			$id: this.$id,
			...this.root,
			...(Object.keys(this.defs).length > 0 ? { $defs: this.defs } : {}),
		};
	}

	/**
	 * Canonical JSON text of {@link StoreDocument.toJson}, via
	 * {@link CanonicalJson.serializeResult} — one serializer, so the
	 * document and any consumer-serialized value cannot drift.
	 */
	serializeResult(options?: CanonicalJsonOptions): Result.Result<string, CanonicalJsonError> {
		return CanonicalJson.serializeResult(this.toJson(), options);
	}
}
