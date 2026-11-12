import { Schema } from "effect";
import { EffectedConfig } from "./BuildConfig.js";

/**
 * The schema the published `effected.toml` JSON Schema is generated from: {@link EffectedConfig}'s fields as a
 * plain struct, carrying the document root's annotations.
 *
 * @remarks
 * A `Schema.Class` root lowers to a bare `$ref`, and tombi reads `x-tombi-toml-version` from the document root
 * itself, so the root is an inline struct over the same fields instead. It decodes exactly as
 * {@link EffectedConfig} does; the build never decodes with it. Not exported from the package root.
 *
 * @internal
 */
export const EffectedConfigDocument = Schema.Struct(EffectedConfig.fields).annotate({
	title: "effected config",
	description:
		"The effected build config, effected.toml. A root file at the workspace root and a package file in each package are discovered and merged, the package's over the root's, and the merged file is decoded strictly: an unknown key fails the build.\nhttps://github.com/spencerbeggs/effected/tree/main/packages/bundler",
	"x-tombi-toml-version": "v1.1.0",
});

/**
 * The JSON Schema generation options the published document is built with.
 *
 * @remarks
 * A `Schema.Class` lowers its encoded side, which the generator names `<identifier>Encoded`. The reference policy
 * drops that suffix, so the document's definitions read `PackageConfig`, `ActionConfig` and so on. Putting an
 * `identifier` on each class's encoded struct would also rename them, but it changes decode messages from
 * `Expected object` to `Expected PackageConfig`, so the rename lives here, where only the document sees it.
 *
 * @internal
 */
export const effectedConfigJsonSchemaOptions: Schema.ToJsonSchemaOptions = {
	referencePolicy: ({ identifier }) =>
		identifier?.endsWith("Encoded") ? identifier.slice(0, -"Encoded".length) : identifier,
};
