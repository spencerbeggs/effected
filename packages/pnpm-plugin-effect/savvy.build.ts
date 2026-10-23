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
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/ai-openai": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/ai-openai-compat": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/ai-openrouter": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/atom-react": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/atom-solid": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/atom-vue": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/openapi-generator": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/opentelemetry": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/platform-browser": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/platform-bun": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/platform-node": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/platform-node-shared": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/sql-clickhouse": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/sql-d1": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/sql-libsql": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/sql-mssql": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/sql-mysql2": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/sql-pg": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/sql-pglite": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/sql-sqlite-bun": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/sql-sqlite-do": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/sql-sqlite-node": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/sql-sqlite-react-native": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/sql-sqlite-wasm": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/vitest": {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
						},
						"@effect/tsgo": {
							range: "^0.56.0",
							peer: "^0.56.0",
							strategy: "lock-minor",
						},
						effect: {
							range: "^4.0.6",
							peer: "^4.0.0",
							strategy: "lock-minor",
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
							range: "^0.25.1",
							peer: "^0.25.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/cli": {
							range: "^0.21.0",
							peer: "^0.21.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/commands": {
							range: "^0.15.1",
							peer: "^0.15.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/config-file": {
							range: "^0.19.0",
							peer: "^0.19.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/crypto": {
							range: "^0.1.1",
							peer: "^0.1.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/engine": {
							range: "^0.8.0",
							peer: "^0.8.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/env": {
							range: "^0.5.0",
							peer: "^0.5.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/git": {
							range: "^0.25.0",
							peer: "^0.25.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/github": {
							range: "^0.23.1",
							peer: "^0.23.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/github-actions": {
							range: "^0.26.0",
							peer: "^0.26.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/github-commands": {
							range: "^0.6.1",
							peer: "^0.6.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/github-references": {
							range: "^0.11.0",
							peer: "^0.11.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/glob": {
							range: "^0.14.0",
							peer: "^0.14.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/jsonc": {
							range: "^0.20.0",
							peer: "^0.20.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/images": {
							range: "^0.6.0",
							peer: "^0.6.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/jwt": {
							range: "^0.6.0",
							peer: "^0.6.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/jsonl": {
							range: "^0.15.1",
							peer: "^0.15.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/lockfiles": {
							range: "^0.19.2",
							peer: "^0.19.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/lsp": {
							range: "^0.5.0",
							peer: "^0.5.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/markdown": {
							range: "^0.21.0",
							peer: "^0.21.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/mcp": {
							range: "^0.9.0",
							peer: "^0.9.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/memfs": {
							range: "^0.18.0",
							peer: "^0.18.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/npm": {
							range: "^0.26.0",
							peer: "^0.26.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/oidc": {
							range: "^0.1.2",
							peer: "^0.1.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/package-json": {
							range: "^0.25.0",
							peer: "^0.25.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/runtimes": {
							range: "^0.15.0",
							peer: "^0.15.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/sbom": {
							range: "^0.15.1",
							peer: "^0.15.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/schema-org": {
							range: "^0.11.0",
							peer: "^0.11.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/schemastore": {
							range: "^0.26.0",
							peer: "^0.26.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/schemastore-cli": {
							range: "^0.26.0",
							peer: "^0.26.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/semver": {
							range: "^0.16.0",
							peer: "^0.16.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/spdx": {
							range: "^0.16.0",
							peer: "^0.16.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/store": {
							range: "^0.17.1",
							peer: "^0.17.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/templates": {
							range: "^0.14.1",
							peer: "^0.14.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/toml": {
							range: "^0.16.0",
							peer: "^0.16.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/tsconfig-json": {
							range: "^0.17.1",
							peer: "^0.17.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/walker": {
							range: "^0.19.0",
							peer: "^0.19.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/webhooks": {
							range: "^0.1.1",
							peer: "^0.1.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/workspaces": {
							range: "^0.37.0",
							peer: "^0.37.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/xdg": {
							range: "^0.14.0",
							peer: "^0.14.0",
							strategy: "lock-minor",
							source: "workspace",
						},
						"@effected/yaml": {
							range: "^0.24.0",
							peer: "^0.24.0",
							strategy: "lock-minor",
							source: "workspace",
						},
					},
				},
			},
			local: {
				minimumReleaseAgeExclude: {
					value: ["@savvy-web/pnpm-plugin-silk"],
					strategy: "union",
				},
			},
			minimumReleaseAgeExclude: ["effect", "@effect/*", "@effect/tsgo-*"],
			// Every member of the effect catalog is pinned to its exact catalog version across the
			// whole consumer graph, scoped to the 4.x line: `"<name>@^4.0.0": "<version>"` for
			// effect and each satellite, derived from the catalog literal above so the pins move
			// with it. A catalog range alone cannot promise that: a caret admits a satellite the
			// core has not published yet (Effect-TS/effect#8994 shipped every 4.0.3 satellite a
			// day before core, and the pairing dies at import), and a catalog never reaches a
			// dependency's own dependencies (@effected/store and @effected/schemastore-cli depend
			// on satellites directly). The line scope leaves a tool still built on a release
			// candidate alone: 4.0.0-rc.118 sits outside ^4.0.0. @effect/tsgo versions on its
			// own 0.x line and gets its own line-scoped pin, so one tsgo serves the graph too.
			overridesFromCatalogs: { catalog: "effect" },
			// Tools still built on an Effect release candidate depend on that candidate's
			// @effect/platform-node, which takes @effect/platform-node-shared with a caret.
			// A fresh resolve pairs it with the newest shared package, built against a
			// different effect than the tool runs: rc.118's shared imported
			// effect/process/ChildProcess that rc.117 does not ship, and the tool crashed
			// at startup. Each entry is scoped to its own parent, so it never touches a
			// 4.x install. Remove an entry once no tool consumers run is built on it.
			overrides: {
				"@effect/platform-node@4.0.0-rc.118>@effect/platform-node-shared": "4.0.0-rc.118",
				"@effect/platform-node@4.0.0-rc.117>@effect/platform-node-shared": "4.0.0-rc.117",
			},
		}),
	],
	bundleNodeModules: true,
	looseFiles: {
		"pnpmfile.mjs": "./src/pnpmfile.ts",
	},
});
