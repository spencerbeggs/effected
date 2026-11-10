/**
 * Byte parity with the previous bundler: `Bundler.build` over `packages/jsonc`'s source must emit what
 * `@savvy-web/bundler` 2.7.4 emitted, normalizing nothing. See `__test__/fixtures/parity/README.md`.
 *
 * Run it with `EFFECTED_PARITY=1 pnpm exec vitest run --project @effected/bundler --coverage.enabled=false parity`. It is
 * opt-in because the expected bytes follow jsonc's source, the `effect` it builds on and every pending changeset, so
 * in the default suite an unrelated edit would turn it red.
 *
 * The expected text is compared untouched: no difference is intended today. A later one goes here as an explicit
 * `replace` on the expected text, with a comment naming the decision. The previous build's `meta.localPaths` copy
 * into the website is not among these files, so dropping it changes none of them, and `issues.json`, the one file with
 * a timestamp, is not compared.
 *
 * It builds a copy under this package's own `dist`, so jsonc's real `dist` stays the previous bundler's, and the copy
 * sits inside the workspace that answers its `catalog:` and `workspace:` specifiers.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { assert, describe, it } from "@effect/vitest";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import { Effect, Layer } from "effect";
import { Bundler } from "../../src/Bundler.js";
import { EffectedConfigFile } from "../../src/config/EffectedConfigFile.js";

const PACKAGE = resolve(import.meta.dirname, "../..");
const JSONC = resolve(PACKAGE, "../jsonc");
const EXPECTED = resolve(import.meta.dirname, "../fixtures/parity");

/** Emitted path under `dist/prod`, and where its expected bytes live. */
const FILES: ReadonlyArray<readonly [emitted: string, expected: string]> = [
	["npm/pkg/package.json", "pkg/package.json"],
	["npm/pkg/index.js", "pkg/index.js"],
	["npm/pkg/index.d.ts", "pkg/index.d.ts"],
	["targets.json", "targets.json"],
	["npm/meta/jsonc.api.json", "meta/jsonc.api.json"],
	["npm/meta/package.json", "meta/package.json"],
	["npm/meta/tsconfig.json", "meta/tsconfig.json"],
	// The previous bundler named the sidecar tsdoctor.json; its bytes are the expected content of bundle.json.
	["npm/meta/bundle.json", "meta/tsdoctor.json"],
];

const platform = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const discovery = WorkspaceDiscovery.layer().pipe(
	Layer.provideMerge(WorkspaceRoot.layer),
	Layer.provideMerge(platform),
);

describe.skipIf(process.env.EFFECTED_PARITY !== "1")("parity with the previous bundler", () => {
	it.effect(
		"emits @effected/jsonc byte for byte",
		() =>
			Effect.acquireUseRelease(
				Effect.sync(() => {
					mkdirSync(join(PACKAGE, "dist"), { recursive: true });
					const scratch = mkdtempSync(join(PACKAGE, "dist", "parity-"));
					const cwd = join(scratch, "jsonc");
					cpSync(JSONC, cwd, {
						recursive: true,
						filter: (source) => !["dist", "node_modules", ".turbo"].includes(source.slice(JSONC.length + 1)),
					});
					symlinkSync(join(JSONC, "node_modules"), join(cwd, "node_modules"));
					return { scratch, cwd };
				}),
				({ cwd }) =>
					Effect.gen(function* () {
						const { config } = yield* EffectedConfigFile.load({ cwd });
						const result = yield* Bundler.build({
							cwd,
							config: config.package.build,
							bundle: config.package.bundle,
							noExe: true,
							verbose: false,
							plugins: [],
							ci: false,
						});
						const issues = JSON.parse(readFileSync(result.issuesPath, "utf-8")) as {
							buildOk: boolean;
							errors: unknown[];
						};
						assert.strictEqual(issues.buildOk, true);
						assert.deepStrictEqual(issues.errors, []);
						for (const [emitted, expected] of FILES) {
							const path = join(cwd, "dist", "prod", emitted);
							assert.isTrue(existsSync(path), emitted);
							assert.strictEqual(
								readFileSync(path, "utf-8"),
								readFileSync(join(EXPECTED, expected), "utf-8"),
								`${emitted} differs from the previous bundler's`,
							);
						}
					}).pipe(Effect.provide(discovery)),
				({ scratch }) => Effect.sync(() => rmSync(scratch, { recursive: true, force: true })),
			),
		180_000,
	);
});
