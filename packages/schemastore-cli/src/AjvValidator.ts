import { KeywordFamilies, SchemaValidator, SchemaValidatorError, ValidationFinding } from "@effected/schemastore";
import type { ErrorObject } from "ajv";
import { Ajv } from "ajv";
import ajvFormats from "ajv-formats";
import { Effect, Layer } from "effect";

// `ajv-formats` does `module.exports = exports = formatsPlugin` but declares
// `export default` in its `.d.ts`, so TypeScript models the default import as
// the module namespace and calling it directly is a TS2349. Its `.default`
// points back at the plugin itself, which is the callable under BOTH Node's
// ESM interop (where the binding is `module.exports`) and an
// `__esModule`-honouring bundler (where it is `exports.default`) — so this one
// hop lands on the plugin in either world, with its real types and no cast.
const addFormats = ajvFormats.default;

// Mirrors the library's `MAX_NESTING_DEPTH` (`internal/limits.ts`, not on
// its public surface — that file cross-references this one). The two must
// move together: a document the library admits at depth N whose declared
// keywords this walk stopped collecting before N would fail strict mode as
// unknown keywords, a false gate failure.
const MAX_KEYWORD_WALK_DEPTH = 256;

// ajv strict mode rejects any keyword it does not know, which would fail
// every document carrying a declared language-server family — exactly the
// keywords `DocumentLint` deliberately allows. Registering them keeps the
// engine's verdict consistent with the owned lint's, through the same
// `KeywordFamilies` predicate, so the two cannot drift.
const collectDeclaredKeywords = (node: unknown, into: Set<string>, depth: number): void => {
	if (depth >= MAX_KEYWORD_WALK_DEPTH || typeof node !== "object" || node === null) {
		return;
	}
	if (Array.isArray(node)) {
		for (const element of node) {
			collectDeclaredKeywords(element, into, depth + 1);
		}
		return;
	}
	for (const [key, value] of Object.entries(node)) {
		if (KeywordFamilies.isDeclared(key)) {
			// The payload is opaque advice the library copied verbatim, and ajv
			// never strict-checks inside a registered keyword's value — so a
			// prefix-matching key INSIDE it (`x-ai-model.name`) is data, not a
			// keyword. Registering it would make ajv's name grammar reject a
			// document the library accepted. Stop at the declared key.
			into.add(key);
			continue;
		}
		collectDeclaredKeywords(value, into, depth + 1);
	}
};

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
 * Lives in the CLI, not the library, so `ajv` is a cost only the command
 * pays: `@effected/schemastore` owns the `SchemaValidator` contract
 * and its doubles, an application that imports it at runtime never pulls an
 * engine, and the `schemastore` command composes this layer at its edge. It
 * is exported for a program that drives `SchemaPipeline` itself and wants
 * the same verdict the command gives.
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
 * `strict` defaults to `true` — SchemaStore's gate. Each call builds its own
 * ajv instance, so documents sharing an `$id` never collide. Registering the
 * declared families keeps the engine's verdict consistent with
 * `DocumentLint`'s through the same predicate, so the two cannot drift; the
 * plugin's `formatMaximum` / `formatMinimum` limit keywords are deliberately
 * NOT registered, because the lint answers those as unknown keywords.
 *
 * @example
 * ```ts
 * import { SchemaValidator } from "@effected/schemastore";
 * import { AjvValidator } from "@effected/schemastore-cli";
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
					const ajv = new Ajv({ strict: options?.strict ?? true, allErrors: true });
					// Without the standard format vocabulary, strict mode rejects
					// every document using `format` as an unknown format, so a
					// consumer cannot say "this string is an ISO-8601 instant" —
					// only a `pattern` fallback. An unknown format string still
					// fails strict mode. `keywords: false` is load-bearing: the
					// plugin's default ALSO registers `formatMaximum` /
					// `formatMinimum` and their exclusive variants, which
					// `DocumentLint` answers as unknown keywords — registering them
					// would drift the two verdicts apart. Only the format
					// vocabulary belongs behind this gate.
					addFormats(ajv, { keywords: false });
					const declared = new Set<string>();
					collectDeclaredKeywords(document, declared, 0);
					try {
						// `addKeyword` sits inside the try, beside `compile`, on
						// purpose: ajv holds a keyword NAME to
						// `/^[a-z_$][a-z0-9_$:-]*$/i`, so a declared key carrying a
						// dot, a space or an `@` makes it throw. That is the engine
						// rejecting the DOCUMENT, not the engine failing as a
						// mechanism — outside the try it escaped as a
						// `SchemaValidatorError` and aborted the totality of
						// `SchemaPipeline.check`.
						for (const keyword of declared) {
							ajv.addKeyword({ keyword });
						}
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
