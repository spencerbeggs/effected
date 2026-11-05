import { Option, Predicate } from "effect";
import { VERSION, VERSION_STAMP } from "./internal/version.js";

/**
 * Which copy of `@effected/schemastore` produced a value.
 *
 * @remarks
 * `HostedSchema` and the `defineConfig` result carry a non-enumerable stamp under
 * `Symbol.for("@effected/schemastore/version")`, so a tool can tell whether a
 * config's values came from the same version it was built against. A
 * `HostedSchema` from another copy keeps that copy's stamp on
 * `ResolvedSchema.hosted`. Two copies at one version are indistinguishable, and
 * an unbuilt source run reads `"0.0.0"`.
 *
 * @example
 * ```ts
 * import { HostedSchema, SchemastoreVersion } from "@effected/schemastore";
 * import { Option } from "effect";
 *
 * const hosted = HostedSchema.github({ repo: "o/r", name: "config" });
 * console.log(Option.contains(SchemastoreVersion.of(hosted), SchemastoreVersion.current));
 * // => true
 * ```
 *
 * @public
 */
export class SchemastoreVersion {
	private constructor() {}

	/** The version of this copy of the package. */
	static readonly current: string = VERSION;

	/** The version stamped on `value`, or `Option.none()` when it carries no stamp. */
	static of(value: unknown): Option.Option<string> {
		if (!Predicate.hasProperty(value, VERSION_STAMP)) {
			return Option.none();
		}
		const stamp = value[VERSION_STAMP];
		return Predicate.isString(stamp) ? Option.some(stamp) : Option.none();
	}
}
