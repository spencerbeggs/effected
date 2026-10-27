import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import { Result } from "effect";
import { ChildProcess } from "effect/process";
import { nodePrebuiltHost } from "../src/node-sync.js";
import type { PrebuiltBinarySpec, PrebuiltHost, PrebuiltTarget } from "../src/PrebuiltBinary.js";
import { PrebuiltBinary, PrebuiltBinaryError } from "../src/PrebuiltBinary.js";

const SPEC: PrebuiltBinarySpec = {
	packages: {
		"darwin-arm64": "@acme/cli-darwin-arm64",
		"linux-x64": "@acme/cli-linux-x64",
		"linux-x64-musl": "@acme/cli-linux-x64-musl",
		"win32-x64": "@acme/cli-win32-x64",
	},
	binary: (target) => (target.platform === "win32" ? "bin/acme.exe" : "bin/acme"),
};

/** A host whose resolver answers from a fixed table and throws `code` otherwise; records every specifier. */
const fakeHost = (
	target: PrebuiltTarget,
	installed: Readonly<Record<string, string>>,
	code = "MODULE_NOT_FOUND",
): PrebuiltHost & { readonly seen: Array<string> } => {
	const seen: Array<string> = [];
	return {
		target,
		seen,
		resolve: (specifier) => {
			seen.push(specifier);
			const hit = installed[specifier];
			if (hit !== undefined) return hit;
			throw Object.assign(new Error(`Cannot find ${specifier}`), { code });
		},
	};
};

const failure = (result: Result.Result<unknown, PrebuiltBinaryError>): PrebuiltBinaryError => {
	assert.isTrue(Result.isFailure(result));
	return Result.isFailure(result) ? result.failure : (undefined as never);
};

describe("PrebuiltBinary.candidates", () => {
	it("is the libc-specific key first when the libc is known, the generic key otherwise", () => {
		assert.deepStrictEqual(PrebuiltBinary.candidates({ platform: "linux", arch: "x64", libc: "musl" }), [
			"linux-x64-musl",
			"linux-x64",
		]);
		assert.deepStrictEqual(PrebuiltBinary.candidates({ platform: "darwin", arch: "arm64" }), ["darwin-arm64"]);
	});
});

describe("PrebuiltBinary.resolveSync", () => {
	it("resolves the matching package's binary subpath", () => {
		const host = fakeHost({ platform: "darwin", arch: "arm64" }, { "@acme/cli-darwin-arm64/bin/acme": "/nm/acme" });
		const result = PrebuiltBinary.resolveSync(SPEC, host);
		assert.isTrue(Result.isSuccess(result));
		if (Result.isSuccess(result)) {
			assert.strictEqual(result.success.path, "/nm/acme");
			assert.strictEqual(result.success.packageName, "@acme/cli-darwin-arm64");
			assert.strictEqual(result.success.key, "darwin-arm64");
			const command = result.success.command("--version");
			assert.isTrue(ChildProcess.isStandardCommand(command));
			if (ChildProcess.isStandardCommand(command)) {
				assert.deepStrictEqual([command.command, ...command.args], ["/nm/acme", "--version"]);
			}
		}
	});

	it("applies a per-target binary name", () => {
		const host = fakeHost({ platform: "win32", arch: "x64" }, { "@acme/cli-win32-x64/bin/acme.exe": "C:\\acme.exe" });
		assert.isTrue(Result.isSuccess(PrebuiltBinary.resolveSync(SPEC, host)));
		assert.deepStrictEqual(host.seen, ["@acme/cli-win32-x64/bin/acme.exe"]);
	});

	it("resolves the package's own export when no binary subpath is given", () => {
		const host = fakeHost({ platform: "linux", arch: "x64" }, { "@acme/cli-linux-x64": "/nm/sea" });
		const result = PrebuiltBinary.resolveSync({ packages: SPEC.packages }, host);
		assert.isTrue(Result.isSuccess(result));
		assert.deepStrictEqual(host.seen, ["@acme/cli-linux-x64"]);
	});

	it("prefers the libc-specific package, and falls back to the generic one when it is not installed", () => {
		const musl = fakeHost(
			{ platform: "linux", arch: "x64", libc: "musl" },
			{ "@acme/cli-linux-x64-musl/bin/acme": "/nm/musl", "@acme/cli-linux-x64/bin/acme": "/nm/glibc" },
		);
		const result = PrebuiltBinary.resolveSync(SPEC, musl);
		assert.isTrue(Result.isSuccess(result) && result.success.key === "linux-x64-musl");

		const muslMissing = fakeHost(
			{ platform: "linux", arch: "x64", libc: "musl" },
			{ "@acme/cli-linux-x64/bin/acme": "/nm/glibc" },
		);
		const fallback = PrebuiltBinary.resolveSync(SPEC, muslMissing);
		assert.isTrue(Result.isSuccess(fallback));
		if (Result.isSuccess(fallback)) {
			assert.strictEqual(fallback.success.key, "linux-x64");
			assert.strictEqual(fallback.success.path, "/nm/glibc");
		}
		assert.deepStrictEqual(muslMissing.seen.slice(0, 1), ["@acme/cli-linux-x64-musl/bin/acme"]);
	});

	it("fails only when no declared candidate resolves, naming the most specific absent package", () => {
		const none = fakeHost({ platform: "linux", arch: "x64", libc: "musl" }, {});
		const error = failure(PrebuiltBinary.resolveSync(SPEC, none));
		assert.strictEqual(error.reason, "notInstalled");
		assert.strictEqual(error.packageName, "@acme/cli-linux-x64-musl");
		assert.deepStrictEqual(error.candidates, ["linux-x64-musl", "linux-x64"]);
	});

	it("an installed package without the binary file is binaryMissing, not notInstalled", () => {
		const host = fakeHost(
			{ platform: "darwin", arch: "arm64" },
			{ "@acme/cli-darwin-arm64/package.json": "/nm/pkg.json" },
		);
		const error = failure(PrebuiltBinary.resolveSync(SPEC, host));
		assert.strictEqual(error.reason, "binaryMissing");
		assert.include(error.message, "contains no binary");
		assert.notInclude(error.message, "reinstall");
		// An exports map that hides package.json still proves the package is there.
		const exportsOnly = fakeHost({ platform: "darwin", arch: "arm64" }, {});
		const hidden: PrebuiltHost = {
			target: exportsOnly.target,
			resolve: (specifier) => {
				if (specifier.endsWith("/package.json")) {
					throw Object.assign(new Error("not exported"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
				}
				return exportsOnly.resolve(specifier);
			},
		};
		assert.strictEqual(failure(PrebuiltBinary.resolveSync(SPEC, hidden)).reason, "binaryMissing");
	});

	it("a package whose own export is the binary, with the binary deleted, is binaryMissing", () => {
		const spec: PrebuiltBinarySpec = { packages: SPEC.packages };
		const host = fakeHost(
			{ platform: "darwin", arch: "arm64" },
			{ "@acme/cli-darwin-arm64/package.json": "/nm/pkg.json" },
		);
		const error = failure(PrebuiltBinary.resolveSync(spec, host));
		assert.strictEqual(error.reason, "binaryMissing");
		assert.strictEqual(error.packageName, "@acme/cli-darwin-arm64");
		assert.notInclude(error.message, "reinstall");
		// The package itself absent stays notInstalled.
		const absent = fakeHost({ platform: "darwin", arch: "arm64" }, {});
		assert.strictEqual(failure(PrebuiltBinary.resolveSync(spec, absent)).reason, "notInstalled");
	});

	it("reports a broken package over an absent one", () => {
		const host: PrebuiltHost = {
			target: { platform: "linux", arch: "x64", libc: "musl" },
			resolve: (specifier) => {
				const code = specifier.startsWith("@acme/cli-linux-x64-musl")
					? "MODULE_NOT_FOUND"
					: "ERR_INVALID_PACKAGE_CONFIG";
				throw Object.assign(new Error(specifier), { code });
			},
		};
		const error = failure(PrebuiltBinary.resolveSync(SPEC, host));
		assert.strictEqual(error.reason, "unresolvable");
		assert.strictEqual(error.packageName, "@acme/cli-linux-x64");
	});

	it("falls back to the generic key when no libc-specific package is published", () => {
		const glibc = fakeHost({ platform: "linux", arch: "x64", libc: "glibc" }, { "@acme/cli-linux-x64/bin/acme": "/g" });
		const result = PrebuiltBinary.resolveSync(SPEC, glibc);
		assert.isTrue(Result.isSuccess(result) && result.success.key === "linux-x64");
	});

	it("fails unsupportedTarget, without resolving anything, for an unpublished target", () => {
		const host = fakeHost({ platform: "darwin", arch: "x64" }, {});
		const error = failure(PrebuiltBinary.resolveSync(SPEC, host));
		assert.instanceOf(error, PrebuiltBinaryError);
		assert.strictEqual(error.reason, "unsupportedTarget");
		assert.deepStrictEqual(error.candidates, ["darwin-x64"]);
		assert.deepStrictEqual(host.seen, []);
		assert.include(error.message, "darwin-x64");
	});

	it("reads only MODULE_NOT_FOUND as notInstalled; any other failure is unresolvable with its cause", () => {
		const target = { platform: "darwin", arch: "arm64" } as const;
		assert.strictEqual(failure(PrebuiltBinary.resolveSync(SPEC, fakeHost(target, {}))).reason, "notInstalled");
		const broken = failure(PrebuiltBinary.resolveSync(SPEC, fakeHost(target, {}, "ERR_PACKAGE_PATH_NOT_EXPORTED")));
		assert.strictEqual(broken.reason, "unresolvable");
		assert.strictEqual((broken.cause as { readonly code?: string }).code, "ERR_PACKAGE_PATH_NOT_EXPORTED");
	});
});

describe("nodePrebuiltHost", () => {
	it("resolves an optional dependency from the declaring package's anchor, and only from there", () => {
		const root = mkdtempSync(join(tmpdir(), "prebuilt-"));
		try {
			const thin = join(root, "thin");
			const key = `${process.platform}-${process.arch}`;
			const platformPkg = join(thin, "node_modules", "@acme", `cli-${key}`);
			mkdirSync(join(platformPkg, "bin"), { recursive: true });
			writeFileSync(
				join(platformPkg, "package.json"),
				JSON.stringify({
					name: `@acme/cli-${key}`,
					exports: { ".": "./bin/acme", "./package.json": "./package.json" },
				}),
			);
			writeFileSync(join(platformPkg, "bin", "acme"), "");
			const spec: PrebuiltBinarySpec = { packages: { [key]: `@acme/cli-${key}` } };

			const host = nodePrebuiltHost(pathToFileURL(join(thin, "index.js")));
			assert.strictEqual(host.target.platform, process.platform);
			assert.strictEqual(host.target.arch, process.arch);
			const result = PrebuiltBinary.resolveSync(spec, host);
			assert.isTrue(Result.isSuccess(result));
			if (Result.isSuccess(result)) assert.isTrue(result.success.path.endsWith(join("bin", "acme")));

			// From outside the declaring package the same spec does not resolve.
			const outside = nodePrebuiltHost(join(root, "elsewhere", "index.js"));
			assert.strictEqual(failure(PrebuiltBinary.resolveSync(spec, outside)).reason, "notInstalled");

			// A subpath the package does not export is a packaging fault, not absence.
			assert.strictEqual(
				failure(PrebuiltBinary.resolveSync({ ...spec, binary: "bin/other" }, host)).reason,
				"unresolvable",
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('reads a deleted "." binary as binaryMissing under real Node resolution, exports-only or main-only', () => {
		const root = mkdtempSync(join(tmpdir(), "prebuilt-"));
		try {
			const thin = join(root, "thin");
			const key = `${process.platform}-${process.arch}`;
			const shapes = {
				// No "./package.json" export: the manifest probe answers ERR_PACKAGE_PATH_NOT_EXPORTED.
				exports: { exports: { ".": "./bin/acme" } },
				main: { main: "./bin/acme" },
			};
			const host = nodePrebuiltHost(pathToFileURL(join(thin, "index.js")));
			// Node caches a successful resolution process-wide, so the control (binary
			// present) and the case (binary deleted) are separate packages.
			for (const [shape, manifest] of Object.entries(shapes)) {
				for (const present of [true, false]) {
					const name = `@acme/cli-${shape}-${present}-${key}`;
					const dir = join(thin, "node_modules", name);
					mkdirSync(join(dir, "bin"), { recursive: true });
					writeFileSync(join(dir, "package.json"), JSON.stringify({ name, ...manifest }));
					if (present) writeFileSync(join(dir, "bin", "acme"), "");
					const result = PrebuiltBinary.resolveSync({ packages: { [key]: name } }, host);
					if (present) assert.isTrue(Result.isSuccess(result), shape);
					else assert.strictEqual(failure(result).reason, "binaryMissing", shape);
				}
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
