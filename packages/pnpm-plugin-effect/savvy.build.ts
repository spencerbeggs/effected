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
						effect: {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/ai-anthropic": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/ai-openai": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/ai-openai-compat": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/ai-openrouter": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/atom-react": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/atom-solid": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/atom-vue": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/openapi-generator": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/opentelemetry": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/platform-browser": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/platform-bun": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/platform-node": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/platform-node-shared": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/sql-clickhouse": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/sql-d1": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/sql-libsql": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/sql-mssql": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/sql-mysql2": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/sql-pg": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/sql-pglite": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/sql-sqlite-bun": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/sql-sqlite-do": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/sql-sqlite-node": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/sql-sqlite-react-native": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/sql-sqlite-wasm": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/vitest": {
							range: "^4.0.0-beta.94",
							peer: "^4.0.0-beta.94",
							strategy: "interop",
						},
						"@effect/tsgo": {
							range: "^0.18.1",
							peer: "^0.16.2",
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
