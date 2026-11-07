// Ported from savvy-web/systems packages/tsdown-plugins/__test__/exe-filename.test.ts on 2026-11-06
import { assert, describe, it } from "@effect/vitest";
import { computeExeFileName } from "../../src/exe/filename.js";

describe("computeExeFileName", () => {
	it("suffixes darwin-arm64 with no extension", () => {
		assert.strictEqual(
			computeExeFileName("vitest-agent-sidecar", { platform: "darwin", arch: "arm64", nodeVersion: "25.9.0" }),
			"vitest-agent-sidecar-darwin-arm64",
		);
	});
	it("suffixes linux-x64 with no extension", () => {
		assert.strictEqual(
			computeExeFileName("vitest-agent-sidecar", { platform: "linux", arch: "x64", nodeVersion: "25.9.0" }),
			"vitest-agent-sidecar-linux-x64",
		);
	});
	it("appends .exe on win", () => {
		assert.strictEqual(
			computeExeFileName("vitest-agent-sidecar", { platform: "win", arch: "x64", nodeVersion: "25.9.0" }),
			"vitest-agent-sidecar-win-x64.exe",
		);
	});
});
