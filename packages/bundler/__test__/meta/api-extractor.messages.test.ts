// Ported from savvy-web/systems packages/tsdown-plugins/__test__/meta/api-extractor.messages.test.ts on 2026-11-06

import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { ExtractorLogLevel } from "@microsoft/api-extractor";
import { isForeignInputFileMessage, mapExtractorMessage, ownSourceInputFiles } from "../../src/meta/api-extractor.js";

describe("mapExtractorMessage", () => {
	it("maps a warning message and preserves the source location", () => {
		const entry = mapExtractorMessage({
			logLevel: ExtractorLogLevel.Warning,
			messageId: "ae-forgotten-export",
			text: "ae-forgotten-export",
			sourceFilePath: "src/index.ts",
			sourceFileLine: 12,
			sourceFileColumn: 3,
		} as never);
		assert.deepStrictEqual(entry, {
			source: "api-extractor",
			level: "warn",
			code: "ae-forgotten-export",
			text: "ae-forgotten-export",
			file: "src/index.ts",
			line: 12,
			column: 3,
		});
	});

	it("preserves location for release-tag and unresolved-link codes alike", () => {
		for (const messageId of ["ae-missing-release-tag", "ae-incompatible-release-tags", "ae-unresolved-link"]) {
			const entry = mapExtractorMessage({
				logLevel: ExtractorLogLevel.Warning,
				messageId,
				text: `${messageId}: "SomeSymbol" ...`,
				sourceFilePath: "src/Real.ts",
				sourceFileLine: 11,
				sourceFileColumn: 46,
			} as never);
			assert.strictEqual(entry?.file, "src/Real.ts");
			assert.strictEqual(entry?.line, 11);
			assert.strictEqual(entry?.column, 46);
		}
	});

	it("omits location fields that are undefined", () => {
		const entry = mapExtractorMessage({ logLevel: ExtractorLogLevel.Error, text: "boom" } as never);
		assert.strictEqual(entry?.level, "error");
		assert.isUndefined(entry?.file);
	});

	it("returns undefined for info/none messages", () => {
		assert.isUndefined(mapExtractorMessage({ logLevel: ExtractorLogLevel.Info, text: "fyi" } as never));
	});
});

describe("isForeignInputFileMessage", () => {
	const wrongInput = (sourceFilePath: string | undefined) =>
		({ messageId: "ae-wrong-input-file-type", ...(sourceFilePath !== undefined ? { sourceFilePath } : {}) }) as never;
	const layout = () => {
		const root = mkdtempSync(join(tmpdir(), "foreign-input-"));
		for (const dir of ["packages/env/src", "packages/env-foo/src", "packages/env/node_modules"]) {
			mkdirSync(join(root, dir), { recursive: true });
		}
		return { root, env: join(root, "packages", "env") };
	};

	it("is true of a sibling's source", () => {
		const { root, env } = layout();
		assert.isTrue(isForeignInputFileMessage(wrongInput(join(root, "packages/kit/src/a.ts")), env));
	});

	it("stays false for the package's own source, whether absolute or relative", () => {
		const { env } = layout();
		assert.isFalse(isForeignInputFileMessage(wrongInput(join(env, "src/a.ts")), env));
		assert.isFalse(isForeignInputFileMessage(wrongInput("src/a.ts"), env));
	});

	it("does not read a directory whose name extends the package's as the package", () => {
		const { root, env } = layout();
		assert.isTrue(isForeignInputFileMessage(wrongInput(join(root, "packages/env-foo/src/a.ts")), env));
	});

	it("is not fooled by a file whose name starts with two dots", () => {
		const { env } = layout();
		assert.isFalse(isForeignInputFileMessage(wrongInput(join(env, "..a.ts")), env));
	});

	it("compares realpaths on both sides", () => {
		const { root, env } = layout();
		const linkedCwd = join(root, "linked-env");
		symlinkSync(env, linkedCwd);
		// The package reached through a link is still the package.
		assert.isFalse(isForeignInputFileMessage(wrongInput(join(env, "src")), linkedCwd));
		// A link inside the package landing on a sibling is a sibling.
		const sibling = join(root, "packages", "env-foo");
		symlinkSync(sibling, join(env, "node_modules", "env-foo"));
		assert.isTrue(isForeignInputFileMessage(wrongInput(join(env, "node_modules/env-foo/src")), env));
	});

	it("is true of a real directory under the package's node_modules, as the program scan judges it", () => {
		const { env } = layout();
		mkdirSync(join(env, "node_modules", "dep"), { recursive: true });
		const file = join(env, "node_modules", "dep", "x.ts");
		writeFileSync(file, "");
		assert.isTrue(isForeignInputFileMessage(wrongInput(file), env));
		assert.deepStrictEqual(ownSourceInputFiles({ getSourceFiles: () => [{ fileName: file }] }, env), []);
	});

	it("is false of any other message, and of one naming no file", () => {
		const { root, env } = layout();
		assert.isFalse(
			isForeignInputFileMessage({ messageId: "ae-forgotten-export", sourceFilePath: join(root, "x.ts") } as never, env),
		);
		assert.isFalse(isForeignInputFileMessage(wrongInput(undefined), env));
	});
});

describe("ownSourceInputFiles", () => {
	it("keeps own non-declaration sources in the program's path form, and drops every other file", () => {
		const root = mkdtempSync(join(tmpdir(), "own-input-"));
		const env = join(root, "env");
		for (const dir of ["env/src", "sibling/src", "env/node_modules/dep"])
			mkdirSync(join(root, dir), { recursive: true });
		const linkedCwd = join(root, "linked-env");
		symlinkSync(env, linkedCwd);
		const files = [
			join(linkedCwd, "src", "a.ts"),
			join(linkedCwd, "src", "b.mts"),
			join(linkedCwd, "src", "a.d.ts"),
			join(linkedCwd, "src", "c.js"),
			join(root, "sibling", "src", "s.ts"),
			join(linkedCwd, "node_modules", "dep", "x.ts"),
		];
		for (const file of files) writeFileSync(file, "");
		const program = { getSourceFiles: () => files.map((fileName) => ({ fileName })) };
		// Reported as the program names them, through the link, not as their realpaths.
		assert.deepStrictEqual(ownSourceInputFiles(program, linkedCwd), [files[0], files[1]]);
	});
});
