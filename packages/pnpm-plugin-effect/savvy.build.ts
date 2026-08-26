import { build } from "@savvy-web/bundler";
import { PnpmConfigPlugin } from "rolldown-pnpm-config";

await build({
	meta: {
		tsdoc: {
			suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
		},
	},
	plugins: [
		PnpmConfigPlugin({
			name: "@effected/pnpm-plugin-effect",
			peerDependencyRules: {
				allowedVersionsFromCatalogs: {
					catalog: "effect", // which catalog supplies the satellites
					peer: "effect", // the peer each rule targets
					prefix: null,
				},
			},
			catalogs: {
				effect: {
					packages: {
						"@effect/ai-anthropic": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/ai-openai": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/ai-openai-compat": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/ai-openrouter": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/atom-react": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/atom-solid": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/atom-vue": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/openapi-generator": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/opentelemetry": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/platform-browser": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/platform-bun": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/platform-node": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/platform-node-shared": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/sql-clickhouse": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/sql-d1": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/sql-libsql": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/sql-mssql": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/sql-mysql2": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/sql-pg": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/sql-pglite": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/sql-sqlite-bun": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/sql-sqlite-do": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/sql-sqlite-node": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/sql-sqlite-react-native": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/sql-sqlite-wasm": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/vitest": {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
						"@effect/tsgo": {
							range: "0.36.5",
							peer: "0.36.5",
							strategy: "lock",
						},
						effect: {
							range: "4.0.0-rc.109",
							peer: "4.0.0-rc.109",
							strategy: "lock",
						},
					},
				},
				/**
				 * The kit's own version surface, consumed across the ecosystem as
				 * `catalog:effected` and `catalog:effected:peers`.
				 *
				 * `@effected/pnpm-plugin-effect` is deliberately ABSENT and must stay absent. It is
				 * the package this catalog ships inside: catalogue it, and every catalog rewrite
				 * bumps the plugin, which invalidates the catalog, which writes another changeset —
				 * an infinite release loop. The omission is the termination condition, not an
				 * oversight.
				 */
				effected: {
					packages: {
						"@effected/app": {
							range: "^0.13.1",
							peer: "^0.13.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/cli": {
							range: "^0.2.0",
							peer: "^0.2.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/commands": {
							range: "^0.5.0",
							peer: "^0.5.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/config-file": {
							range: "^0.5.2",
							peer: "^0.5.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/git": {
							range: "^0.10.0",
							peer: "^0.10.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/github": {
							range: "^0.8.0",
							peer: "^0.8.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/github-actions": {
							range: "^0.10.1",
							peer: "^0.10.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/github-references": {
							range: "^0.1.0",
							peer: "^0.1.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/glob": {
							range: "^0.4.0",
							peer: "^0.4.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/jsonc": {
							range: "^0.8.0",
							peer: "^0.8.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/jsonl": {
							range: "^0.3.0",
							peer: "^0.3.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/lockfiles": {
							range: "^0.7.1",
							peer: "^0.7.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/markdown": {
							range: "^0.7.0",
							peer: "^0.7.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/memfs": {
							range: "^0.5.0",
							peer: "^0.5.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/npm": {
							range: "^0.12.1",
							peer: "^0.12.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/package-json": {
							range: "^0.13.0",
							peer: "^0.13.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/runtimes": {
							range: "^0.4.3",
							peer: "^0.4.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/sbom": {
							range: "^0.4.4",
							peer: "^0.4.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/schema-org": {
							range: "^0.1.0",
							peer: "^0.1.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/schemastore": {
							range: "^0.4.0",
							peer: "^0.4.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/semver": {
							range: "^0.5.0",
							peer: "^0.5.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/spdx": {
							range: "^0.5.0",
							peer: "^0.5.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/store": {
							range: "^0.5.0",
							peer: "^0.5.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/templates": {
							range: "^0.4.0",
							peer: "^0.4.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/toml": {
							range: "^0.5.0",
							peer: "^0.5.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/tsconfig-json": {
							range: "^0.6.1",
							peer: "^0.6.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/walker": {
							range: "^0.5.0",
							peer: "^0.5.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/workspaces": {
							range: "^0.18.3",
							peer: "^0.18.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/xdg": {
							range: "^0.3.0",
							peer: "^0.3.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/yaml": {
							range: "^0.12.0",
							peer: "^0.12.0",
							strategy: "lock-minor",
							source: "workspace",
						},
					},
				},
			},
			minimumReleaseAgeExclude: ["@effect/tsgo-*"],
		}),
	],
	bundleNodeModules: true,
	looseFiles: {
		"pnpmfile.mjs": "./src/pnpmfile.ts",
		"pnpmfile.cjs": "./src/pnpmfile.ts",
	},
});
