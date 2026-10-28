// Node's `exports` / `imports` resolution, TypeScript's view of it, and
// enumeration. Each group names the specification step it pins; the
// "stays inside the package" group is the adversarial half — one rejection
// per way a manifest or a request could name a file outside the package.

import { assert, describe, it } from "@effect/vitest";
import { SemVer } from "@effected/semver";
import { Effect, Option, Result } from "effect";
import type { PackageExportsManifest, PackageExportsOptions, PackageTypesOptions } from "../src/index.js";
import { PackageExports } from "../src/index.js";
import { toFilePath } from "../src/internal/exports.js";

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

	it("the substituted target is re-checked, so a '%' escape split across template and match cannot assemble", () => {
		// Each half passes alone; only the joined string spells "..".
		assert.strictEqual(path({ exports: { "./*": "./%2*/%2*/%2*/etc/passwd" } }, "./e%2e"), "!invalidModuleSpecifier");
		assert.strictEqual(path({ exports: { "./*": "./dist/%2*/x.js" } }, "./E%2E"), "!invalidModuleSpecifier");
		assert.strictEqual(path({ exports: { "./*": "./dist/%*/x.js" } }, "./2e%2e"), "!invalidModuleSpecifier");
		// An encoded separator assembled the same way.
		assert.strictEqual(path({ exports: { "./*": "./dist/%*" } }, "./2f.."), "!invalidModuleSpecifier");
		assert.strictEqual(path({ exports: { "./*": "./dist/%*" } }, "./5Cx"), "!invalidModuleSpecifier");
		// The same through imports, to a file and to a bare specifier.
		assert.strictEqual(importOf({ imports: { "#x/*": "./%2*/x.js" } }, "#x/e%2e"), "!invalidModuleSpecifier");
		assert.strictEqual(importOf({ imports: { "#x/*": "dep/%2*/x" } }, "#x/e%2e"), "!invalidModuleSpecifier");
	});

	it("a forbidden segment hidden under more than one layer of encoding is refused", () => {
		const exports = { "./*": "./dist/*/x.js" };
		for (const request of ["./%252e%252e", "./%%32%65%%32%65", "./%25%32%65.", "./node%255fmodules", "./a%252fb"]) {
			assert.strictEqual(path({ exports }, request), "!invalidModuleSpecifier", request);
		}
		assert.strictEqual(path({ exports: { "./*": "./dist/%%32%65*/x.js" } }, "./%2e"), "!invalidModuleSpecifier");
		assert.strictEqual(target("./%252e%252e/x.js"), "!invalidPackageTarget");
		assert.strictEqual(path({ main: "lib/%252e%252e/x.js" }, "."), "!invalidPackageTarget");
		// An ordinary escape in a file name still resolves, decoded once as Node
		// decodes it, and so does a second layer that settles on nothing
		// forbidden — which decodes to the literal file name `a%20b`.
		assert.strictEqual(path({ exports: { "./*": "./dist/*.js" } }, "./a%20b"), "./dist/a b.js");
		assert.strictEqual(path({ exports: { "./*": "./dist/*.js" } }, "./a%2520b"), "./dist/a%20b.js");
		// A spelling that never settles is refused rather than decoded forever.
		// `.` encoded once (`%2e`), then its `%` re-encoded five more times.
		let layered = "%2e";
		for (let index = 0; index < 5; index++) layered = layered.replaceAll("%", "%25");
		assert.strictEqual(path({ exports: { "./*": "./dist/*.js" } }, `./${layered}x`), "!invalidModuleSpecifier");
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

	it("a '..' in main that stays inside the package resolves, as Node loads it", () => {
		assert.strictEqual(path({ main: "./lib/../index.js" }, "."), "./index.js");
		assert.strictEqual(path({ main: "lib/a/../../index.js" }, "."), "./index.js");
		assert.strictEqual(path({ main: "lib//../x.js" }, "."), "./lib/x.js");
		assert.strictEqual(path({ main: "node_modules/../x.js" }, "."), "./x.js");
		assert.strictEqual(declaration({ types: "./lib/../index.d.ts" }, "."), "./index.d.ts");
		assert.strictEqual(declaration({ typesVersions: { "*": { "*": ["lib/../ts/*"] } } }, "./x.d.ts"), "./ts/x.d.ts");
	});

	it("a '..' in main that climbs out, or that rides an encoded or backslash spelling, is refused", () => {
		for (const main of [
			"./lib/../../x.js",
			"lib/..",
			"lib/../..",
			"..",
			"lib/%2e%2e/../x.js",
			"lib/%2E/../x.js",
			"lib/%252e%252e/../x.js",
			"lib/.%2e/../x.js",
			"lib/../%2e%2e/x.js",
			"lib/a%2fb/../x.js",
			"lib/../node_modules/x.js",
			"lib\\x/../y.js",
			"lib\\..\\x.js",
			// URL parsing strips a tab or newline, so this segment is a `..`.
			`lib/.${String.fromCodePoint(9)}./../x.js`,
			"lib/.%09./../x.js",
		]) {
			assert.strictEqual(path({ main }, "."), "!invalidPackageTarget", main);
		}
		assert.strictEqual(declaration({ types: "lib/../../x.d.ts" }, "."), "!invalidPackageTarget");
		assert.strictEqual(
			declaration({ typesVersions: { "*": { "*": ["lib/../../ts/*"] } } }, "./x.d.ts"),
			"!invalidPackageTarget",
		);
	});

	it("a '$' in a pattern match is substituted literally, never as a replacement pattern", () => {
		const exports = { "./*": "./dist/*.js" };
		for (const name of ["a$&b", "a$$b", "a$`b", "a$'b"]) {
			assert.strictEqual(path({ exports }, `./${name}`), `./dist/${name}.js`, name);
			assert.strictEqual(importOf({ imports: { "#u/*": "./src/*.js" } }, `#u/${name}`), `./src/${name}.js`, name);
			const typed = types({ typesVersions: { "*": { "*": ["ts/*"] } } }, `./${name}.d.ts`);
			assert.strictEqual(typeof typed === "string" ? typed : typed.target, `./ts/${name}.d.ts`, name);
		}
	});

	it("typesVersions substitutes the first '*' of a target only, as TypeScript does", () => {
		const typed = types({ typesVersions: { "*": { "*": ["ts/*/*"] } } }, "./x");
		assert.strictEqual(typeof typed === "string" ? typed : typed.target, "./ts/x/*");
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

	it("a bare import target must be a package name and an optional confined subpath", () => {
		for (const value of [
			"..",
			".",
			"..\\evil",
			"\\\\host\\share",
			".hidden",
			"_private",
			"",
			"@scope",
			"@/x",
			"dep/",
			"dep\\x",
			"dep/a\\b",
			"dep%2fx",
			"%2e%2e",
			"dep/../x",
			"dep/./x",
			"dep//x",
			"dep/%2e%2e/x",
			"dep/%252e%252e/x",
			"dep/node_modules/x",
		]) {
			assert.strictEqual(importOf({ imports: { "#x": value } }, "#x"), "!invalidModuleSpecifier", value);
		}
		for (const value of ["dep", "dep/feature", "@scope/dep/sub/x.js", "fs", "JSONStream", "lodash.get"]) {
			assert.strictEqual(importOf({ imports: { "#x": value } }, "#x"), `pkg:${value}`, value);
		}
		// As in Node, the failure ends an array fallback instead of passing to the next entry.
		assert.strictEqual(importOf({ imports: { "#x": ["..", "./fallback.js"] } }, "#x"), "!invalidModuleSpecifier");
		assert.strictEqual(importOf({ imports: { "#x": ["../x.js", "./fallback.js"] } }, "#x"), "./fallback.js");
	});

	it("a bare pattern target is checked as a template and again after substitution", () => {
		assert.strictEqual(importOf({ imports: { "#x/*": "*" } }, "#x/dep"), "pkg:dep");
		assert.strictEqual(importOf({ imports: { "#x/*": "*" } }, "#x/.hidden"), "!invalidModuleSpecifier");
		assert.strictEqual(importOf({ imports: { "#x/*": "*" } }, "#x/@scope"), "!invalidModuleSpecifier");
		assert.strictEqual(importOf({ imports: { "#x/*": "..\\*" } }, "#x/a"), "!invalidModuleSpecifier");
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

describe("a resolved path is the decoded file Node names", () => {
	// Every expectation here is what Node's own import.meta.resolve, read
	// through fileURLToPath, answers for the same target (checked against
	// Node directly); the "stricter" cases say where this resolver refuses
	// instead.
	const target = (value: string) => path({ exports: { "./x": value } }, "./x");
	const match = (request: string) => path({ exports: { "./p/*": "./dist/*.js" } }, request);
	const e = String.fromCodePoint(0xe9);

	it("an escape decodes once: a space, a literal '%', and no second round", () => {
		assert.strictEqual(target("./dist/a%20b.js"), "./dist/a b.js");
		assert.strictEqual(target("./dist/a b.js"), "./dist/a b.js");
		assert.strictEqual(target("./dist/a%25b.js"), "./dist/a%b.js");
		// `%2541` is the file `%41`, never `A`.
		assert.strictEqual(target("./dist/a%2541.js"), "./dist/a%41.js");
		assert.strictEqual(match("./p/a%20b"), "./dist/a b.js");
		assert.strictEqual(match("./p/a%25b"), "./dist/a%b.js");
		assert.strictEqual(match("./p/a%2541"), "./dist/a%41.js");
	});

	it("'+' is not a space", () => {
		assert.strictEqual(target("./dist/a+b.js"), "./dist/a+b.js");
		assert.strictEqual(match("./p/a+b"), "./dist/a+b.js");
	});

	it("a UTF-8 escape decodes to its character, and a raw non-ASCII character is itself", () => {
		assert.strictEqual(target("./dist/%C3%A9.js"), `./dist/${e}.js`);
		assert.strictEqual(target(`./dist/${e}.js`), `./dist/${e}.js`);
		assert.strictEqual(match("./p/%C3%A9"), `./dist/${e}.js`);
		assert.strictEqual(match(`./p/${e}`), `./dist/${e}.js`);
	});

	it("an invalid UTF-8 escape or a '%' starting no escape is refused, as Node refuses it", () => {
		// Lone continuation byte, truncated sequence, encoded surrogate, overlong '.'.
		for (const value of [
			"./dist/%FF.js",
			"./dist/%C3.js",
			"./dist/%ED%A0%80.js",
			"./dist/%C0%AE.js",
			"./dist/100%.js",
			"./dist/%zz.js",
		]) {
			assert.strictEqual(target(value), "!invalidPackageTarget", value);
		}
		// Supplied by the request's match, it is the request that is to blame.
		for (const request of ["./p/%FF", "./p/%C0%AE", "./p/100%"]) {
			assert.strictEqual(match(request), "!invalidModuleSpecifier", request);
		}
	});

	it("a target that fails to decode does not fall back to the next array entry", () => {
		// Node picks the first valid target and only then fails reading it.
		assert.strictEqual(path({ exports: { "./x": ["./dist/%FF.js", "./ok.js"] } }, "./x"), "!invalidPackageTarget");
	});

	it("a raw '?' or '#', which Node truncates as a query or fragment, is refused: stricter than Node", () => {
		assert.strictEqual(target("./dist/a#b.js"), "!invalidPackageTarget");
		assert.strictEqual(target("./dist/a?b.js"), "!invalidPackageTarget");
		assert.strictEqual(match("./p/a#b"), "!invalidModuleSpecifier");
		assert.strictEqual(match("./p/a?b"), "!invalidModuleSpecifier");
		// Encoded, they are ordinary file-name characters.
		assert.strictEqual(target("./dist/a%23b.js"), "./dist/a#b.js");
		assert.strictEqual(target("./dist/a%3Fb.js"), "./dist/a?b.js");
	});

	it("a decoded NUL is refused: stricter than Node, which hands it to the filesystem", () => {
		assert.strictEqual(target("./dist/%00.js"), "!invalidPackageTarget");
		assert.strictEqual(match("./p/%00"), "!invalidModuleSpecifier");
	});

	it("a backslash separates, as URL parsing makes it one", () => {
		assert.strictEqual(target("./dist\\a.js"), "./dist/a.js");
	});

	it("an encoded '..' is refused BEFORE decoding, where decoding would quietly land elsewhere in the package", () => {
		// URL parsing would normalize this to ./index.js, a file of the
		// package, so only the validation ahead of decoding refuses it.
		assert.strictEqual(target("./dist/%2e%2e/index.js"), "!invalidPackageTarget");
		assert.strictEqual(path({ exports: { "./p/*": "./dist/*/index.js" } }, "./p/%2e%2e"), "!invalidModuleSpecifier");
		assert.strictEqual(path({ exports: { "./p/*": "./dist/*/index.js" } }, "./p/%2E%2E"), "!invalidModuleSpecifier");
		assert.strictEqual(importOf({ imports: { "#x": "./src/%2e%2e/index.js" } }, "#x"), "!invalidPackageTarget");
	});

	it("imports file targets, the legacy main and a legacy subpath decode too", () => {
		assert.strictEqual(importOf({ imports: { "#x": "./src/a%20b.js" } }, "#x"), "./src/a b.js");
		assert.strictEqual(importOf({ imports: { "#x/*": "./src/*.js" } }, "#x/a%25b"), "./src/a%b.js");
		// A bare-specifier target is handed on as written.
		assert.strictEqual(importOf({ imports: { "#d": "dep/a%20b" } }, "#d"), "pkg:dep/a%20b");
		assert.strictEqual(path({ main: "lib/a%20b.js" }, "."), "./lib/a b.js");
		assert.strictEqual(path({ main: "lib/./x.js" }, "."), "./lib/x.js");
		assert.strictEqual(path({ main: "lib/%FF.js" }, "."), "!invalidPackageTarget");
		assert.strictEqual(path({}, "./a%20b.js"), "./a b.js");
		assert.strictEqual(path({}, "./a%FF.js"), "!invalidModuleSpecifier");
	});

	it("TypeScript reads targets UNDECODED, so the types statics keep the written form", () => {
		// tsc reads "./dist/a%20b.d.ts" as that literal file name, never "a b.d.ts".
		assert.strictEqual(
			declaration({ exports: { "./x": { types: "./dist/a%20b.d.ts", default: "./dist/a.js" } } }, "./x"),
			"./dist/a%20b.d.ts",
		);
		assert.strictEqual(declaration({ types: "lib/a%20b.d.ts" }, "."), "./lib/a%20b.d.ts");
		const fromMain = types({ main: "lib/a%20b.js" }, ".");
		assert.strictEqual(typeof fromMain === "string" ? fromMain : fromMain.target, "./lib/a%20b.js");
	});

	it("the last guard on a decoded path holds even for input no validation passed", () => {
		// Climbs out of the package URL (a name long enough that only the
		// package-URL check, not the empty-path one, can refuse it).
		assert.isUndefined(toFilePath("./%2e%2e/outside-the-package.js"));
		// Normalizes INTO node_modules.
		assert.isUndefined(toFilePath("./a/%2e%2e/node_modules/x.js"));
		assert.isUndefined(toFilePath("./NODE_MODULES/x.js"));
		assert.isUndefined(toFilePath("./a%00.js"));
		assert.isUndefined(toFilePath("./a%2fb.js"));
		assert.isUndefined(toFilePath("./"));
		assert.strictEqual(toFilePath("./a%20b.js"), "./a b.js");
		// A template keeps its stars; a run that cannot decode alone, or decodes to a star, names no files.
		assert.strictEqual(toFilePath("./dist/%C3%A9/*.js", true), `./dist/${e}/*.js`);
		assert.isUndefined(toFilePath("./dist/%2*/z.js", true));
		assert.isUndefined(toFilePath("./dist/%2a*.js", true));
		assert.strictEqual(toFilePath("./dist/%2a.js"), "./dist/*.js");
	});

	it("enumeration reports decoded paths, and fails naming the key of a target that names no file", () => {
		const entries = Result.getOrThrow(
			PackageExports.entriesResult({ exports: { "./sp": "./dist/a%20b.js", "./*": "./dist/%C3%A9/*.js" } }),
		);
		assert.deepStrictEqual(
			entries.map((entry) => [entry.subpath, entry.path] as const),
			[
				["./sp", "./dist/a b.js"],
				["./*", `./dist/${e}/*.js`],
			],
		);
		for (const [key, value] of [
			["./bad", "./dist/%FF.js"],
			["./split/*", "./dist/%2*/z.js"],
		] as const) {
			const result = PackageExports.entriesResult({ exports: { "./a": "./a.js", [key]: value } });
			if (Result.isFailure(result)) {
				assert.strictEqual(result.failure.reason, "invalidPackageTarget");
				assert.strictEqual(result.failure.request, key);
			} else {
				assert.fail(`expected ${key} to fail the enumeration`);
			}
		}
		// The TypeScript enumeration is undecoded.
		const typesEntries = Result.getOrThrow(
			PackageExports.typesEntriesResult({ exports: { "./sp": "./dist/a%20b.d.ts" } }),
		);
		assert.strictEqual(typesEntries[0]?.target, "./dist/a%20b.d.ts");
	});
});
