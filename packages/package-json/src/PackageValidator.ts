/**
 * The {@link PackageValidator} service: validate a {@link Package} against a set
 * of {@link ValidationRule}s, aggregating every failure into one
 * {@link PackageValidationError}. Ships {@link PackageValidator.layer} (the
 * default rule set) and the genuinely-parameterized
 * {@link PackageValidator.layerRules} factory.
 *
 * @packageDocumentation
 */

import type { Cause } from "effect";
import { Context, Effect, HashMap, Layer, Option, Result, Schema } from "effect";
import type { Package } from "./Package.js";

/**
 * A single validation-rule failure.
 *
 * @public
 */
export interface RuleFailure {
	/** A human-readable description of the failure. */
	readonly message: string;
	/** The JSON path where the failure occurred, if applicable. */
	readonly path?: Option.Option<string>;
}

/**
 * A single validation rule: a name and a check that fails with a
 * {@link RuleFailure}.
 *
 * @public
 */
export interface ValidationRule {
	/** The rule identifier (e.g. `has-license`). */
	readonly name: string;
	/** The check — succeeds or fails with a {@link RuleFailure}. */
	readonly validate: (pkg: Package) => Effect.Effect<void, RuleFailure>;
}

/**
 * Schema-generated base class backing {@link PackageValidationError}. Not meant
 * to be referenced directly — named and exported only so API Extractor can
 * resolve the heritage clause of the class it backs.
 *
 * @public
 */
export const PackageValidationError_base: Schema.Class<
	PackageValidationError,
	Schema.TaggedStruct<
		"PackageValidationError",
		{
			readonly failures: Schema.$Array<
				Schema.Struct<{
					readonly rule: typeof Schema.String;
					readonly message: typeof Schema.String;
					readonly path: Schema.Option<typeof Schema.String>;
				}>
			>;
		}
	>,
	Cause.YieldableError
> = Schema.TaggedErrorClass<PackageValidationError>()("PackageValidationError", {
	/** The aggregated rule failures. */
	failures: Schema.Array(
		Schema.Struct({
			rule: Schema.String,
			message: Schema.String,
			path: Schema.Option(Schema.String),
		}),
	),
});

/**
 * Indicates that a {@link Package} failed one or more validation rules.
 *
 * Raised by {@link PackageValidator}. Every rule failure is aggregated on
 * `failures`; the `message` getter renders a multi-line report.
 *
 * @public
 */
export class PackageValidationError extends PackageValidationError_base {
	override get message(): string {
		const lines = this.failures.map((failure) => {
			const path = Option.match(failure.path, { onNone: () => "", onSome: (value) => ` (at ${value})` });
			return `  - [${failure.rule}]${path}: ${failure.message}`;
		});
		return `package.json validation failed:\n${lines.join("\n")}`;
	}
}

// ── Default rules ─────────────────────────────────────────────────────────────

const hasLicense: ValidationRule = {
	name: "has-license",
	validate: (pkg) =>
		pkg.license !== undefined
			? Effect.void
			: Effect.fail({ message: "Missing license field", path: Option.some("license") }),
};

const hasDescription: ValidationRule = {
	name: "has-description",
	validate: (pkg) =>
		pkg.description !== undefined
			? Effect.void
			: Effect.fail({ message: "Missing description field", path: Option.some("description") }),
};

const hasRepository: ValidationRule = {
	name: "has-repository",
	// `repository` is a modeled field now — no poking into `pkg.rest`.
	validate: (pkg) =>
		pkg.repository !== undefined
			? Effect.void
			: Effect.fail({ message: "Missing repository field", path: Option.some("repository") }),
};

const notPrivate: ValidationRule = {
	name: "not-private",
	validate: (pkg) =>
		pkg.isPrivate ? Effect.fail({ message: "Package is private", path: Option.some("private") }) : Effect.void,
};

const anyDependencyMatches = (pkg: Package, predicate: (specifier: string) => boolean): boolean =>
	[pkg.dependencies, pkg.devDependencies, pkg.peerDependencies, pkg.optionalDependencies].some((map) =>
		Array.from(HashMap.values(map)).some(predicate),
	);

/**
 * A rule that fails when any dependency uses an unresolved `workspace:` or
 * `catalog:` specifier.
 *
 * @public
 */
export const noUnresolvedDepsRule: ValidationRule = {
	name: "no-unresolved-deps",
	validate: (pkg) =>
		anyDependencyMatches(pkg, (specifier) => specifier.startsWith("workspace:") || specifier.startsWith("catalog:"))
			? Effect.fail({ message: "Unresolved workspace:/catalog: dependency", path: Option.none() })
			: Effect.void,
};

/**
 * A rule that fails when any dependency uses a local `file:`, `link:` or
 * `portal:` specifier.
 *
 * @public
 */
export const noLocalDepsRule: ValidationRule = {
	name: "no-local-deps",
	validate: (pkg) =>
		anyDependencyMatches(
			pkg,
			(specifier) => specifier.startsWith("file:") || specifier.startsWith("link:") || specifier.startsWith("portal:"),
		)
			? Effect.fail({ message: "Local file:/link:/portal: dependency", path: Option.none() })
			: Effect.void,
};

/**
 * The default validation rules: license, description, repository and
 * not-private.
 *
 * @public
 */
export const defaultRules: ReadonlyArray<ValidationRule> = [hasLicense, hasDescription, hasRepository, notPrivate];

const runRules = Effect.fn("PackageValidator.validate")(function* (pkg: Package, rules: ReadonlyArray<ValidationRule>) {
	const failures: Array<{ readonly rule: string; readonly message: string; readonly path: Option.Option<string> }> = [];
	for (const rule of rules) {
		const result = yield* Effect.result(rule.validate(pkg));
		if (Result.isFailure(result)) {
			failures.push({ rule: rule.name, message: result.failure.message, path: result.failure.path ?? Option.none() });
		}
	}
	if (failures.length > 0) {
		return yield* new PackageValidationError({ failures });
	}
});

/**
 * Service-key base backing {@link PackageValidator}. Not meant to be referenced
 * directly — named and exported only so API Extractor can resolve the heritage
 * clause of the class it backs.
 *
 * @public
 */
export const PackageValidator_base: Context.ServiceClass<
	PackageValidator,
	"@effected/package-json/PackageValidator",
	{ readonly validate: (pkg: Package) => Effect.Effect<void, PackageValidationError> }
> = Context.Service<
	PackageValidator,
	{ readonly validate: (pkg: Package) => Effect.Effect<void, PackageValidationError> }
>()("@effected/package-json/PackageValidator");

/**
 * Validates a {@link Package} against a set of {@link ValidationRule}s,
 * aggregating every failure into one {@link PackageValidationError}.
 *
 * @public
 */
export class PackageValidator extends PackageValidator_base {
	/** The default layer, backed by {@link defaultRules}. */
	static readonly layer: Layer.Layer<PackageValidator> = Layer.succeed(PackageValidator, {
		validate: (pkg) => runRules(pkg, defaultRules),
	});

	/** Build a layer from a custom set of rules (a genuinely-parameterized factory). */
	static layerRules(config: { readonly rules: ReadonlyArray<ValidationRule> }): Layer.Layer<PackageValidator> {
		return Layer.succeed(PackageValidator, { validate: (pkg) => runRules(pkg, config.rules) });
	}
}
