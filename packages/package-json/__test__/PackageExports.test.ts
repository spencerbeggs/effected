// Node's `exports` / `imports` resolution, TypeScript's view of it, and
// enumeration. Each group names the specification step it pins; the
// "stays inside the package" group is the adversarial half — one rejection
// per way a manifest or a request could name a file outside the package.

import { assert, describe, it } from "@effect/vitest";
import { SemVer } from "@effected/semver";
import { Effect, Option, Result } from "effect";
import type { PackageExportsManifest, PackageExportsOptions, PackageTypesOptions } from "../src/index.js";
import { PackageExports } from "../src/index.js";

/** The resolved path, or the failure reason prefixed with `!`. */
const path = (manifest: PackageExportsManifest, subpath: string, options?: PackageExportsOptions): string => {
	const result = PackageExports.resolveResult(manifest, subpath, options);
	return Result.isSuccess(result) ? result.success.path : `!${result.failure.reason}`;
};

const importOf = (manifest: PackageExportsManifest, specifier: string, options?: PackageExportsOptions): string => {
	const result = PackageExports.resolveImportResult(manifest, specifier, options);
	if (Result.isFailure(result)) return `!${result.failure.reason}`;
	return result.success.kind === "file" ? result.success.path : `pkg:${result.success.specifier}`;
};

const types = (manifest: PackageExportsManifest, subpath: string, options?: PackageTypesOptions) => {
	const result = PackageExports.resolveTypesResult(manifest, subpath, options);
	if (Result.isFailure(result)) return `!${result.failure.reason}`;
	return result.success;
};

const declaration = (manifest: PackageExportsManifest, subpath: string, options?: PackageTypesOptions): string => {
	const resolved = types(manifest, subpath, options);
	return typeof resolved === "string" ? resolved : Option.getOrElse(resolved.declaration, () => "<none>");
};

describe("PackageExports.splitSpecifier — the path boundary", () => {
	const split = (specifier: string) => Option.getOrNull(PackageExports.splitSpecifier(specifier));

	it("splits a scoped subpath", () => {
		assert.deepStrictEqual(split("@effect/platform/Http"), { name: "@effect/platform", subpath: "./Http" });
	});

	it("pkg2 is its own package, never pkg plus 2", () => {
		assert.deepStrictEqual(split("pkg2"), { name: "pkg2", subpath: "." });
		assert.deepStrictEqual(split("pkg2/x"), { name: "pkg2", subpath: "./x" });
		assert.deepStrictEqual(split("pkg/2"), { name: "pkg", subpath: "./2" });
	});

	it("refuses what is no package name", () => {
		for (const specifier of ["", "@scope", "@scope/", "./local", ".hidden", "a\\b", "%2e"]) {
			assert.isNull(split(specifier), specifier);
		}
	});
});

describe("PACKAGE_EXPORTS_RESOLVE", () => {
	it("root sugar: a string, an array, or a conditions object is the '.' entry", () => {
		assert.strictEqual(path({ exports: "./i.js" }, "."), "./i.js");
		assert.strictEqual(path({ exports: ["./i.js"] }, "."), "./i.js");
		assert.strictEqual(path({ exports: { import: "./i.js" } }, "."), "./i.js");
		assert.strictEqual(path({ exports: "./i.js" }, "./x"), "!packagePathNotExported");
	});

	it("an exact subpath key", () => {
		assert.strictEqual(path({ exports: { ".": "./i.js", "./Http": "./http.js" } }, "./Http"), "./http.js");
	});

	it("mixing '.' keys and condition keys is an invalid configuration", () => {
		assert.strictEqual(path({ exports: { ".": "./i.js", import: "./x.js" } }, "."), "!invalidPackageConfiguration");
	});

	it("exports encapsulates: an unexported subpath never falls back to main", () => {
		assert.strictEqual(path({ exports: { ".": "./i.js" }, main: "./main.js" }, "./main.js"), "!packagePathNotExported");
	});

	it("with exports absent, '.' is main and a subpath is itself", () => {
		assert.strictEqual(path({ main: "lib/index.js" }, "."), "./lib/index.js");
		assert.strictEqual(path({}, "."), "./index.js");
		assert.strictEqual(path({ exports: null }, "./a/b.js"), "./a/b.js");
	});

	it("a request must be '.' or start with './'", () => {
		assert.strictEqual(path({ exports: { "./x": "./x.js" } }, "x"), "!invalidModuleSpecifier");
		assert.strictEqual(path({ exports: { "./x/": "./x/" } }, "./x/"), "!invalidModuleSpecifier");
	});
});

describe("PACKAGE_TARGET_RESOLVE — conditions, arrays, null", () => {
	it("walks conditions in the MANIFEST's key order, not the caller's", () => {
		const manifest = { exports: { require: "./c.cjs", import: "./e.js" } };
		assert.strictEqual(path(manifest, ".", { conditions: ["import", "require"] }), "./c.cjs");
		assert.strictEqual(path(manifest, ".", { conditions: ["import"] }), "./e.js");
	});

	it("default always matches; nested conditions recurse", () => {
		assert.strictEqual(path({ exports: { browser: "./b.js", default: "./d.js" } }, "."), "./d.js");
		assert.strictEqual(path({ exports: { node: { import: "./n.mjs", default: "./n.cjs" } } }, "."), "./n.mjs");
	});

	it("an unmatched nested branch falls through to the next condition", () => {
		assert.strictEqual(path({ exports: { node: { worker: "./w.js" }, default: "./d.js" } }, "."), "./d.js");
	});

	it("no matching condition is not exported", () => {
		assert.strictEqual(path({ exports: { browser: "./b.js" } }, "."), "!packagePathNotExported");
	});

	it("an array-index key in a conditions object is an invalid configuration", () => {
		assert.strictEqual(
			path({ exports: { ".": { "0": "./a.js", default: "./d.js" } } }, "."),
			"!invalidPackageConfiguration",
		);
	});

	it("arrays are fallbacks: invalid targets are skipped, the first valid one wins", () => {
		assert.strictEqual(path({ exports: ["not-relative", "./ok.js"] }, "."), "./ok.js");
		assert.strictEqual(path({ exports: [{ browser: "./b.js" }, "./d.js"] }, "."), "./d.js");
		assert.strictEqual(path({ exports: ["bad-a", "bad-b"] }, "."), "!invalidPackageTarget");
		assert.strictEqual(path({ exports: [] }, "."), "!packagePathNotExported");
	});

	it("a null in an array is passed over, as Node's implementation does", () => {
		assert.strictEqual(path({ exports: [null, "./ok.js"] }, "."), "./ok.js");
		assert.strictEqual(path({ exports: [null] }, "."), "!packagePathNotExported");
	});

	it("a null target excludes the subpath", () => {
		assert.strictEqual(path({ exports: { "./x": null } }, "./x"), "!packagePathNotExported");
	});

	it("a non-string, non-object target is invalid", () => {
		assert.strictEqual(path({ exports: { ".": 42 } }, "."), "!invalidPackageTarget");
	});
});

describe("PACKAGE_IMPORTS_EXPORTS_RESOLVE — patterns", () => {
	const manifest = {
		exports: {
			"./*": "./dist/*.js",
			"./internal/*": null,
			"./features/*.js": "./src/features/*.js",
			"./both/*": "./a/*/b/*.js",
		},
	};

	it("substitutes the match into every '*' of the target", () => {
		assert.strictEqual(path(manifest, "./Http"), "./dist/Http.js");
		assert.strictEqual(path(manifest, "./nested/deep"), "./dist/nested/deep.js");
		assert.strictEqual(path(manifest, "./both/x"), "./a/x/b/x.js");
	});

	it("the most specific key decides, so a null pattern excludes", () => {
		assert.strictEqual(path(manifest, "./internal/secret"), "!packagePathNotExported");
	});

	it("a pattern trailer must match", () => {
		assert.strictEqual(path(manifest, "./features/a.js"), "./src/features/a.js");
		// "./features/a.ts" misses the trailer and falls to "./*".
		assert.strictEqual(path(manifest, "./features/a.ts"), "./dist/features/a.ts.js");
	});

	it("a base and trailer that overlap in the request are no match", () => {
		// "./aa" starts with "./a" and ends with "a", but is shorter than the
		// key "./a*a": the star would have to match nothing.
		assert.strictEqual(path({ exports: { "./a*a": "./x/*.js" } }, "./aa"), "!packagePathNotExported");
		assert.strictEqual(path({ exports: { "./a*a": "./x/*.js" } }, "./aba"), "./x/b.js");
	});

	it("an exact key beats a pattern, and the base alone is no match", () => {
		assert.strictEqual(path({ exports: { "./a/*": "./p/*.js", "./a/x": "./exact.js" } }, "./a/x"), "./exact.js");
		assert.strictEqual(path({ exports: { "./a/*": "./p/*.js" } }, "./a/"), "!invalidModuleSpecifier");
	});

	it("PATTERN_KEY_COMPARE: longer base first, then longer key", () => {
		const exports = { "./*": "./one/*", "./a/*": "./two/*", "./a/*.js": "./three/*.js" };
		assert.strictEqual(path({ exports }, "./a/b.js"), "./three/b.js");
		assert.strictEqual(path({ exports }, "./a/b"), "./two/b");
		assert.strictEqual(path({ exports }, "./c"), "./one/c");
	});

	it("a key with two '*' never matches", () => {
		assert.strictEqual(path({ exports: { "./*/*": "./x/*" } }, "./a/b"), "!packagePathNotExported");
	});

	it("thousands of pattern keys resolve by scan, with no regex to backtrack", () => {
		const exports: Record<string, string> = {};
		for (let index = 0; index < 20000; index++) exports[`./p${index}/*${"a".repeat(30)}`] = `./d${index}/*.js`;
		exports["./*"] = "./fallback/*.js";
		const started = performance.now();
		assert.strictEqual(path({ exports }, `./${"a".repeat(5000)}`), `./fallback/${"a".repeat(5000)}.js`);
		assert.isBelow(performance.now() - started, 2000);
	});
});

describe("a resolved target stays inside the package", () => {
	const target = (value: string) => path({ exports: { "./x": value } }, "./x");

	it("a target must start with './'", () => {
		for (const value of ["dist/x.js", "../x.js", "/etc/passwd", "file:///etc/passwd", "https://evil.example/x.js"]) {
			assert.strictEqual(target(value), "!invalidPackageTarget", value);
		}
	});

	it("no '..', '.', empty or node_modules segment after the first", () => {
		for (const value of ["./a/../../x.js", "./..", "./a/./b.js", "./a//b.js", "./node_modules/dep/x.js", "./"]) {
			assert.strictEqual(target(value), "!invalidPackageTarget", value);
		}
	});

	it("the segment check is case-insensitive and sees through percent-encoding", () => {
		for (const value of [
			"./%2e%2e/x.js",
			"./%2E./x.js",
			"./a/%2e/b.js",
			"./NODE_MODULES/x.js",
			"./node%5fmodules/x.js",
		]) {
			assert.strictEqual(target(value), "!invalidPackageTarget", value);
		}
	});

	it("backslash is a separator too", () => {
		assert.strictEqual(target("./a\\..\\..\\x.js"), "!invalidPackageTarget");
	});

	it("an encoded separator cannot hide a segment boundary", () => {
		assert.strictEqual(target("./a%2f..%2f..%2fx.js"), "!invalidPackageTarget");
		assert.strictEqual(target("./a%5C..%5Cx.js"), "!invalidPackageTarget");
	});

	it("a '*' match cannot inject '../' or any forbidden segment", () => {
		const exports = { "./*": "./dist/*.js" };
		for (const request of [
			"./../../secret",
			"./a/../../secret",
			"./%2e%2e/secret",
			"./a/%2E%2E/b",
			"./node_modules/dep",
			"./a%2f..%2fb",
			"./a\\..\\b",
		]) {
			assert.strictEqual(path({ exports }, request), "!invalidModuleSpecifier", request);
		}
	});

	it("a match that starts mid-segment cannot become a '..' segment after substitution", () => {
		// The request "./pre.." has no ".." segment of its own; the match ".."
		// does, and substituting it would make "./dist/../index.js".
		const exports = { "./pre*": "./dist/*/index.js" };
		assert.strictEqual(path({ exports }, "./pre.."), "!invalidModuleSpecifier");
		assert.strictEqual(path({ exports }, "./pre%2e%2e"), "!invalidModuleSpecifier");
		assert.strictEqual(path({ exports }, "./prefix"), "./dist/fix/index.js");
		assert.strictEqual(importOf({ imports: { "#pre*": "dep/*/x" } }, "#pre.."), "!invalidModuleSpecifier");
	});

	it("a dot inside a segment is legal", () => {
		// The match "a.b" contains a dot but no "." segment — legal.
		assert.strictEqual(path({ exports: { "./*": "./dist/*.js" } }, "./a.b"), "./dist/a.b.js");
	});

	it("main is confined too, where Node does not confine it", () => {
		assert.strictEqual(path({ main: "../outside.js" }, "."), "!invalidPackageTarget");
		assert.strictEqual(path({ main: "/abs.js" }, "."), "!invalidPackageTarget");
		assert.strictEqual(path({ main: "lib/%2e%2e/%2e%2e/x.js" }, "."), "!invalidPackageTarget");
	});

	it("a legacy subpath request is held to the segment rule", () => {
		assert.strictEqual(path({}, "./a/../../x.js"), "!invalidModuleSpecifier");
	});

	it("the failure names the request and the offending target", () => {
		const result = PackageExports.resolveResult({ exports: { "./x": "../evil.js" } }, "./x");
		assert.isTrue(Result.isFailure(result));
		if (Result.isFailure(result)) {
			assert.strictEqual(result.failure.request, "./x");
			assert.strictEqual(result.failure.target, "../evil.js");
			assert.strictEqual(result.failure.code, "ERR_INVALID_PACKAGE_TARGET");
			assert.include(result.failure.message, "outside the package");
		} else {
			assert.fail("expected a failure");
		}
	});
});

describe("hostile manifests", () => {
	it("a __proto__ key in exports cannot reach the prototype", () => {
		const manifest = JSON.parse('{"exports":{"__proto__":{"polluted":true},"./x":"./x.js"}}') as PackageExportsManifest;
		// Mixed "." and non-"." keys: the configuration is invalid, and nothing leaked.
		assert.strictEqual(path(manifest, "./x"), "!invalidPackageConfiguration");
		assert.isUndefined(({} as Record<string, unknown>).polluted);
	});

	it("a './__proto__' subpath key is an ordinary own key", () => {
		const manifest = JSON.parse('{"exports":{"./__proto__":"./p.js","./x":"./x.js"}}') as PackageExportsManifest;
		assert.strictEqual(path(manifest, "./__proto__"), "./p.js");
		assert.strictEqual(path(manifest, "./x"), "./x.js");
		const entries = Result.getOrThrow(PackageExports.entriesResult(manifest));
		assert.deepStrictEqual(
			entries.map((entry) => entry.subpath),
			["./__proto__", "./x"],
		);
		assert.isUndefined(({} as Record<string, unknown>).polluted);
	});

	it("a __proto__ condition is an ordinary own key, matched only when asked for", () => {
		const manifest = JSON.parse(
			'{"exports":{".":{"__proto__":"./proto.js","default":"./d.js"}}}',
		) as PackageExportsManifest;
		assert.strictEqual(path(manifest, "."), "./d.js");
		assert.strictEqual(path(manifest, ".", { conditions: ["__proto__"] }), "./proto.js");
	});

	it("inherited names are no keys: './constructor' is not exported by a map that does not write it", () => {
		assert.strictEqual(path({ exports: { ".": "./i.js" } }, "./constructor"), "!packagePathNotExported");
		assert.strictEqual(
			path({ exports: { ".": { default: "./d.js" } } }, ".", { conditions: ["constructor"] }),
			"./d.js",
		);
		assert.strictEqual(importOf({ imports: {} }, "#constructor"), "!packageImportNotDefined");
	});

	it("deep nesting fails typed instead of overflowing the stack", () => {
		let nested: unknown = "./leaf.js";
		for (let index = 0; index < 20000; index++) nested = { default: nested };
		assert.strictEqual(path({ exports: nested }, "."), "!limitExceeded");
		let arrays: unknown = "./leaf.js";
		for (let index = 0; index < 20000; index++) arrays = [arrays];
		assert.strictEqual(path({ exports: arrays }, "."), "!limitExceeded");
	});

	it("a pattern target with too many stars is refused before substitution", () => {
		assert.strictEqual(path({ exports: { "./*": `./${"*/".repeat(64)}x.js` } }, "./a"), "!limitExceeded");
		assert.strictEqual(path({ exports: { "./*": "./*/*.js" } }, "./a"), "./a/a.js");
	});
});

describe("PACKAGE_IMPORTS_RESOLVE", () => {
	const manifest = {
		imports: {
			"#internal": "./src/internal.js",
			"#utils/*": { node: "./src/utils/*.js", default: "./browser/*.js" },
			"#dep": "dep/feature",
			"#dep/*": "dep/*",
			"#/root/*": "./root/*.js",
		},
	};

	it("resolves an exact key and a pattern under conditions", () => {
		assert.strictEqual(importOf(manifest, "#internal"), "./src/internal.js");
		assert.strictEqual(importOf(manifest, "#utils/x"), "./src/utils/x.js");
		assert.strictEqual(importOf(manifest, "#utils/x", { conditions: ["browser"] }), "./browser/x.js");
	});

	it("an import may map to another package's specifier", () => {
		assert.strictEqual(importOf(manifest, "#dep"), "pkg:dep/feature");
		assert.strictEqual(importOf(manifest, "#dep/sub"), "pkg:dep/sub");
	});

	it("'#/' keys are legal, only '#' itself is not", () => {
		assert.strictEqual(importOf(manifest, "#/root/a"), "./root/a.js");
		assert.strictEqual(importOf(manifest, "#"), "!invalidModuleSpecifier");
		assert.strictEqual(importOf(manifest, "no-hash"), "!invalidModuleSpecifier");
	});

	it("an undefined import, or no imports at all", () => {
		assert.strictEqual(importOf(manifest, "#missing"), "!packageImportNotDefined");
		assert.strictEqual(importOf({}, "#x"), "!packageImportNotDefined");
	});

	it("an import target still cannot escape: '../', '/', a URL", () => {
		for (const value of ["../x.js", "/x.js", "file:///x.js", "data:text/javascript,1"]) {
			assert.strictEqual(importOf({ imports: { "#x": value } }, "#x"), "!invalidPackageTarget", value);
		}
	});

	it("a '*' match cannot inject '../' into a bare specifier either", () => {
		assert.strictEqual(importOf(manifest, "#dep/../../x"), "!invalidModuleSpecifier");
	});
});

describe("PackageExports.resolveTypesResult — TypeScript's reading", () => {
	it("types wins over import and default when it is written first", () => {
		const manifest = { exports: { ".": { types: "./index.d.ts", import: "./index.js", default: "./index.cjs" } } };
		assert.strictEqual(declaration(manifest, "."), "./index.d.ts");
	});

	it("a types key written after import is never reached — the position matters", () => {
		const manifest = { exports: { ".": { import: "./index.mjs", types: "./index.d.ts" } } };
		const resolved = types(manifest, ".");
		assert.notStrictEqual(typeof resolved, "string");
		if (typeof resolved !== "string") {
			assert.strictEqual(resolved.target, "./index.mjs");
			assert.deepStrictEqual(resolved.candidates, ["./index.mts", "./index.d.mts"]);
		}
	});

	it("extension substitution for .js, .mjs and .cjs targets", () => {
		assert.deepStrictEqual((types({ exports: "./a.js" }, ".") as { candidates: ReadonlyArray<string> }).candidates, [
			"./a.ts",
			"./a.tsx",
			"./a.d.ts",
		]);
		assert.strictEqual(declaration({ exports: { require: "./a.cjs" } }, ".", { conditions: ["require"] }), "./a.d.cts");
	});

	it("versioned types@ conditions match the TypeScript version given", () => {
		const manifest = {
			exports: {
				"./sub": { "types@>=5.2": "./ts5.2/sub.d.ts", "types@>=4.6": "./ts4.6/sub.d.ts", types: "./old/sub.d.ts" },
			},
		};
		const version = (v: string) => ({ typeScriptVersion: Result.getOrThrow(SemVer.parseResult(v)) });
		assert.strictEqual(declaration(manifest, "./sub", version("4.7.5")), "./ts4.6/sub.d.ts");
		assert.strictEqual(declaration(manifest, "./sub", version("5.4.0")), "./ts5.2/sub.d.ts");
		assert.strictEqual(declaration(manifest, "./sub"), "./old/sub.d.ts");
	});

	it("typesVersions is not read when exports is present", () => {
		const manifest = { exports: { ".": { types: "./index.d.ts" } }, typesVersions: { "*": { "*": ["ts/*"] } } };
		assert.strictEqual(declaration(manifest, "."), "./index.d.ts");
	});

	it("typesVersions: exact keys before wildcard patterns", () => {
		const manifest = { typesVersions: { "*": { "*": ["ts/*"], Http: ["http/index.d.ts"] } } };
		assert.strictEqual(declaration(manifest, "./Http"), "./http/index.d.ts");
		assert.strictEqual(declaration(manifest, "./Other.d.ts"), "./ts/Other.d.ts");
	});

	it("typesVersions: the longest single-'*' prefix wins and multi-'*' keys never match", () => {
		const target = (manifest: PackageExportsManifest, subpath: string) =>
			(types(manifest, subpath) as { target: string }).target;
		// Either key order: the longer prefix decides, not the later key.
		assert.strictEqual(
			target({ typesVersions: { "*": { "*": ["a/*"], "sub/*": ["b/*"] } } }, "./sub/x.d.ts"),
			"./b/x.d.ts",
		);
		assert.strictEqual(
			target({ typesVersions: { "*": { "sub/*": ["b/*"], "*": ["a/*"] } } }, "./sub/x.d.ts"),
			"./b/x.d.ts",
		);
		// "s*/*" has two stars; read as one, its "s" prefix would beat "*".
		assert.strictEqual(target({ typesVersions: { "*": { "*": ["a/*"], "s*/*": ["c/*"] } } }, "./s1/*"), "./a/s1/*");
	});

	it("typesVersions: the first entry whose range admits the version", () => {
		const manifest = {
			typesVersions: { "<4.0": { "index.d.ts": ["index.v3.d.ts"] }, ">=3.1": { "*": ["ts3.1/*"] } },
			types: "index.d.ts",
		};
		const v = (raw: string) => ({ typeScriptVersion: Result.getOrThrow(SemVer.parseResult(raw)) });
		assert.strictEqual(declaration(manifest, ".", v("3.5.0")), "./index.v3.d.ts");
		assert.strictEqual(declaration(manifest, ".", v("5.0.0")), "./ts3.1/index.d.ts");
		// No version: only a "*" range applies, and none is written.
		assert.strictEqual(declaration(manifest, "."), "./index.d.ts");
	});

	it("typesVersions targets are confined to the package", () => {
		const manifest = { typesVersions: { "*": { "*": ["../outside/*"] } } };
		assert.strictEqual(types(manifest, "./x.d.ts"), "!invalidPackageTarget");
	});

	it("without exports or typesVersions: types, typings, then main", () => {
		assert.strictEqual(declaration({ types: "lib/index.d.ts" }, "."), "./lib/index.d.ts");
		assert.strictEqual(declaration({ typings: "./t.d.ts" }, "."), "./t.d.ts");
		assert.strictEqual(declaration({ main: "lib/main.js" }, "."), "./lib/main.d.ts");
		assert.strictEqual(declaration({}, "."), "./index.d.ts");
		assert.strictEqual(declaration({}, "./sub"), "./sub.d.ts");
	});
});

describe("PackageExports.entriesResult — enumeration", () => {
	it("lists every exported subpath in manifest order, patterns as templates", () => {
		const manifest = {
			exports: {
				".": { import: "./index.js" },
				"./package.json": "./package.json",
				"./*": "./dist/*.js",
				"./internal/*": null,
				"./browser-only": { browser: "./b.js" },
				"./old/": "./old/",
				"./*/*": "./x/*",
			},
		};
		const entries = Result.getOrThrow(PackageExports.entriesResult(manifest));
		assert.deepStrictEqual(
			entries.map((entry) => [entry.subpath, entry.path, entry.pattern] as const),
			[
				[".", "./index.js", false],
				["./package.json", "./package.json", false],
				["./*", "./dist/*.js", true],
			],
		);
	});

	it("an invalid target fails the enumeration and names its key", () => {
		const result = PackageExports.entriesResult({ exports: { "./a": "./a.js", "./bad": "../x.js" } });
		assert.isTrue(Result.isFailure(result));
		if (Result.isFailure(result)) {
			assert.strictEqual(result.failure.reason, "invalidPackageTarget");
			assert.strictEqual(result.failure.request, "./bad");
		} else {
			assert.fail("expected a failure");
		}
	});

	it("root sugar and the legacy main enumerate '.'", () => {
		assert.deepStrictEqual(
			Result.getOrThrow(PackageExports.entriesResult({ exports: "./i.js" })).map((e) => e.path),
			["./i.js"],
		);
		assert.deepStrictEqual(
			Result.getOrThrow(PackageExports.entriesResult({ main: "lib.js" })).map((e) => e.path),
			["./lib.js"],
		);
	});

	it("typesEntriesResult lists declaration candidates under the types conditions", () => {
		const manifest = {
			exports: {
				".": { types: "./index.d.ts", default: "./index.js" },
				"./*": { types: "./types/*.d.ts", default: "./dist/*.js" },
				"./runtime": "./runtime.js",
			},
		};
		const entries = Result.getOrThrow(PackageExports.typesEntriesResult(manifest));
		assert.deepStrictEqual(
			entries.map((entry) => [entry.subpath, Option.getOrNull(entry.declaration), entry.pattern] as const),
			[
				[".", "./index.d.ts", false],
				["./*", "./types/*.d.ts", true],
				["./runtime", "./runtime.d.ts", false],
			],
		);
	});
});

describe("the Effect twins", () => {
	it.effect("resolve and entries lift the Result forms", () =>
		Effect.gen(function* () {
			const resolved = yield* PackageExports.resolve({ exports: { "./x": "./x.js" } }, "./x");
			assert.strictEqual(resolved.path, "./x.js");
			const error = yield* Effect.flip(PackageExports.resolve({ exports: { "./x": "./x.js" } }, "./y"));
			assert.strictEqual(error._tag, "PackageExportsError");
			assert.strictEqual(error.reason, "packagePathNotExported");
			const entries = yield* PackageExports.entries({ exports: "./i.js" });
			assert.lengthOf(entries, 1);
			const typed = yield* PackageExports.resolveTypes({ types: "i.d.ts" }, ".");
			assert.strictEqual(typed.source, "types");
			const imported = yield* PackageExports.resolveImport({ imports: { "#a": "./a.js" } }, "#a");
			assert.strictEqual(imported.kind, "file");
			const typesEntries = yield* PackageExports.typesEntries({ exports: "./i.js" });
			assert.lengthOf(typesEntries, 1);
		}),
	);
});
