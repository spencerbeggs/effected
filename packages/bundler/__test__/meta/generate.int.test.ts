// Ported from savvy-web/systems packages/tsdown-plugins/__test__/meta/generate.int.test.ts on 2026-11-06
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { GenerateMetaOptions } from "../../src/meta/generate.js";
import { generateMeta } from "../../src/meta/generate.js";

/** generateMeta runs API Extractor over the scaffold on the host disk. */
const runGenerateMeta = (options: GenerateMetaOptions) =>
	Effect.runPromise(generateMeta(options).pipe(Effect.provide(NodeServices.layer)));

function scaffold(): { cwd: string; dtsDir: string; localPath: string } {
	const cwd = mkdtempSync(join(tmpdir(), "meta-"));
	writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "@scope/fixture", version: "1.0.0" }));
	writeFileSync(
		join(cwd, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				target: "ESNext",
				module: "ESNext",
				moduleResolution: "bundler",
				declaration: true,
				skipLibCheck: true,
				types: [],
			},
			include: [join(cwd, "**/*.d.ts")],
		}),
	);
	const dtsDir = join(cwd, "dist", "dev", "pkg");
	mkdirSync(dtsDir, { recursive: true });
	writeFileSync(join(dtsDir, "index.d.ts"), `export interface Public { y: number }\n`);
	// The built pkg dir holds the FINAL transformed manifest (here marked so the test can prove
	// generateMeta copies this one, not the untransformed cwd/package.json source).
	writeFileSync(
		join(dtsDir, "package.json"),
		JSON.stringify({ name: "@scope/fixture", version: "1.0.0", private: false }),
	);
	const localPath = join(cwd, "models");
	mkdirSync(localPath, { recursive: true });
	return { cwd, dtsDir, localPath };
}

describe("generateMeta", () => {
	it("applies manifestTransform to the bundle and localPaths package.json", async () => {
		const { cwd, dtsDir } = scaffold();
		// Extend the fixture package.json to include a dependencies field for a fuller assertion.
		writeFileSync(
			join(dtsDir, "package.json"),
			JSON.stringify({ name: "@scope/fixture", version: "0.0.0", dependencies: { "@scope/sdk": "0.0.0" } }),
		);
		const outMetaDir = join(cwd, "dist", "prod", "npm", "meta");
		await runGenerateMeta({
			cwd,
			packageName: "@scope/fixture",
			tsconfigPath: join(cwd, "tsconfig.json"),
			dtsDir,
			entries: { index: "index" },
			exportPaths: { index: "." },
			outMetaDir,
			localPaths: ["models"],
			tsdoc: { suppressWarnings: [], tagDefinitions: [] },
			manifestTransform: (p) => ({ ...p, version: "9.9.9" }),
			// Route the ae-missing-release-tag warning to a no-op so API Extractor marks it handled and
			// does not print to the console; this test asserts on the emitted manifests, not diagnostics.
			onMessage: () => {},
		});
		const bundle = JSON.parse(readFileSync(join(outMetaDir, "package.json"), "utf-8")) as { version: string };
		assert.strictEqual(bundle.version, "9.9.9");
		const copied = JSON.parse(readFileSync(join(cwd, "models", "package.json"), "utf-8")) as { version: string };
		assert.strictEqual(copied.version, "9.9.9");
	});

	it("writes the virtual-TS-env trio to outMetaDir and copies it to localPaths", async () => {
		const { cwd, dtsDir, localPath } = scaffold();
		const outMetaDir = join(cwd, "dist", "prod", "npm", "meta");
		await runGenerateMeta({
			cwd,
			packageName: "@scope/fixture",
			tsconfigPath: join(cwd, "tsconfig.json"),
			dtsDir,
			entries: { index: "index" },
			exportPaths: { index: "." },
			outMetaDir,
			localPaths: ["models"],
			tsdoc: { suppressWarnings: [], tagDefinitions: [] },
			// Route the ae-missing-release-tag warning to a no-op so API Extractor marks it handled and
			// does not print to the console; this test asserts on the emitted trio, not diagnostics.
			onMessage: () => {},
		});
		// release-asset bundle: the trio (api.json + package.json + tsconfig.json)
		assert.strictEqual(existsSync(join(outMetaDir, "fixture.api.json")), true);
		assert.strictEqual(existsSync(join(outMetaDir, "package.json")), true);
		assert.strictEqual(existsSync(join(outMetaDir, "tsconfig.json")), true);
		// tsdoc-metadata.json is a published-package artifact -> pkg dir, NOT the meta bundle
		assert.strictEqual(existsSync(join(outMetaDir, "tsdoc-metadata.json")), false);
		assert.strictEqual(existsSync(join(dtsDir, "tsdoc-metadata.json")), true);

		// The bundled package.json is the FINAL/transformed one from the pkg dir.
		const bundledManifest = JSON.parse(readFileSync(join(outMetaDir, "package.json"), "utf-8")) as {
			private?: boolean;
		};
		assert.strictEqual(bundledManifest.private, false);

		// The bundled tsconfig is the portable, compilerOptions-only derived config.
		const bundledTsconfig = JSON.parse(readFileSync(join(outMetaDir, "tsconfig.json"), "utf-8")) as {
			$schema?: string;
			compilerOptions: Record<string, unknown>;
		};
		assert.strictEqual(bundledTsconfig.$schema, "https://json.schemastore.org/tsconfig");
		assert.strictEqual(bundledTsconfig.compilerOptions.noEmit, true);
		assert.strictEqual(bundledTsconfig.compilerOptions.composite, false);
		assert.notProperty(bundledTsconfig.compilerOptions, "declaration");
		assert.notProperty(bundledTsconfig, "include");

		// localPaths copy: the trio, no tsdoc-metadata.json
		assert.strictEqual(existsSync(join(localPath, "fixture.api.json")), true);
		assert.strictEqual(existsSync(join(localPath, "package.json")), true);
		assert.strictEqual(existsSync(join(localPath, "tsconfig.json")), true);
		assert.strictEqual(existsSync(join(localPath, "tsdoc-metadata.json")), false);

		// tsdoc.json at package root (deterministic)
		assert.strictEqual(existsSync(join(cwd, "tsdoc.json")), true);
	});

	it("forwards suppressed api-extractor messages to onSuppressed", async () => {
		const { cwd, dtsDir } = scaffold();
		// A genuine forgotten export (Bar referenced by exported getBar, not itself exported), with a
		// suppression rule for it, so the message must reach onSuppressed rather than onMessage.
		writeFileSync(
			join(dtsDir, "index.d.ts"),
			`interface Bar { bar: number }\n/** @public */\ndeclare function getBar(): Bar;\nexport { getBar };\n`,
		);
		const outMetaDir = join(cwd, "dist", "prod", "npm", "meta");
		const suppressed: string[] = [];
		await runGenerateMeta({
			cwd,
			packageName: "@scope/fixture",
			tsconfigPath: join(cwd, "tsconfig.json"),
			dtsDir,
			entries: { index: "index" },
			exportPaths: { index: "." },
			outMetaDir,
			localPaths: [],
			tsdoc: { suppressWarnings: [{ messageId: "ae-forgotten-export" }], tagDefinitions: [] },
			onSuppressed: (e) => suppressed.push(e.code ?? ""),
			// Route the remaining (unsuppressed) ae-missing-release-tag on the forgotten `Bar` to a no-op so
			// API Extractor marks it handled and does not print it to the console; this test only asserts on
			// onSuppressed, not diagnostic text.
			onMessage: () => {},
		});
		assert.include(suppressed, "ae-forgotten-export");
	});
});
