import { PnpmConfigPlugin } from "rolldown-pnpm-config";

// The annotation names the return type, which inference would have to reach through rolldown, not a dependency here.
const plugin: ReturnType<typeof PnpmConfigPlugin> = PnpmConfigPlugin({
	name: "@effected/pnpm-plugin-effected",
	peerDependencyRules: {
		// tsdown peers `typescript: ^5.0.0 || ^6.0.0 || ^7.0.0`, which no 7.1 prerelease satisfies,
		// while the `effected:build` catalog holds TypeScript at 7.1.0-beta. The value is the one
		// @savvy-web/pnpm-plugin-silk declares for the same key, so a consumer running both
		// plugins merges two equal rules rather than two divergent ones.
		allowedVersions: {
			"tsdown>typescript": "^5.5.0 || ^6.0.0 || ^7.0.0 || ^7.1.0-beta",
		},
		allowedVersionsFromCatalogs: {
			catalog: "effected", // which catalog supplies the satellites
			peer: "effect", // the peer each rule targets
			prefix: null,
		},
	},
	catalogs: {
		/**
		 * The runtime catalog: the Effect family (`effect`, `@effect/*`) followed by the kit's own
		 * version surface, consumed across the ecosystem as `catalog:effected` and
		 * `catalog:effected:peers`. Only the Effect family is pinned graph-wide: the
		 * `overridesFromCatalogs` `include` below selects it by pattern, so a kit package added
		 * here gains no override.
		 *
		 * `@effected/pnpm-plugin-effected` is deliberately ABSENT and must stay absent. It is
		 * the package this catalog ships inside: catalogue it, and every catalog rewrite
		 * bumps the plugin, which invalidates the catalog, which writes another changeset —
		 * an infinite release loop. The omission is the termination condition, not an
		 * oversight.
		 */
		effected: {
			packages: {
				"@effect/ai-anthropic": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/ai-openai": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/ai-openai-compat": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/ai-openrouter": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/atom-react": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/atom-solid": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/atom-vue": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/openapi-generator": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/opentelemetry": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/platform-browser": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/platform-bun": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/platform-node": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/platform-node-shared": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/sql-clickhouse": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/sql-d1": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/sql-libsql": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/sql-mssql": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/sql-mysql2": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/sql-pg": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/sql-pglite": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/sql-sqlite-bun": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/sql-sqlite-do": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/sql-sqlite-node": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/sql-sqlite-react-native": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/sql-sqlite-wasm": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/vitest": {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effect/tsgo": {
					range: "^0.67.5",
					peer: "^0.67.0",
					strategy: "lock-minor",
				},
				effect: {
					range: "~4.1.2",
					peer: "~4.1.0",
					strategy: "lock-minor",
				},
				"@effected/app": {
					range: "^0.31.2",
					peer: "^0.31.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/manifest": {
					range: "^0.1.0",
					peer: "^0.1.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/bundler": {
					range: "^0.2.0",
					peer: "^0.2.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/changesets": {
					range: "^0.2.0",
					peer: "^0.2.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/markdown-lint": {
					range: "^0.1.1",
					peer: "^0.1.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/s3": {
					range: "^0.1.1",
					peer: "^0.1.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/shell": {
					range: "^0.1.1",
					peer: "^0.1.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/cli": {
					range: "^0.29.0",
					peer: "^0.29.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/cli-kit": {
					range: "^0.27.1",
					peer: "^0.27.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/commands": {
					range: "^0.20.0",
					peer: "^0.20.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/config-file": {
					range: "^0.26.0",
					peer: "^0.26.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/crypto": {
					range: "^0.6.0",
					peer: "^0.6.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/kit": {
					range: "^0.13.0",
					peer: "^0.13.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/files": {
					range: "^0.2.0",
					peer: "^0.2.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/engine": {
					range: "^0.15.0",
					peer: "^0.15.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/env": {
					range: "^0.11.0",
					peer: "^0.11.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/git": {
					range: "^0.30.0",
					peer: "^0.30.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/github": {
					range: "^0.30.0",
					peer: "^0.30.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/github-actions": {
					range: "^0.32.2",
					peer: "^0.32.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/github-commands": {
					range: "^0.9.0",
					peer: "^0.9.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/github-references": {
					range: "^0.14.0",
					peer: "^0.14.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/glob": {
					range: "^0.20.0",
					peer: "^0.20.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/jsonc": {
					range: "^0.24.0",
					peer: "^0.24.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/images": {
					range: "^0.9.0",
					peer: "^0.9.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/jwt": {
					range: "^0.9.1",
					peer: "^0.9.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/jsonl": {
					range: "^0.18.0",
					peer: "^0.18.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/lockfiles": {
					range: "^0.23.1",
					peer: "^0.23.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/lsp": {
					range: "^0.8.0",
					peer: "^0.8.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/markdown": {
					range: "^0.28.0",
					peer: "^0.28.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/mcp": {
					range: "^0.16.0",
					peer: "^0.16.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/mcp-kit": {
					range: "^0.14.0",
					peer: "^0.14.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/memfs": {
					range: "^0.24.0",
					peer: "^0.24.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/npm": {
					range: "^0.32.0",
					peer: "^0.32.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/oidc": {
					range: "^0.4.0",
					peer: "^0.4.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/package-json": {
					range: "^0.31.1",
					peer: "^0.31.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/plugin": {
					range: "^0.4.0",
					peer: "^0.4.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/runtimes": {
					range: "^0.18.2",
					peer: "^0.18.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/sbom": {
					range: "^0.20.2",
					peer: "^0.20.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/schema-org": {
					range: "^0.14.0",
					peer: "^0.14.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/schemastore": {
					range: "^0.31.0",
					peer: "^0.31.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/semver": {
					range: "^0.22.0",
					peer: "^0.22.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/source": {
					range: "^0.4.0",
					peer: "^0.4.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/spdx": {
					range: "^0.19.0",
					peer: "^0.19.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/store": {
					range: "^0.24.0",
					peer: "^0.24.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/templates": {
					range: "^0.19.0",
					peer: "^0.19.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/toml": {
					range: "^0.19.1",
					peer: "^0.19.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/tsconfig-json": {
					range: "^0.20.2",
					peer: "^0.20.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/walker": {
					range: "^0.26.0",
					peer: "^0.26.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/webhooks": {
					range: "^0.5.0",
					peer: "^0.5.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/workspaces": {
					range: "^0.44.1",
					peer: "^0.44.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/xdg": {
					range: "^0.19.2",
					peer: "^0.19.0",
					strategy: "lock-minor",
					source: "workspace",
				},
				"@effected/yaml": {
					range: "^0.29.0",
					peer: "^0.29.0",
					strategy: "lock-minor",
					source: "workspace",
				},
			},
		},
		/**
		 * The kit's build chain: what `effected package build` runs (tsdown, rolldown, the
		 * declaration pass, API Extractor and TSDoc) and the toolchain a package builds and
		 * typechecks against (TypeScript, Node and React types, tsx, React). Consumed as
		 * `catalog:effected:build`, so a repository that builds with the kit takes its chain
		 * from the kit that wrote the bundler rather than from a separate catalog plugin.
		 *
		 * The catalog sync never touches it: the sync passes `--catalog effected`, so these
		 * entries move only through the user-run `pnpm:up`. No override is derived from it;
		 * a build-chain pin is a catalog range, not a graph-wide one.
		 */
		"effected:build": {
			packages: {
				"@microsoft/api-extractor": {
					range: "^7.60.1",
					peer: "^7.60.1",
					strategy: "lock",
				},
				"@microsoft/api-extractor-model": {
					range: "^7.33.16",
					peer: "^7.33.16",
					strategy: "lock",
				},
				// 0.17.0 dropped the line break before an inline node (microsoft/tsdoc#493); 0.17.1
				// carries the fix, so the floor stays at 0.17.1 even though api-extractor accepts ~0.17.0.
				"@microsoft/tsdoc": {
					range: "~0.17.1",
					peer: "~0.17.1",
					strategy: "lock",
				},
				"@microsoft/tsdoc-config": {
					range: "~0.18.3",
					peer: "~0.18.3",
					strategy: "lock",
				},
				"@rsbuild/core": {
					range: "^2.3.1",
					peer: "^2.3.0",
					strategy: "lock-minor",
				},
				"@tsdown/exe": {
					range: "^0.23.7",
					peer: "^0.23.0",
					strategy: "lock-minor",
				},
				"@types/node": {
					range: "^26.6.6",
					peer: "^26.6.0",
					strategy: "lock-minor",
				},
				"@types/react": {
					range: "^19.3.0",
					peer: "^19.3.0",
					strategy: "lock-minor",
				},
				"@types/react-dom": {
					range: "^19.3.0",
					peer: "^19.3.0",
					strategy: "lock-minor",
				},
				react: {
					range: "^19.3.1",
					peer: "^19.3.0",
					strategy: "lock-minor",
				},
				"react-dom": {
					range: "^19.3.1",
					peer: "^19.3.0",
					strategy: "lock-minor",
				},
				rolldown: {
					range: "^1.3.1",
					peer: "^1.3.0",
					strategy: "lock-minor",
				},
				// The declaration pass tsdown runs. tsdown asks for ^0.30.0 itself; the entry is here so a
				// consumer sees the version the bundler's declarations are built with, and so no override
				// is needed to hold it there.
				"rolldown-plugin-dts": {
					range: "^0.30.0",
					peer: "^0.30.0",
					strategy: "lock-minor",
				},
				tsdown: {
					range: "^0.23.7",
					peer: "^0.23.0",
					strategy: "lock-minor",
				},
				tsx: {
					range: "^4.23.15",
					peer: "^4.23.15",
					strategy: "lock",
				},
				typescript: {
					range: "7.1.0-beta",
					peer: "7.1.0-beta",
					strategy: "lock",
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
	// The carrier is a consumer's root devDependency; hoisting it publicly puts it, and so its
	// `effected` and `effected-mcp` bins, at the workspace root for every package to reach.
	//
	// The toolchain the effected:build catalog carries is hoisted to the consumer's root, as silk
	// hoists it, so a repository that drops silk keeps `tsc`, `tsx` and the `@types` packages
	// reachable from every workspace package, including one that declares none of them itself.
	// The kit's own build does not need the hoist (the bundler resolves typescript from its peer
	// link); the owner ruled the consumer-side reach worth carrying here.
	publicHoistPattern: ["@effected/plugin", "typescript", "@types/node", "@types/react", "@types/react-dom", "tsx"],
	// The kit's own releases and the build chain's lockstep satellites install the day they ship.
	// The quarantine itself (`minimumReleaseAge`) is repository policy, and stays with silk.
	// - `@effected/*`: a kit release; its changesets and the catalog sync assume it installs at once.
	// - `@rolldown/*`: rolldown's platform bindings, published with rolldown and pinned exactly by it.
	// - `@oxc-project/*`: `@oxc-project/types`, which rolldown pins exactly and which ships with it.
	// - `@typescript/*`: TypeScript 7's native platform packages, published with `typescript`.
	// - every package the effected:build catalog names (tsdown, rolldown, rolldown-plugin-dts,
	//   `@tsdown/*`, `@rsbuild/*`, typescript, tsx, `@types/node`, React and its types): the
	//   catalog pins them and moves them only through a deliberate `pnpm:up`, and a quarantine on
	//   that move only blocks the upgrade it was chosen for (rolldown 1.3.1 was held exactly so).
	// Lists union across plugins, so an entry silk also declares collapses to one.
	minimumReleaseAgeExclude: [
		"effect",
		"@effect/*",
		"@effect/tsgo-*",
		"@effected/*",
		"@oxc-project/*",
		"@rolldown/*",
		"@rsbuild/*",
		"@tsdown/*",
		"@types/node",
		"@types/react",
		"@types/react-dom",
		"@typescript/*",
		"react",
		"react-dom",
		"rolldown",
		"rolldown-plugin-dts",
		"tsdown",
		"tsx",
		"typescript",
	],
	// tsx depends on esbuild, whose postinstall (`node install.js`) checks its platform binary.
	// Under `strictDepBuilds` an unlisted build script fails the install, so the chain's one
	// build script is allowed here. It is the only install script in the effected:build closure.
	// The value is silk's for the same key, so the two plugins never disagree on it.
	allowBuilds: { esbuild: true },
	// Every Effect-family member of the catalog is pinned to its exact catalog version across the
	// whole consumer graph, scoped to the 4.x line: `"<name>@^4.0.0": "<version>"` for
	// effect and each satellite, derived from the catalog literal above so the pins move
	// with it. A catalog range alone cannot promise that: a caret admits a satellite the
	// core has not published yet (Effect-TS/effect#8994 shipped every 4.0.3 satellite a
	// day before core, and the pairing dies at import), and a catalog never reaches a
	// dependency's own dependencies (@effected/store depends on satellites
	// directly). The line scope leaves a tool still built on a release
	// candidate alone: 4.0.0-rc.118 sits outside ^4.0.0. @effect/tsgo versions on its
	// own 0.x line and gets its own line-scoped pin, so one tsgo serves the graph too.
	// The `include` patterns select the family; the kit's `@effected/*` entries match neither
	// (`*` does not cross the scope `/`), so they are never pinned.
	overridesFromCatalogs: { catalog: "effected", include: ["effect", "@effect/*"] },
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
});

export default plugin;
