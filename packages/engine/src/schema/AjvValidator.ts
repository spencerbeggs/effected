import { SchemaValidator, SchemaValidatorError, ValidationFinding } from "@effected/schemastore";
import type { ErrorObject } from "ajv";
import { Effect, Layer } from "effect";
import { makeAjv } from "./internal/ajv.js";

const findingFromAjvError = (error: ErrorObject): ValidationFinding =>
	ValidationFinding.make({
		// ajv's `instancePath` is already a JSON pointer into the value it
		// validated — here, the flat document itself.
		path: error.instancePath,
		message: error.message ?? "schema is not valid",
		keyword: error.keyword,
	});

/**
 * The shipped `SchemaValidator` implementation: ajv strict mode over the
 * Draft-07 meta-schema, with every declared `KeywordFamilies` keyword and
 * the standard `ajv-formats` vocabulary registered.
 *
 * @remarks
 * Lives in the tool, not the library, so `ajv` is a cost only the tool pays:
 * `@effected/schemastore` owns the `SchemaValidator` contract and its doubles,
 * an application that imports it at runtime never pulls an engine, and
 * `SchemaRun` composes this layer at its edge. It is exported for a program that
 * drives `SchemaPipeline` itself and wants the same verdict the command gives.
 *
 * `validate` checks the document against the Draft-07 meta-schema and then
 * compiles it, reporting BOTH as `ValidationFinding` values: meta-schema
 * failures keep ajv's structured `instancePath` and `keyword`, while a
 * rejection ajv raises by *throwing* becomes a root-pathed finding — both a
 * strict-mode compile failure and a declared keyword whose NAME ajv's own
 * grammar (`/^[a-z_$][a-z0-9_$:-]*$/i`) refuses, such as an `x-ai-*` key
 * carrying a dot or a space. The error channel stays reserved for the engine
 * failing as a mechanism (`SchemaValidatorError`).
 *
 * The ajv setup is `internal/ajv.ts`'s `makeAjv`, shared with
 * `AjvInstanceValidator` so a document this gate admits always compiles in
 * the instance engine too — the two verdicts cannot drift.
 *
 * `strict` defaults to `true` — SchemaStore's gate. Each call builds its own
 * ajv instance, so documents sharing an `$id` never collide. Registering the
 * declared families keeps the engine's verdict consistent with
 * `DocumentLint`'s through the same predicate, so the two cannot drift; the
 * plugin's `formatMaximum` / `formatMinimum` limit keywords are deliberately
 * NOT registered, because the lint answers those as unknown keywords.
 * @example
 * ```ts
 * import { SchemaValidator } from "@effected/schemastore";
 * import { AjvValidator } from "@effected/engine/schema";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const validator = yield* SchemaValidator;
 *   return yield* validator.validate({ type: "object" });
 * });
 *
 * Effect.runPromise(Effect.provide(program, AjvValidator.layer));
 * // => []
 * ```
 *
 * @public
 */
export class AjvValidator {
	private constructor() {}

	/** The engine, as a `SchemaValidator` layer. */
	static readonly layer: Layer.Layer<SchemaValidator> = Layer.succeed(SchemaValidator, {
		validate: (document, options) =>
			Effect.try({
				try: () => {
					try {
						// `makeAjv` sits inside the try, beside `validateSchema` and
						// `compile`, on purpose: ajv holds a keyword NAME to
						// `/^[a-z_$][a-z0-9_$:-]*$/i`, so a declared key carrying a
						// dot, a space or an `@` makes its `addKeyword` throw. That
						// is the engine rejecting the DOCUMENT, not the engine
						// failing as a mechanism — outside the try it escaped as a
						// `SchemaValidatorError` and aborted the totality of
						// `SchemaPipeline.check`.
						const ajv = makeAjv(document, options?.strict ?? true);
						if (!ajv.validateSchema(document)) {
							return (ajv.errors ?? []).map(findingFromAjvError);
						}
						ajv.compile(document);
					} catch (cause) {
						// Strict mode and the keyword-name check both report by
						// throwing; the message is all the structure ajv gives us
						// on this path.
						return [
							ValidationFinding.make({
								path: "",
								message: cause instanceof Error ? cause.message : String(cause),
							}),
						];
					}
					return [];
				},
				catch: (cause) => SchemaValidatorError.make({ cause }),
			}),
	});
}
