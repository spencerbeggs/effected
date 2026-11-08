// Task 5: the GlobPattern public module — compile (the fallible boundary),
// total matching, the enumerator metadata getters, the schema-validated
// options surface, the FromString codec and the escape statics.

import { assert, describe, it } from "@effect/vitest";
import { Arbitrary, Effect, Result, Schema } from "effect";
import { Minimatch, minimatch as oracle } from "minimatch";
import { GlobPattern, GlobPatternError, GlobPatternOptions } from "../src/index.js";

describe("GlobPattern.compile", () => {
	it.effect("compiles and matches with segment-scoped star", () =>
		Effect.gen(function* () {
			const p = yield* GlobPattern.compile("packages/*");
			assert.strictEqual(p.source, "packages/*");
			assert.isTrue(p.matches("packages/a"));
			assert.isFalse(p.matches("packages/a/b"));
			assert.isFalse(p.matches("other/a"));
		}),
	);

	it.effect("globstar is real: packages/** matches nested paths", () =>
		Effect.gen(function* () {
			const p = yield* GlobPattern.compile("packages/**");
			assert.isTrue(p.matches("packages/a"));
			assert.isTrue(p.matches("packages/a/b"));
		}),
	);

	it.effect("honours options: dot", () =>
		Effect.gen(function* () {
			const p = yield* GlobPattern.compile("*", GlobPatternOptions.make({ dot: true }));
			assert.isTrue(p.matches(".hidden"));
			const q = yield* GlobPattern.compile("*");
			assert.isFalse(q.matches(".hidden"));
		}),
	);

	it.effect("honours options: nocase", () =>
		Effect.gen(function* () {
			const p = yield* GlobPattern.compile("AbC", GlobPatternOptions.make({ nocase: true }));
			assert.isTrue(p.matches("abc"));
		}),
	);

	it.effect("honours options: platform win32 splits backslashes; posix default does not", () =>
		Effect.gen(function* () {
			const win = yield* GlobPattern.compile("a/b", GlobPatternOptions.make({ platform: "win32" }));
			assert.isTrue(win.matches("a\\b"));
			const posix = yield* GlobPattern.compile("a/b");
			assert.isFalse(posix.matches("a\\b"));
		}),
	);

	it.effect("fails typed with PatternTooLong past 64KB", () =>
		Effect.gen(function* () {
			const e = yield* Effect.flip(GlobPattern.compile("a".repeat(65_537)));
			assert.instanceOf(e, GlobPatternError);
			assert.strictEqual(e._tag, "GlobPatternError");
			assert.strictEqual(e.reason, "PatternTooLong");
			assert.strictEqual(e.limit, 65_536);
			assert.strictEqual(e.actual, 65_537);
			assert.isBelow(e.message.length, 250); // the pattern is truncated in the message
		}),
	);

	it.effect("fails typed with ExpansionBudgetExceeded on a brace bomb", () =>
		Effect.gen(function* () {
			const e = yield* Effect.flip(GlobPattern.compile("{a,b}".repeat(17)));
			assert.strictEqual(e.reason, "ExpansionBudgetExceeded");
			assert.strictEqual(e.limit, 100_000);
		}),
	);

	it.effect("fails typed with NestingDepthExceeded on deep comma nesting", () =>
		Effect.gen(function* () {
			const e = yield* Effect.flip(GlobPattern.compile(`${"{".repeat(300)}a,b${"}".repeat(300)}`));
			assert.strictEqual(e.reason, "NestingDepthExceeded");
			assert.strictEqual(e.limit, 256);
		}),
	);

	it.effect("rejects a defaults-rejected pattern typed even under permissive options", () =>
		Effect.gen(function* () {
			// Decision 4: nobrace masks the bomb from the effective engine, but a
			// GlobPattern value must always be defaults-compilable — the same typed
			// error, never a defect.
			const e = yield* Effect.flip(GlobPattern.compile("{a,b}".repeat(17), GlobPatternOptions.make({ nobrace: true })));
			assert.instanceOf(e, GlobPatternError);
			assert.strictEqual(e.reason, "ExpansionBudgetExceeded");
		}),
	);

	it.effect("honours a lowered braceExpandMax typed", () =>
		Effect.gen(function* () {
			const e = yield* Effect.flip(GlobPattern.compile("{a,b}{c,d}", GlobPatternOptions.make({ braceExpandMax: 3 })));
			assert.strictEqual(e.reason, "ExpansionBudgetExceeded");
			assert.strictEqual(e.limit, 3);
		}),
	);
});

describe("GlobPattern metadata", () => {
	it.effect("hasMagic distinguishes wildcards from literals", () =>
		Effect.gen(function* () {
			assert.isTrue((yield* GlobPattern.compile("packages/*")).hasMagic);
			assert.isFalse((yield* GlobPattern.compile("packages/internal")).hasMagic);
			assert.isTrue((yield* GlobPattern.compile("a?b")).hasMagic);
			assert.isFalse((yield* GlobPattern.compile("{a,b}")).hasMagic);
			assert.isTrue((yield* GlobPattern.compile("{a,b}", GlobPatternOptions.make({ magicalBraces: true }))).hasMagic);
		}),
	);

	it.effect("negated reflects leading-bang whole-pattern negation", () =>
		Effect.gen(function* () {
			assert.isTrue((yield* GlobPattern.compile("!packages/*")).negated);
			assert.isFalse((yield* GlobPattern.compile("packages/*")).negated);
			const n = yield* GlobPattern.compile("!packages/*");
			assert.isFalse(n.matches("packages/a"));
			assert.isTrue(n.matches("other/a"));
		}),
	);

	it.effect("enumerationPrefix is the leading literal directory run", () =>
		Effect.gen(function* () {
			assert.strictEqual((yield* GlobPattern.compile("packages/*")).enumerationPrefix, "packages/");
			assert.strictEqual((yield* GlobPattern.compile("pkg-*")).enumerationPrefix, "");
			assert.strictEqual((yield* GlobPattern.compile("a/b/*")).enumerationPrefix, "a/b/");
			assert.strictEqual((yield* GlobPattern.compile("*/x")).enumerationPrefix, "");
			assert.strictEqual((yield* GlobPattern.compile("packages/**")).enumerationPrefix, "packages/");
		}),
	);

	it.effect("enumerationPrefix on an all-literal pattern is every segment", () =>
		Effect.gen(function* () {
			assert.strictEqual((yield* GlobPattern.compile("a/b/c")).enumerationPrefix, "a/b/c/");
		}),
	);

	it.effect("enumerationPrefix strips negation and takes the common run across brace alternatives", () =>
		Effect.gen(function* () {
			assert.strictEqual((yield* GlobPattern.compile("!packages/*")).enumerationPrefix, "packages/");
			assert.strictEqual((yield* GlobPattern.compile("a/{b,c}/*")).enumerationPrefix, "a/");
			assert.strictEqual((yield* GlobPattern.compile("{a/x,a/y}/*")).enumerationPrefix, "a/");
		}),
	);

	it.effect("enumerationRoots keeps one root per brace alternative, each with its own depth", () =>
		Effect.gen(function* () {
			const roots = (source: string) => GlobPattern.compileResult(source).pipe(Result.getOrThrow).enumerationRoots;
			// A file-name alternative contributes its directory, read one level.
			assert.deepStrictEqual(roots("src/{a,b}.ts"), [{ prefix: "src/", deep: false, spellings: ["src/"] }]);
			assert.deepStrictEqual(roots("packages/{a,b}/src/*.ts"), [
				{ prefix: "packages/a/src/", deep: false, spellings: ["packages/a/src/"] },
				{ prefix: "packages/b/src/", deep: false, spellings: ["packages/b/src/"] },
			]);
			assert.deepStrictEqual(roots("{packages/a/src/x,packages/b/src/y}.ts"), [
				{ prefix: "packages/a/src/", deep: false, spellings: ["packages/a/src/"] },
				{ prefix: "packages/b/src/", deep: false, spellings: ["packages/b/src/"] },
			]);
			// Depth is per alternative.
			assert.deepStrictEqual(roots("{a/**,b/*}"), [
				{ prefix: "a/", deep: true, spellings: ["a/"] },
				{ prefix: "b/", deep: false, spellings: ["b/"] },
			]);
			// A root inside a deep root is already read by it.
			assert.deepStrictEqual(roots("{a/**,a/b/*.ts}"), [{ prefix: "a/", deep: true, spellings: ["a/", "a/b/"] }]);
			assert.deepStrictEqual(roots("{a/**,a/b/*.ts,c/*}"), [
				{ prefix: "a/", deep: true, spellings: ["a/", "a/b/"] },
				{ prefix: "c/", deep: false, spellings: ["c/"] },
			]);
			// A magic first segment roots at the base; one non-brace pattern is one root.
			assert.deepStrictEqual(roots("*/x"), [{ prefix: "", deep: true, spellings: [""] }]);
			assert.deepStrictEqual(roots("a/b/*"), [{ prefix: "a/b/", deep: false, spellings: ["a/b/"] }]);
			assert.deepStrictEqual(roots("**/*.ts"), [{ prefix: "", deep: true, spellings: [""] }]);
		}),
	);

	it.effect("a numeric range of 100 or more values is one magic portion, as minimatch 11 keeps it", () =>
		Effect.gen(function* () {
			const g = yield* GlobPattern.compile("logs/{0..199}/out.txt");
			assert.isTrue(g.hasMagic);
			assert.strictEqual(g.enumerationPrefix, "logs/");
			assert.isTrue(g.crossesSegments);
			assert.deepStrictEqual(g.enumerationRoots, [{ prefix: "logs/", deep: true, spellings: ["logs/"] }]);
			assert.isTrue(g.matches("logs/150/out.txt"));
			// a smaller range is expanded, so its alternatives are literal
			const small = yield* GlobPattern.compile("logs/{0..98}/out.txt");
			assert.isFalse(small.hasMagic);
			assert.lengthOf(small.enumerationRoots, 99);
		}),
	);

	it.effect("enumerationRoots prefixes are canonical, and a root keeps every spelling it covers", () =>
		Effect.gen(function* () {
			const roots = (source: string) => GlobPattern.compileResult(source).pipe(Result.getOrThrow).enumerationRoots;
			// A leading or inner `.` is no directory of its own: `./` roots at the base.
			assert.deepStrictEqual(roots("./*.ts"), [{ prefix: "", deep: false, spellings: ["./"] }]);
			assert.deepStrictEqual(roots("./**/*.ts"), [{ prefix: "", deep: true, spellings: ["./"] }]);
			assert.deepStrictEqual(roots("src/./a/*.ts"), [{ prefix: "src/a/", deep: false, spellings: ["src/./a/"] }]);
			// Two spellings of one directory are one root.
			assert.deepStrictEqual(roots("{src,./src}/*.ts"), [
				{ prefix: "src/", deep: false, spellings: ["src/", "./src/"] },
			]);
			// A root inside a deep one is absorbed by its canonical form, spellings and all.
			assert.deepStrictEqual(roots("{.,src}/**"), [{ prefix: "", deep: true, spellings: ["./", "src/"] }]);
			assert.deepStrictEqual(roots("{./a,a}/**/*.ts"), [{ prefix: "a/", deep: true, spellings: ["./a/", "a/"] }]);
			// Spellings come in pattern order, an absorbed alternative's included.
			assert.deepStrictEqual(roots("{src/*.ts,**/*.md}"), [{ prefix: "", deep: true, spellings: ["src/", ""] }]);
			assert.deepStrictEqual(roots("{a,./a}/**"), [{ prefix: "a/", deep: true, spellings: ["a/", "./a/"] }]);
			// A climb keeps its `..`, so a walker can refuse it; `./..` is the same climb.
			assert.deepStrictEqual(roots("./../x/*.ts"), [{ prefix: "../x/", deep: false, spellings: ["./../x/"] }]);
		}),
	);

	it.effect("enumerationRoots: a climbing alternative is never absorbed into the base's deep root", () =>
		Effect.gen(function* () {
			const roots = (source: string) => GlobPattern.compileResult(source).pipe(Result.getOrThrow).enumerationRoots;
			// `../x/` lies outside the base, not inside it: it stays its own root, which a walker refuses,
			// rather than lending its spelling to the base's walk.
			assert.deepStrictEqual(roots("{**/*.md,../x/*.ts}"), [
				{ prefix: "", deep: true, spellings: [""] },
				{ prefix: "../x/", deep: false, spellings: ["../x/"] },
			]);
			assert.deepStrictEqual(roots("{../x/*.ts,**/*.ts}"), [
				{ prefix: "../x/", deep: false, spellings: ["../x/"] },
				{ prefix: "", deep: true, spellings: [""] },
			]);
			// The same climb spelled through an inner `..` (the engine folds `src/..` away).
			assert.deepStrictEqual(roots("{./**/*.ts,src/../../x/*.ts}"), [
				{ prefix: "", deep: true, spellings: ["./"] },
				{ prefix: "../x/", deep: false, spellings: ["../x/"] },
			]);
			// A deep climbing root still absorbs a climb inside it.
			assert.deepStrictEqual(roots("{../**/*.ts,../x/*.ts}"), [
				{ prefix: "../", deep: true, spellings: ["../", "../x/"] },
			]);
		}),
	);

	it.effect("enumerationRoots: one prefix reached shallow and deep is deep, in either order", () =>
		Effect.gen(function* () {
			const roots = (source: string) => GlobPattern.compileResult(source).pipe(Result.getOrThrow).enumerationRoots;
			assert.deepStrictEqual(roots("{src/**/*.md,src/*.ts}"), [{ prefix: "src/", deep: true, spellings: ["src/"] }]);
			assert.deepStrictEqual(roots("{src/*.ts,src/**/*.md}"), [{ prefix: "src/", deep: true, spellings: ["src/"] }]);
			assert.deepStrictEqual(roots("{./src/**/*.md,src/*.ts}"), [
				{ prefix: "src/", deep: true, spellings: ["./src/", "src/"] },
			]);
		}),
	);

	it.effect("crossesSegments is true iff matching can go deeper than the prefix by more than one level", () =>
		Effect.gen(function* () {
			assert.isTrue((yield* GlobPattern.compile("packages/**")).crossesSegments);
			assert.isFalse((yield* GlobPattern.compile("packages/*")).crossesSegments);
			assert.isTrue((yield* GlobPattern.compile("*/x")).crossesSegments);
			assert.isFalse((yield* GlobPattern.compile("*.js")).crossesSegments);
			assert.isTrue((yield* GlobPattern.compile("packages/*/x")).crossesSegments);
			assert.isFalse(
				(yield* GlobPattern.compile("a/**", GlobPatternOptions.make({ noglobstar: true }))).crossesSegments,
			);
		}),
	);

	it("crossesSegments is measured against the shared enumerationPrefix of a brace set (#1282)", () => {
		const compile = (source: string): GlobPattern => Result.getOrThrow(GlobPattern.compileResult(source));
		// Alternatives with different prefixes share `""`, and their matches lie two or three levels below it.
		for (const [source, deepest] of [
			["{apps,packages}/*", "packages/a"],
			["{a,b/c}/*", "b/c/x"],
			["{x,src}/*", "src/f.js"],
		] as const) {
			const pattern = compile(source);
			assert.strictEqual(pattern.enumerationPrefix, "", source);
			assert.isTrue(pattern.matches(deepest), source);
			assert.isTrue(pattern.crossesSegments, source);
		}
		// An all-literal brace set reaches past the shared prefix too, while one sharing its whole literal run does not.
		assert.isTrue(compile("{a,b}/f.js").crossesSegments);
		assert.isTrue(compile("a/{*,b/c}").crossesSegments);
		assert.isFalse(compile("{a,b}").crossesSegments);
		assert.isFalse(compile("src/{a,b}*").crossesSegments);
		assert.isFalse(compile("{src/*.ts,src/*.js}").crossesSegments);
		assert.strictEqual(compile("{src/*.ts,src/*.js}").enumerationPrefix, "src/");
	});

	it("matchBase: an alternative compiled to one portion matches by basename and is deep from the base", () => {
		const compile = (source: string, matchBase: boolean): GlobPattern =>
			Result.getOrThrow(GlobPattern.compileResult(source, GlobPatternOptions.make({ matchBase })));
		// #1261: `*.js` and `x/../*.js` match `b/d/f/g.js` by basename, so they are deep from `""`.
		for (const source of ["*.js", "x/../*.js", "a.js", "**/**"]) {
			const pattern = compile(source, true);
			assert.isTrue(pattern.matchesByBasename, source);
			assert.isTrue(pattern.matches("b/d/f/g.js") || source === "a.js", source);
			assert.isTrue(pattern.crossesSegments, source);
			assert.strictEqual(pattern.enumerationPrefix, "", source);
			assert.deepStrictEqual(pattern.enumerationRoots, [{ prefix: "", deep: true, spellings: [""] }], source);
		}
		// Control: the same sources without matchBase stay shallow, and the getter is false.
		assert.isFalse(compile("*.js", false).matchesByBasename);
		assert.isFalse(compile("*.js", false).crossesSegments);
		assert.deepStrictEqual(compile("x/../*.js", false).enumerationRoots, [
			{ prefix: "", deep: false, spellings: [""] },
		]);
		// A row of more than one portion is not matched by basename: matchBase changes nothing for it, however the
		// source is spelled (a class, a brace, an extglob, an escape).
		for (const source of [
			"src/*.ts",
			"src/[ab]/*.ts",
			"src/{a,b}*/*.ts",
			"src/@(a|b)/*.ts",
			"a\\*b/c.js",
			"{a,b}/*.js",
		])
			assert.isFalse(compile(source, true).matchesByBasename, source);
		assert.isFalse(compile("src/*.ts", true).crossesSegments);
		assert.strictEqual(compile("src/*.ts", true).enumerationPrefix, "src/");
		// A brace set keeps each alternative apart: only the slash-less one is deep, and it absorbs `src/`.
		assert.deepStrictEqual(compile("{*.js,src/*.ts}", true).enumerationRoots, [
			{ prefix: "", deep: true, spellings: ["", "src/"] },
		]);
		assert.isTrue(compile("{*.js,src/*.ts}", true).matchesByBasename);
		// literalPrefix accounts for it too: a slash-less literal under matchBase also matches `a/src`.
		assert.strictEqual(compile("src", true).literalPrefix, "");
		assert.strictEqual(compile("src", false).literalPrefix, "src");
		// make, decode and FromString compile under default options.
		assert.isFalse(GlobPattern.make({ source: "*.js" }).matchesByBasename);
	});

	it("matchBase: every path a short pattern matches lies inside one of its enumeration roots", () => {
		const alphabet = ["x", "*", "**", ".", "..", "*.js", "f.js", "src", "{x,src}", "[bx]*", "@(f.js|x)", "\\x"];
		const paths = ["a.js", "x", "f.js", "b/c.js", "b/d/e.js", "b/d/f/g.js", "src/x", "src/f.js", "x/x/x/f.js", "x/src"];
		const sources: Array<string> = [];
		for (const a of alphabet) {
			sources.push(a);
			for (const b of alphabet) {
				sources.push(`${a}/${b}`);
				for (const c of alphabet) sources.push(`${a}/${b}/${c}`);
			}
		}
		const escapes: Array<string> = [];
		let checked = 0;
		for (const source of sources) {
			for (const level of [0, 1, 2]) {
				const compiled = GlobPattern.compileResult(
					source,
					GlobPatternOptions.make({ matchBase: true, optimizationLevel: level }),
				);
				if (Result.isFailure(compiled)) continue;
				const pattern = compiled.success;
				const roots = pattern.enumerationRoots;
				// Exactness: when no alternative matches by basename, matchBase changes no answer.
				if (!pattern.matchesByBasename) {
					const plain = Result.getOrThrow(
						GlobPattern.compileResult(source, GlobPatternOptions.make({ optimizationLevel: level })),
					);
					for (const path of paths)
						if (plain.matches(path) !== pattern.matches(path))
							escapes.push(`${source} level=${level} not by basename, yet matchBase changes ${path}`);
				}
				for (const path of paths) {
					if (!pattern.matches(path)) continue;
					checked += 1;
					const inside = (prefix: string, deep: boolean): boolean =>
						path.startsWith(prefix) && (deep || !path.slice(prefix.length).includes("/"));
					if (!roots.some((root) => inside(root.prefix, root.deep)))
						escapes.push(`${source} level=${level} roots ${JSON.stringify(roots)} miss ${path}`);
					// An all-literal multi-portion pattern's prefix names the file itself (an enumerator stats it), so it is not
					// checked against the folded pair. A brace set is (`{x,src}/*` folds to `""` and crosses segments, #1282).
					if (
						(pattern.hasMagic || pattern.crossesSegments) &&
						!inside(pattern.enumerationPrefix, pattern.crossesSegments)
					)
						escapes.push(`${source} level=${level} prefix ${pattern.enumerationPrefix} miss ${path}`);
				}
			}
		}
		assert.isAbove(checked, 1000);
		assert.deepStrictEqual(escapes.slice(0, 10), [], `${escapes.length} matched paths outside the roots`);
	});
});

describe("GlobPattern.alternativeCount", () => {
	it("counts the alternatives a compile matches, without compiling, as minimatch 11.0.5 expands them", () => {
		const count = (source: string, options?: GlobPatternOptions): number =>
			Result.getOrThrow(GlobPattern.alternativeCount(source, options));
		assert.strictEqual(count("packages/{a,b}/{src,lib}/*.ts"), 4);
		assert.strictEqual(count("{a,b}{c,d}{e,f}{g,h}{i,j}"), 32);
		assert.strictEqual(count("{1..99}{a,b}"), 198);
		// a range of 100 or more values is one portion, duplicates count once, a comment or an empty pattern is 0
		assert.strictEqual(count("{0..999}"), 1);
		assert.strictEqual(count("{a,a}"), 1);
		assert.strictEqual(count("#{a,b}"), 0);
		assert.strictEqual(count("#{a,b}", GlobPatternOptions.make({ nocomment: true })), 2);
		assert.strictEqual(count(""), 0);
		assert.strictEqual(count("!{a,b}"), 2);
		assert.strictEqual(count("{a,b}", GlobPatternOptions.make({ nobrace: true })), 1);
		for (const source of ["{a,b}/{c,d}", "a{b,c{d,e}f}g{h,i}", "{x,y}{1..3}{a..c}", "\\{a,b}", "{a},b}"])
			assert.strictEqual(count(source), new Minimatch(source, { platform: "linux" }).globSet.length, source);
	});

	it("is bounded and total: every guard fails typed, and the cap applies before duplicates are dropped", () => {
		const reason = (source: string, options?: GlobPatternOptions): string => {
			const counted = GlobPattern.alternativeCount(source, options);
			return Result.isFailure(counted) ? counted.failure.reason : "counted";
		};
		const capped = GlobPatternOptions.make({ braceExpandMax: 256 });
		assert.strictEqual(reason("{a,b}".repeat(9), capped), "ExpansionBudgetExceeded");
		// 1,024 results before duplicates are dropped, though the distinct count is 1 (the empty string)
		assert.strictEqual(reason("{,}".repeat(10), capped), "ExpansionBudgetExceeded");
		assert.strictEqual(reason("{,}".repeat(10)), "counted");
		assert.strictEqual(reason("{a,b}".repeat(200)), "ExpansionBudgetExceeded");
		assert.strictEqual(reason(`${"{".repeat(300)}a,b${"}".repeat(300)}`), "NestingDepthExceeded");
		assert.strictEqual(reason("a".repeat(70_000)), "PatternTooLong");
		assert.strictEqual(reason(`q/{${"9".repeat(400)}..${"9".repeat(400)}}`, capped), "ExpansionBudgetExceeded");
	});
});

describe("GlobPattern construction and schema", () => {
	it("make succeeds on a compilable pattern and matches lazily", () => {
		const p = GlobPattern.make({ source: "*test*" });
		assert.isTrue(p.matches("vitest"));
		assert.isFalse(p.matches("vite"));
	});

	it("make throws on an uncompilable pattern (wiring defect at construction)", () => {
		assert.throws(() => GlobPattern.make({ source: "{a,b}".repeat(17) }));
		assert.throws(() => GlobPattern.make({ source: "a".repeat(65_537) }));
	});

	it.effect("class decode produces a working instance and encode emits only source", () =>
		Effect.gen(function* () {
			const p = yield* Schema.decodeUnknownEffect(GlobPattern)({ source: "@scope/*" });
			assert.instanceOf(p, GlobPattern);
			assert.isFalse(p.matches("somepkg"));
			assert.isTrue(p.matches("@scope/x"));
			const encoded = yield* Schema.encodeEffect(GlobPattern)(p);
			assert.deepStrictEqual(encoded, { source: "@scope/*" });
		}),
	);

	it.effect("class decode rejects an uncompilable pattern as SchemaError", () =>
		Effect.gen(function* () {
			const e = yield* Effect.flip(Schema.decodeUnknownEffect(GlobPattern)({ source: "{a,b}".repeat(17) }));
			assert.strictEqual(e._tag, "SchemaError");
		}),
	);

	it.effect("FromString decodes a bare string into a working instance and encodes back to source", () =>
		Effect.gen(function* () {
			const p = yield* Schema.decodeUnknownEffect(GlobPattern.FromString)("@scope/*");
			assert.instanceOf(p, GlobPattern);
			assert.isFalse(p.matches("somepkg"));
			assert.strictEqual(yield* Schema.encodeEffect(GlobPattern.FromString)(p), "@scope/*");
		}),
	);

	it.effect("FromString surfaces uncompilable input as SchemaError", () =>
		Effect.gen(function* () {
			const e = yield* Effect.flip(Schema.decodeUnknownEffect(GlobPattern.FromString)("{a,b}".repeat(17)));
			assert.strictEqual(e._tag, "SchemaError");
		}),
	);
});

describe("GlobPatternOptions", () => {
	it("rejects an explicit undefined for an optionalKey field", () => {
		assert.throws(() => GlobPatternOptions.make({ dot: undefined as unknown as boolean }));
	});

	it("rejects an unknown platform", () => {
		assert.throws(() => GlobPatternOptions.make({ platform: "vms" as unknown as "posix" }));
	});

	it("rejects out-of-range or non-integer caps as wiring defects", () => {
		assert.throws(() => GlobPatternOptions.make({ braceExpandMax: 0 }));
		assert.throws(() => GlobPatternOptions.make({ braceExpandMax: 1.5 }));
		assert.throws(() => GlobPatternOptions.make({ braceExpandMax: Number.NaN }));
		assert.throws(() => GlobPatternOptions.make({ braceExpandMax: 100_001 }));
		assert.throws(() => GlobPatternOptions.make({ maxGlobstarRecursion: 0 }));
		assert.throws(() => GlobPatternOptions.make({ maxExtglobRecursion: 0 }));
		assert.throws(() => GlobPatternOptions.make({ optimizationLevel: 3 }));
		assert.throws(() => GlobPatternOptions.make({ optimizationLevel: -1 }));
	});

	it("accepts the full valid surface", () => {
		const o = GlobPatternOptions.make({
			nobrace: true,
			nocomment: true,
			nonegate: true,
			noglobstar: true,
			noext: true,
			dot: true,
			nocase: true,
			nocaseMagicOnly: true,
			magicalBraces: true,
			matchBase: true,
			flipNegate: true,
			partial: true,
			preserveMultipleSlashes: true,
			windowsPathsNoEscape: true,
			windowsNoMagicRoot: true,
			optimizationLevel: 2,
			platform: "win32",
			braceExpandMax: 100_000,
			maxGlobstarRecursion: 200,
			maxExtglobRecursion: 2,
		});
		assert.strictEqual(o.platform, "win32");
		assert.strictEqual(o.braceExpandMax, 100_000);
	});
});

describe("GlobPattern statics", () => {
	it.effect("escape produces a pattern matching exactly the literal", () =>
		Effect.gen(function* () {
			const p = yield* GlobPattern.compile(GlobPattern.escape("has*star"));
			assert.isTrue(p.matches("has*star"));
			assert.isFalse(p.matches("hasXstar"));
		}),
	);

	it("unescape round-trips escape", () => {
		for (const s of ["a*b?", "[x](y)", "plain"]) {
			assert.strictEqual(GlobPattern.unescape(GlobPattern.escape(s)), s);
		}
	});

	it("escape honours windowsPathsNoEscape bracket style", () => {
		assert.strictEqual(GlobPattern.escape("a*b", GlobPatternOptions.make({ windowsPathsNoEscape: true })), "a[*]b");
	});
});

describe("GlobPattern oracle (public seam)", () => {
	// Literal and magic segments are two equal-weight groups (a Union of two
	// Literals unions, not one flat list), so the pattern mix stays balanced
	// between plain paths and paths that exercise the dialect.
	const literalSeg = Schema.Literals(["a", "b", "abc", "x-y", "a.b+c", ".hidden", ""]);
	const magicSeg = Schema.Literals(["*", "?", "**", "*.js", "a*", "+(a|b)", "[abc]", "{a,b}", "!x"]);
	const patternArb = Arbitrary.schema(
		Schema.Array(Schema.Union([literalSeg, magicSeg])).check(Schema.isBetweenLength(1, 4)),
	).pipe(Arbitrary.map((xs) => xs.join("/")));
	const candidateArb = Arbitrary.schema(
		Schema.Array(Schema.Literals(["a", "b", "abc", ".hidden", "x", ""])).check(Schema.isBetweenLength(1, 5)),
	).pipe(Arbitrary.map((xs) => xs.join("/")));

	it.effect.prop(
		"agrees with upstream through compile and matches",
		[patternArb, candidateArb],
		([pattern, candidate]) =>
			Effect.gen(function* () {
				const compiled = yield* Effect.result(GlobPattern.compile(pattern));
				if (compiled._tag === "Failure") return; // guard-tripping input; the engine gate covers those
				assert.strictEqual(
					compiled.success.matches(candidate),
					oracle(candidate, pattern, { platform: "linux" }),
					`${pattern} vs ${candidate}`,
				);
			}),
		{ arbitrary: { runs: 200 } },
	);
});

describe("GlobPattern.compileResult", () => {
	it("compiles synchronously without an Effect runtime", () => {
		const r = GlobPattern.compileResult("packages/*");
		assert.isTrue(Result.isSuccess(r));
		if (!Result.isSuccess(r)) return;
		assert.strictEqual(r.success.source, "packages/*");
		assert.isTrue(r.success.matches("packages/a"));
		assert.isFalse(r.success.matches("packages/a/b"));
	});

	it("is total: a guard trip is a Result failure, never a throw", () => {
		const r = GlobPattern.compileResult("a".repeat(65_537));
		assert.isTrue(Result.isFailure(r));
		if (!Result.isFailure(r)) return;
		assert.instanceOf(r.failure, GlobPatternError);
		assert.strictEqual(r.failure.reason, "PatternTooLong");
	});

	it("carries the same typed error as compile for every guard", () => {
		for (const source of ["a".repeat(65_537), "{a,b}".repeat(17), `${"{".repeat(300)}a,b${"}".repeat(300)}`]) {
			const sync = GlobPattern.compileResult(source);
			const eff = Effect.runSync(Effect.result(GlobPattern.compile(source)));
			assert.isTrue(Result.isFailure(sync));
			assert.isTrue(Result.isFailure(eff));
			if (!Result.isFailure(sync) || !Result.isFailure(eff)) continue;
			assert.strictEqual(sync.failure.reason, eff.failure.reason);
			assert.strictEqual(sync.failure.limit, eff.failure.limit);
			assert.strictEqual(sync.failure.actual, eff.failure.actual);
		}
	});

	// The consumer's dotfile-semantics divergence: one package compiled the same
	// shape of pattern with `dot: true` at one call site and defaults at another,
	// giving two glob semantics inside one package. Both spellings must agree
	// exactly, so the sync form is never the reason the semantics drift.
	it("honours options identically to compile: the dot divergence", () => {
		const withDot = GlobPattern.compileResult("*", GlobPatternOptions.make({ dot: true }));
		const withDefaults = GlobPattern.compileResult("*");
		assert.isTrue(Result.isSuccess(withDot));
		assert.isTrue(Result.isSuccess(withDefaults));
		if (!Result.isSuccess(withDot) || !Result.isSuccess(withDefaults)) return;
		assert.isTrue(withDot.success.matches(".hidden"));
		assert.isFalse(withDefaults.success.matches(".hidden"));

		const effDot = Effect.runSync(GlobPattern.compile("*", GlobPatternOptions.make({ dot: true })));
		const effDefaults = Effect.runSync(GlobPattern.compile("*"));
		assert.strictEqual(withDot.success.matches(".hidden"), effDot.matches(".hidden"));
		assert.strictEqual(withDefaults.success.matches(".hidden"), effDefaults.matches(".hidden"));
	});

	it("agrees with compile on the enumerator getters", () => {
		const sync = GlobPattern.compileResult("packages/**/*.ts");
		const eff = Effect.runSync(GlobPattern.compile("packages/**/*.ts"));
		assert.isTrue(Result.isSuccess(sync));
		if (!Result.isSuccess(sync)) return;
		assert.strictEqual(sync.success.enumerationPrefix, eff.enumerationPrefix);
		assert.strictEqual(sync.success.crossesSegments, eff.crossesSegments);
		assert.strictEqual(sync.success.hasMagic, eff.hasMagic);
		assert.strictEqual(sync.success.negated, eff.negated);
	});

	it("still rejects a defaults-uncompilable pattern under permissive options", () => {
		const r = GlobPattern.compileResult("{a,b}".repeat(17), GlobPatternOptions.make({ nobrace: true }));
		assert.isTrue(Result.isFailure(r));
	});
});

describe("GlobPattern extglobBang (#1172)", () => {
	const on = GlobPatternOptions.make({ extglobBang: true });
	const check = (source: string, candidate: string, options?: GlobPatternOptions): boolean =>
		Result.getOrThrow(GlobPattern.compileResult(source, options)).matches(candidate);

	it("reads a leading !( as an extglob when on", () => {
		assert.isFalse(check("!(src)/**", "src/x.ts", on));
		assert.isTrue(check("!(src)/**", "lib/x.ts", on));
		assert.isFalse(check("!(a)", "a", on));
		assert.isTrue(check("!(a)", "b", on));
		assert.isTrue(check("!(a)", "(a)", on));
	});

	it("still negates a plain !a, and !!(a) negates once then extglobs", () => {
		assert.isFalse(check("!a", "a", on));
		assert.isTrue(check("!a", "b", on));
		assert.isTrue(check("!!(a)", "a", on));
		assert.isTrue(Result.getOrThrow(GlobPattern.compileResult("!a", on)).negated);
		assert.isFalse(Result.getOrThrow(GlobPattern.compileResult("!(a)", on)).negated);
	});

	it("is off by default and under noext", () => {
		assert.isTrue(check("!(src)/**", "src/x.ts"));
		assert.isFalse(check("!(a)", "(a)"));
		assert.isTrue(check("!(a)", "a", GlobPatternOptions.make({ extglobBang: false })));
		assert.isTrue(check("!(a)", "a", GlobPatternOptions.make({ extglobBang: true, noext: true })));
	});

	it("keeps (? group openers as negation", () => {
		for (const source of ["!(?:a)", "!(?=a)", "!(?<a)", "!(?!a)"]) {
			assert.isTrue(Result.getOrThrow(GlobPattern.compileResult(source, on)).negated, source);
		}
	});

	it("!!!(a): two bangs cancel, then the extglob", () => {
		const p = Result.getOrThrow(GlobPattern.compileResult("!!!(a)", on));
		assert.isFalse(p.negated);
		assert.isFalse(p.matches("a"));
		assert.isTrue(p.matches("b"));
	});
});

describe("GlobPattern.literalPrefix (#1200)", () => {
	const table: ReadonlyArray<readonly [string, string]> = [
		["src/lib/**/*.ts", "src/lib"],
		["*.ts", ""],
		["**", ""],
		["", ""],
		["src/{a,b}/*.ts", "src"],
		["{a,b}/c", ""],
		["src/a.ts", "src/a.ts"],
		["src", "src"],
		["src/", "src"],
		["./src/**", "./src"],
		["../x/*.ts", "../x"],
		["/abs/*.ts", "/abs"],
		["/*.ts", "/"],
		["a\\*b/c/*", "a*b/c"],
		["a\\{b/*", "a{b"],
		["src/+(a)/x", "src"],
		["src/[ab]/x", "src"],
		["src/a?/x", "src"],
		["!src/**/*.ts", "src"],
		["#comment", ""],
		["a//b/*", "a/b"],
	];
	for (const [source, expected] of table) {
		it(`${JSON.stringify(source)} -> ${JSON.stringify(expected)}`, () => {
			assert.strictEqual(Result.getOrThrow(GlobPattern.compileResult(source)).literalPrefix, expected);
		});
	}

	it("is the same under options that reach the per-segment check", () => {
		const prefix = (source: string, options: Record<string, boolean>): string =>
			Result.getOrThrow(GlobPattern.compileResult(source, GlobPatternOptions.make(options))).literalPrefix;
		assert.strictEqual(prefix("src/lib/**", { nocase: true }), "src/lib");
		assert.strictEqual(prefix("src/a.ts", { nocase: true }), "src/a.ts");
		// Spelling only: case is never folded, so this is no safe walk root on a case-sensitive filesystem.
		assert.strictEqual(prefix("SRC/Lib/**", { nocase: true }), "SRC/Lib");
		const folded = Result.getOrThrow(
			GlobPattern.compileResult("SRC/Lib/**", GlobPatternOptions.make({ nocase: true })),
		);
		assert.isTrue(folded.matches("src/lib/a.ts"));
		assert.strictEqual(folded.enumerationPrefix, "");
		assert.strictEqual(prefix("src/lib/**", { nocaseMagicOnly: true }), "src/lib");
		assert.strictEqual(prefix("src/lib/**/*.ts", { noglobstar: true }), "src/lib");
		assert.strictEqual(prefix("src/lib/*.ts", { matchBase: true }), "src/lib");
		assert.strictEqual(prefix("a//b/*", { preserveMultipleSlashes: true }), "a//b");
		assert.strictEqual(prefix("src/+(a)/x", { noext: true }), "src/+(a)/x");
		assert.strictEqual(prefix("src/a/*.ts", { dot: true }), "src/a");
		assert.strictEqual(prefix("a\\b/*", { windowsPathsNoEscape: true }), "a/b");
	});

	it("treats a brace as literal under nobrace", () => {
		const p = Result.getOrThrow(GlobPattern.compileResult("src/{a,b}/x", GlobPatternOptions.make({ nobrace: true })));
		assert.strictEqual(p.literalPrefix, "src/{a,b}/x");
	});
});
