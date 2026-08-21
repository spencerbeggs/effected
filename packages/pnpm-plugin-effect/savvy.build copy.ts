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
