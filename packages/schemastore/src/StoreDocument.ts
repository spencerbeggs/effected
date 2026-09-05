import { Effect, JsonSchema, Result, Schema } from "effect";
import type { CanonicalJsonError, CanonicalJsonOptions } from "./CanonicalJson.js";
import { CanonicalJson } from "./CanonicalJson.js";
import { MAX_NESTING_DEPTH } from "./internal/limits.js";
import { KeywordFamilies } from "./KeywordFamilies.js";

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
export class SchemaConversionError extends Schema.TaggedError<SchemaConversionError>()("SchemaConversionError", {
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
 * Indicates that a caller-supplied `includeAnnotationKey` admitted an
 * annotation key outside the declared keyword families
 * ({@link KeywordFamilies}).
 *
 * Raised by {@link StoreDocument.fromSchema}. This package emits
 * SchemaStore-compatible documents only, so the declared families are the
 * whole permitted non-standard surface. A key outside them is refused
 * loudly rather than emitted — which would ship a document SchemaStore's
 * own gate rejects — or silently omitted, which would hide the mistake in
 * the caller's predicate.
 *
 * The predicate itself cannot be introspected, so the offending keys are
 * the ones it actually admitted while the document was being generated: a
 * key the source schema never annotates cannot appear here.
 *
 * @public
 */
export class UndeclaredAnnotationKeyError extends Schema.TaggedError<UndeclaredAnnotationKeyError>()(
	"UndeclaredAnnotationKeyError",
	{
		/** The `$id` of the document that was being built. */
		$id: Schema.String,
		/** The offending keys, deduplicated and sorted. */
		keys: Schema.Array(Schema.String),
	},
) {
	override get message(): string {
		const keys = this.keys.map((key) => `"${key}"`).join(", ");
		return `Document "${this.$id}" admits annotation keys outside the declared families: ${keys}`;
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
	 * The declared non-standard keyword families ({@link KeywordFamilies})
	 * are **always admitted**, regardless of what a supplied
	 * `includeAnnotationKey` answers — annotate a schema node
	 * (`Schema.String.annotate({ "x-taplo": ... })`) and the key appears in
	 * the built document, in place, on the node it was attached to.
	 *
	 * A supplied `includeAnnotationKey` is consulted only for other keys,
	 * and **admitting one fails the build** with
	 * {@link UndeclaredAnnotationKeyError}. The families are the entire
	 * non-standard surface this package will emit, so the predicate has no
	 * admitting role left; it survives only because the rest of
	 * `ToJsonSchemaOptions` passes through, and is best left unset.
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
//
// A declared-family value is passed through VERBATIM — the walk does not
// descend into it. Those values are opaque payloads addressed to a language
// server, not schema positions: a `$ref`-shaped string inside one means
// whatever that tool says it means, and rewriting it would corrupt it. It
// also keeps a deep payload from spending the walk's depth budget.
const restoreDefsRefs = (node: unknown, depth: number): unknown => {
	if (depth >= MAX_NESTING_DEPTH) {
		throw new RewriteDepthExceeded();
	}
	if (Array.isArray(node)) {
		return node.map((item) => restoreDefsRefs(item, depth + 1));
	}
	if (typeof node === "object" && node !== null) {
		// Null-prototype accumulator: assigning a literal `__proto__` key to
		// a `{}` literal invokes the prototype setter — the key is dropped
		// and the accumulator's prototype becomes attacker-controlled. With
		// no prototype there is no setter; the key lands as a plain own
		// property. (Defense in depth: probed at the installed beta, core's
		// generation and lowering strip `__proto__` keys before this walk
		// runs, but this walk must stay safe on its own terms.)
		const out: Record<string, unknown> = Object.create(null);
		for (const [key, value] of Object.entries(node)) {
			if (KeywordFamilies.isDeclared(key)) {
				// Copied by REFERENCE, not cloned: this is the SAME object the
				// caller handed to `.annotate()`, which lives on the schema AST.
				// Mutating a carried `x-ai-*` value in place therefore corrupts
				// every later emission from that schema, not merely this
				// document — treat the emitted document as read-only.
				out[key] = value;
				continue;
			}
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
 * `JsonSchema.toDocumentDraft07` lowering, the `#/definitions` →
 * `#/$defs` `$ref` rewrite the lowering makes necessary — so every `$ref`
 * in a built document already resolves against the `$defs` pool — and the
 * gate that holds the document's non-standard surface to the declared
 * keyword families ({@link KeywordFamilies}). The package owns assembly and
 * publication shape, not a JSON Schema engine.
 *
 * Annotated declared-family keys survive into the built document because
 * core's Draft-07 lowering copies unknown and custom keywords through as
 * opaque values, in place, including across the tuple coordinate move
 * (2020-12 `prefixItems[i]` → Draft-07 `items[i]`, trailing `items` →
 * `additionalItems`). This package therefore does no re-grafting of its
 * own; it only declines to rewrite `$ref`-shaped strings *inside* those
 * opaque payloads.
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
	 * Builds a Draft-07 document from its parts, filling `$schema` with
	 * {@link DRAFT_07_META_SCHEMA}.
	 *
	 * `fromSchema` sets the meta-schema unconditionally; hand-building a
	 * value with `make` otherwise means importing the constant just to
	 * repeat what the package already knows. `$schema` stays a real field
	 * rather than a defaulted one — it declares the document's dialect, and
	 * a document that does not say which dialect it is written in is worse
	 * than one that repeats itself — so this is a constructor, not a
	 * default.
	 *
	 * @example
	 * ```ts
	 * import { StoreDocument } from "@effected/schemastore";
	 *
	 * const document = StoreDocument.draft07({
	 *   $id: "https://example.com/config.schema.json",
	 *   root: { type: "object" },
	 * });
	 * ```
	 */
	static draft07(options: {
		readonly $id: string;
		readonly root: Record<string, unknown>;
		readonly defs?: Record<string, unknown>;
	}): StoreDocument {
		return StoreDocument.make({
			$schema: DRAFT_07_META_SCHEMA,
			$id: options.$id,
			root: options.root,
			defs: options.defs ?? {},
		});
	}

	/**
	 * Builds the document for an Effect Schema source. Pure and
	 * synchronous — the primitive form; {@link StoreDocument.fromSchema} is
	 * the same pipeline behind a span.
	 */
	static fromSchemaResult(
		source: Schema.Constraint,
		options: StoreDocumentOptions,
	): Result.Result<StoreDocument, SchemaConversionError | UndeclaredAnnotationKeyError> {
		try {
			const userIncludes = options.jsonSchema?.includeAnnotationKey;
			// A predicate cannot be introspected, so the gate is enforced by
			// wrapping it: every key it admits outside the declared families is
			// recorded and then refused. Recorded keys are NOT admitted into the
			// generated document — the build fails, so admitting them could only
			// let core's own lowering throw first and bury the real cause.
			const undeclared = new Set<string>();
			const document = Schema.toJsonSchemaDocument(source, {
				...options.jsonSchema,
				includeAnnotationKey: (key) => {
					if (KeywordFamilies.isDeclared(key)) {
						return true;
					}
					if (userIncludes?.(key) === true) {
						undeclared.add(key);
					}
					return false;
				},
			});
			if (undeclared.size > 0) {
				return Result.fail(UndeclaredAnnotationKeyError.make({ $id: options.$id, keys: [...undeclared].sort() }));
			}
			const lowered = JsonSchema.toDocumentDraft07(document);
			const root = restoreDefsRefs(lowered.schema, 0) as Record<string, unknown>;
			// Null-prototype for the same `__proto__` hardening as the rewrite
			// walk: a definition named `__proto__` must land as an own key.
			const defs: Record<string, unknown> = Object.create(null);
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
		(
			source: Schema.Constraint,
			options: StoreDocumentOptions,
		): Effect.Effect<StoreDocument, SchemaConversionError | UndeclaredAnnotationKeyError> =>
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
