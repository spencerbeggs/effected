/**
 * Where the `effected.toml` JSON Schema is published, as data.
 *
 * @remarks
 * One place for the identity, so the document the repository builds and the
 * `#:schema` directive a scaffold writes can never name different URLs. `host`
 * is the input to `@effected/schemastore`'s `HostedSchema.github`, whose
 * derived `$id` is `url`. `directive` is the first line of an `effected.toml`
 * that points tombi, taplo and other TOML editors at the schema; tombi wants a
 * blank line after it.
 *
 * @example
 * ```ts
 * import { EffectedConfigSchema } from "@effected/bundler";
 *
 * const toml = `${EffectedConfigSchema.directive}\n\n[action.entries]\nmain = "src/main.ts"\n`;
 * ```
 *
 * @public
 */
export const EffectedConfigSchema = {
	/** The `HostedSchema.github` input that publishes the document. */
	host: {
		repo: "spencerbeggs/effected",
		path: "schemas",
		name: "config",
		versions: ["1.0"],
		appendVersion: false,
	},
	/** The document's canonical URL, its `$id`. */
	url: "https://raw.githubusercontent.com/spencerbeggs/effected/main/schemas/1.0/config.json",
	/** The `#:schema` directive line naming {@link EffectedConfigSchema.url}. */
	directive: "#:schema https://raw.githubusercontent.com/spencerbeggs/effected/main/schemas/1.0/config.json",
} as const;
