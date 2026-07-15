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
			catalogs: {
				effect: {
					packages: {
						"@effect/ai-anthropic": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/ai-openai": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/ai-openai-compat": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/ai-openrouter": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/atom-react": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/atom-solid": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/atom-vue": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/openapi-generator": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/opentelemetry": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/platform-browser": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/platform-bun": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/platform-node": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/platform-node-shared": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/sql-clickhouse": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/sql-d1": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/sql-libsql": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/sql-mssql": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/sql-mysql2": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/sql-pg": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/sql-pglite": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/sql-sqlite-bun": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/sql-sqlite-do": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/sql-sqlite-node": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/sql-sqlite-react-native": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/sql-sqlite-wasm": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/vitest": {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
						"@effect/tsgo": {
							range: "^0.19.0",
							peer: "^0.16.2",
							strategy: "lock",
						},
						effect: {
							range: "4.0.0-beta.98",
							peer: "4.0.0-beta.98",
							strategy: "lock",
						},
					},
				},
				effect3: {
					packages: {
						"@effect/ai": {
							range: "^0.36.0",
							peer: "^0.36.0",
							strategy: "interop",
						},
						"@effect/ai-amazon-bedrock": {
							range: "^0.16.1",
							peer: "^0.16.1",
							strategy: "interop",
						},
						"@effect/ai-anthropic": {
							range: "^0.26.0",
							peer: "^0.26.0",
							strategy: "interop",
						},
						"@effect/ai-google": {
							range: "^0.15.0",
							peer: "^0.15.0",
							strategy: "interop",
						},
						"@effect/ai-openai": {
							range: "^0.40.1",
							peer: "^0.40.1",
							strategy: "interop",
						},
						"@effect/cli": {
							range: "^0.75.2",
							peer: "^0.75.2",
							strategy: "interop",
						},
						"@effect/cluster": {
							range: "^0.59.0",
							peer: "^0.59.0",
							strategy: "interop",
						},
						"@effect/experimental": {
							range: "^0.60.0",
							peer: "^0.60.0",
							strategy: "interop",
						},
						"@effect/language-service": {
							range: "^0.86.6",
							peer: "^0.86.6",
							strategy: "interop",
						},
						"@effect/opentelemetry": {
							range: "^0.63.0",
							peer: "^0.63.0",
							strategy: "interop",
						},
						"@effect/platform": {
							range: "^0.96.2",
							peer: "^0.96.0",
							strategy: "interop",
						},
						"@effect/platform-browser": {
							range: "^0.76.0",
							peer: "^0.76.0",
							strategy: "interop",
						},
						"@effect/platform-bun": {
							range: "^0.90.0",
							peer: "^0.90.0",
							strategy: "interop",
						},
						"@effect/platform-node": {
							range: "^0.107.0",
							peer: "^0.107.0",
							strategy: "interop",
						},
						"@effect/platform-node-shared": {
							range: "^0.60.0",
							peer: "^0.60.0",
							strategy: "interop",
						},
						"@effect/printer": {
							range: "^0.49.0",
							peer: "^0.49.0",
							strategy: "interop",
						},
						"@effect/printer-ansi": {
							range: "^0.49.0",
							peer: "^0.49.0",
							strategy: "interop",
						},
						"@effect/rpc": {
							range: "^0.75.1",
							peer: "^0.75.1",
							strategy: "interop",
						},
						"@effect/sql": {
							range: "^0.51.1",
							peer: "^0.51.0",
							strategy: "interop",
						},
						"@effect/sql-clickhouse": {
							range: "^0.49.0",
							peer: "^0.49.0",
							strategy: "interop",
						},
						"@effect/sql-d1": {
							range: "^0.49.0",
							peer: "^0.49.0",
							strategy: "interop",
						},
						"@effect/sql-drizzle": {
							range: "^0.50.0",
							peer: "^0.50.0",
							strategy: "interop",
						},
						"@effect/sql-kysely": {
							range: "^0.47.0",
							peer: "^0.47.0",
							strategy: "interop",
						},
						"@effect/sql-libsql": {
							range: "^0.41.0",
							peer: "^0.41.0",
							strategy: "interop",
						},
						"@effect/sql-mssql": {
							range: "^0.52.0",
							peer: "^0.52.0",
							strategy: "interop",
						},
						"@effect/sql-mysql2": {
							range: "^0.52.0",
							peer: "^0.52.0",
							strategy: "interop",
						},
						"@effect/sql-pg": {
							range: "^0.52.1",
							peer: "^0.52.1",
							strategy: "interop",
						},
						"@effect/sql-sqlite-bun": {
							range: "^0.52.0",
							peer: "^0.52.0",
							strategy: "interop",
						},
						"@effect/sql-sqlite-do": {
							range: "^0.29.0",
							peer: "^0.29.0",
							strategy: "interop",
						},
						"@effect/sql-sqlite-node": {
							range: "^0.52.0",
							peer: "^0.52.0",
							strategy: "interop",
						},
						"@effect/sql-sqlite-react-native": {
							range: "^0.54.0",
							peer: "^0.54.0",
							strategy: "interop",
						},
						"@effect/sql-sqlite-wasm": {
							range: "^0.52.0",
							peer: "^0.52.0",
							strategy: "interop",
						},
						"@effect/typeclass": {
							range: "^0.40.0",
							peer: "^0.40.0",
							strategy: "interop",
						},
						"@effect/vitest": {
							range: "^0.29.0",
							peer: "^0.29.0",
							strategy: "interop",
						},
						"@effect/workflow": {
							range: "^0.18.2",
							peer: "^0.18.2",
							strategy: "interop",
						},
						effect: {
							range: "^3.21.4",
							peer: "^3.21.0",
							strategy: "interop",
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
