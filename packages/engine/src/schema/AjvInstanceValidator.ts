import { InstanceFinding, InstanceValidator, InstanceValidatorError } from "@effected/schemastore";
import type { ErrorObject } from "ajv";
import { Effect, Layer } from "effect";
import { makeAjv } from "./internal/ajv.js";

// `InstanceFinding` carries the same structure `ValidationFinding` does, but
// its pointer addresses the INSTANCE — keep the mapping its own function so
// the two report types never cross.
const findingFromAjvError = (error: ErrorObject): InstanceFinding =>
	InstanceFinding.make({
		// ajv's `instancePath` is already a JSON pointer into the value it
		// validated — here, the payload instance itself.
		path: error.instancePath,
		message: error.message ?? "instance is not valid",
		keyword: error.keyword,
	});

/**
 * The shipped `InstanceValidator` implementation: the same ajv strict-mode
 * setup `AjvValidator` gates documents with — the declared `KeywordFamilies`
 * keywords and the standard `ajv-formats` vocabulary registered, through the
 * one shared `makeAjv` — pointed at a payload instance instead of the
 * meta-schema.
 *
 * @remarks
 * Lives in the tool, not the library, for the same reason `AjvValidator`
 * does: `@effected/schemastore` owns the `InstanceValidator` contract and
 * its doubles, an application that imports it at runtime never pulls an
 * engine, and `effected schema validate` composes this layer at its edge. It is
 * exported for a program that validates payloads itself and wants the same
 * verdict the command gives — a document the `check` gate admits always compiles
 * here, so the two engines cannot drift.
 *
 * `validate` compiles the document and runs the instance against it. An
 * instance the document rejects answers `InstanceFinding` values — ajv's
 * structured `instancePath` pointer and `keyword` preserved, `allErrors`
 * on, so one run reports every problem, not just the first. A document the
 * engine cannot compile (a meta-schema failure, a strict-mode rejection, a
 * declared keyword whose NAME ajv's grammar refuses) fails
 * `InstanceValidatorError`: unlike `AjvValidator`, whose subject IS the
 * document, this contract's subject is the instance, and a document that
 * yields no verdict is the engine failing to run as a mechanism. The
 * document's own gate is `SchemaValidator`'s job — `effected schema check` runs
 * it before a document is ever published.
 *
 * `strict` defaults to `true` — SchemaStore's gate. Each call builds its own
 * ajv instance, so documents sharing an `$id` never collide.
 *
 * @example
 * ```ts
 * import { InstanceValidator } from "@effected/schemastore";
 * import { AjvInstanceValidator } from "@effected/engine/schema";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const validator = yield* InstanceValidator;
 *   return yield* validator.validate({ type: "object" }, { any: "payload" });
 * });
 *
 * Effect.runPromise(Effect.provide(program, AjvInstanceValidator.layer));
 * // => []
 * ```
 *
 * @public
 */
export class AjvInstanceValidator {
	private constructor() {}

	/** The engine, as an `InstanceValidator` layer. */
	static readonly layer: Layer.Layer<InstanceValidator> = Layer.succeed(InstanceValidator, {
		validate: (document, instance, options) =>
			Effect.try({
				try: () => {
					const ajv = makeAjv(document, options?.strict ?? true);
					const validate = ajv.compile(document);
					if (validate(instance)) {
						return [];
					}
					return (validate.errors ?? []).map(findingFromAjvError);
				},
				catch: (cause) => InstanceValidatorError.make({ cause }),
			}),
	});
}
