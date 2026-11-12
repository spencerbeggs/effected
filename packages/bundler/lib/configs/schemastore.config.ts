/**
 * The JSON Schema for `effected.toml`: `EffectedConfig`, the schema the build
 * decodes the file with, becomes the published `config` document under the
 * repository's `schemas/`. Run via `pnpm schema:build` / `pnpm schema:check`
 * in this package; `build` regenerates it first.
 *
 * `published: false` until the kit's 1.0: the document regenerates in place
 * and a contract change is never drift. Flip it once a version is released.
 */
import { HostedSchema, defineSchemastore } from "@effected/plugin";
import { EffectedConfig } from "../../src/config/BuildConfig.js";

export default defineSchemastore({
	outputDir: "../../../../schemas",
	name: "effected",
	schemas: {
		config: {
			schema: EffectedConfig,
			hosted: HostedSchema.github({
				repo: "spencerbeggs/effected",
				path: "schemas",
				name: "config",
				versions: ["1.0"],
				appendVersion: false,
			}),
			published: false,
			catalog: {
				description: "effected build config: the [package] and [action] tables of effected.toml",
				fileMatch: ["effected.toml", "**/.config/effected.toml", "**/lib/configs/effected.toml"],
			},
		},
	},
});
