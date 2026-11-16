import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";

/**
 * The tree-shaking invariant, as a test rather than a promise.
 *
 * @remarks
 * The package this replaces put octokit, `@octokit/auth-app`'s OAuth arm,
 * CycloneDX and Sigstore behind one entry point, and the cost was real and
 * measured: one consumer whose only GitHub dependency was that package shipped
 * an eleven-line bundler ignore list for XML libraries it never invoked. The
 * failure was invisible until somebody measured a bundle.
 *
 * So the claim "a token-only consumer cannot reach the GitHub App JWT signer" is
 * checked here, structurally, by walking the **runtime** import graph of `src`.
 * `import type` is skipped because it is erased — which is also what makes the
 * generous use of `@octokit/types` free, and that is asserted too.
 *
 * What this does not prove is that a downstream bundler drops the unreferenced
 * module; that rests on `"sideEffects": false` (asserted below) plus the
 * module-per-file output the builder emits. What it does prove is the part we
 * control: no edge exists.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Every `from "..."` specifier in a module, ignoring type-only imports. */
const runtimeSpecifiers = (source: string): ReadonlyArray<string> => {
	const specifiers: Array<string> = [];
	// Doc comments carry `@example` blocks with real import statements in them.
	// Stripping comments first is what stops this walker from "finding" an edge
	// that only exists in prose — which it did, on the first run.
	//
	// LINE comments must go FIRST, and the ordering is load-bearing rather than
	// stylistic. Prose containing a `/*`-bearing token — a glob like `src/*`, or
	// a scope like `@octokit/*` — opens a block comment as far as a regex is
	// concerned. Stripping blocks first therefore deletes everything from that
	// word to the end of the NEXT doc comment, imports included, and reports a
	// module as importing less than it does. That fails SILENTLY in the
	// permissive direction, which for a confinement test means passing for the
	// wrong reason. Blocks cannot nest, so once the fake openers are gone a real
	// `/*` inside a real block comment is harmless.
	const code = source.replace(/(^|\n)\s*\/\/.*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
	const pattern = /(?:^|\n)\s*(?:import|export)\b([^;]*?)\bfrom\s*["']([^"']+)["']/g;
	for (const match of code.matchAll(pattern)) {
		const clause = match[1] ?? "";
		const specifier = match[2];
		if (specifier === undefined) continue;
		// `import type { X } from "y"` and `export type { X } from "y"` are erased.
		if (/^\s*type\b/.test(clause)) continue;
		specifiers.push(specifier);
	}
	return specifiers;
};

/** Every `src` file reachable at runtime from `entry`, `entry` included. */
const walk = (entry: string): ReadonlySet<string> => {
	const seen = new Set<string>();
	const queue = [resolve(SRC, entry)];
	while (queue.length > 0) {
		const file = queue.pop();
		if (file === undefined || seen.has(file)) continue;
		seen.add(file);
		for (const specifier of runtimeSpecifiers(readFileSync(file, "utf8"))) {
			if (specifier.startsWith(".")) queue.push(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
		}
	}
	return seen;
};

/** Every bare (non-relative) specifier reachable at runtime from `entry`. */
const reachableBareImports = (entry: string): ReadonlySet<string> => {
	const bare = new Set<string>();
	for (const file of walk(entry)) {
		for (const specifier of runtimeSpecifiers(readFileSync(file, "utf8"))) {
			if (!specifier.startsWith(".")) bare.add(specifier);
		}
	}
	return bare;
};

const SIGNER = "@effected/jwt";
// The in-house sealed-box primitives (copied `@noble` code) and the module that composes them.
const SEALED_BOX = ["crypto", "blake2b", "x25519", "xsalsa20poly1305"].map((name) => join("internal", `${name}.ts`));
const reachesSealedBox = (entry: string): ReadonlyArray<string> => {
	const files = [...walk(entry)].map((file) => file.slice(SRC.length + 1));
	return SEALED_BOX.filter((module) => files.includes(module));
};

describe("bundle reachability", () => {
	it("the walker does not lose imports after a /*-bearing token in prose", () => {
		// The discriminating case for the comment stripper, and the reason LINE
		// comments are removed first. `@octokit/*` in a doc comment opens a
		// phantom block comment; stripping blocks first ran that phantom to the
		// close of the NEXT doc comment and ate every import between. The walker
		// then reported FEWER edges than exist — and every assertion in this file
		// is of the form "does not reach", so a lost edge is a false PASS.
		// The token must sit in a LINE comment: inside a block comment a `/*` is
		// swallowed by its own comment and is harmless, so a fixture built that
		// way passes with or without the fix.
		const fixture = [
			"// Prose naming a scope like @octokit/* and a glob like src/* here.",
			'import { Octokit } from "@octokit/core";',
			"/** A real doc comment, whose close is the phantom's close. */",
			'import { sign } from "universal-github-app-jwt";',
			"export const x = [Octokit, sign];",
		].join("\n");
		assert.deepStrictEqual([...runtimeSpecifiers(fixture)], ["@octokit/core", "universal-github-app-jwt"]);
	});

	it("the App module DOES reach the JWT signer", () => {
		// The control. Without it, the assertion below could pass because the
		// walker is broken rather than because the edge is absent.
		assert.isTrue(reachableBareImports("GitHubApp.ts").has(SIGNER));
	});

	it("the secret writer DOES reach the sealed-box primitives", () => {
		// The control for the confinement below: without it that assertion could
		// pass because the walker is broken rather than because the edge is absent.
		assert.deepStrictEqual(reachesSealedBox("RepositorySecret.ts"), SEALED_BOX);
	});

	it("nothing but the secret writer reaches the sealed-box primitives", () => {
		// The X25519, HSalsa20/XSalsa20-Poly1305 and BLAKE2b copies exist for one
		// member: encrypting a secret before PUT. Every other resource service must
		// stay clear of them, or a consumer who never writes a secret still pays for
		// the crypto in their graph.
		//
		// Derived from the directory rather than hardcoded: a NEW module that
		// imports the crypto would otherwise pass this test until someone
		// remembered to add it to a list, which is the failure mode a
		// confinement assertion exists to remove.
		const others = readdirSync(SRC)
			.filter((name) => name.endsWith(".ts") && name !== "index.ts" && name !== "RepositorySecret.ts")
			.sort();
		for (const entry of others) {
			assert.deepStrictEqual(
				reachesSealedBox(entry),
				[],
				`${entry} reaches the sealed box — it has leaked out of RepositorySecret`,
			);
		}
	});

	it("the sealed box reaches no third-party package and no builtin", () => {
		// The primitives are in-house copies; `tweetnacl` and `blakejs` are test
		// oracles. A runtime import of either, or of any `node:` module, would
		// undo the point of copying and tie the module to a runtime.
		const sealedBoxFiles = SEALED_BOX.map((module) => resolve(SRC, module));
		for (const file of sealedBoxFiles) {
			const bare = runtimeSpecifiers(readFileSync(file, "utf8")).filter((specifier) => !specifier.startsWith("."));
			assert.isFalse(
				bare.some((specifier) => /^(tweetnacl|blakejs)$/.test(specifier) || specifier.startsWith("node:")),
				`${file} imports ${bare.join(", ")}`,
			);
		}
		assert.deepStrictEqual(
			[...reachableBareImports("RepositorySecret.ts")].filter((specifier) => /tweetnacl|blakejs/.test(specifier)),
			[],
		);
		const manifest = JSON.parse(readFileSync(resolve(SRC, "..", "package.json"), "utf8")) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		for (const oracle of ["tweetnacl", "blakejs"]) {
			assert.isUndefined(manifest.dependencies?.[oracle], `${oracle} must not be a runtime dependency`);
			assert.isDefined(manifest.devDependencies?.[oracle], `${oracle} is the test oracle`);
		}
	});

	it("a token-only client does NOT reach the JWT signer", () => {
		const reachable = reachableBareImports("GitHubClient.ts");
		assert.isFalse(
			reachable.has(SIGNER),
			`GitHubClient reaches ${SIGNER} — layerFromApp's dependency has leaked into the token path`,
		);
		assert.isTrue(reachable.has("@octokit/core"), "but it does reach the transport it needs");
	});

	it("the Actions OIDC verifier reaches @effected/oidc but not octokit", () => {
		// A service that only verifies runner tokens must not link the REST
		// client. The first assertion is the control: it proves the walker sees
		// this module's edges, so the absence after it is not a broken walker.
		// `@effected/jwt` is reached through `@effected/oidc` (a regular
		// dependency of it); this module names jwt's types only, which erase.
		const reachable = reachableBareImports("ActionsOidc.ts");
		assert.isTrue(reachable.has("@effected/oidc"), "ActionsOidc reaches @effected/oidc");
		assert.isFalse(reachable.has("@octokit/core"), "ActionsOidc reaches @octokit/core");
		assert.deepStrictEqual([...reachable].sort(), ["@effected/oidc", "effect"]);
	});

	it("the installation token store reaches neither the JWT signer nor the App module", () => {
		// A store implementation (KV, a Durable Object, D1) imports this module to
		// implement the seam; it must not drag in the signer to do so. The App
		// module reaching the store is the control: it proves the walker sees the
		// edge between the two, so the absence below is not a broken walker.
		assert.isTrue(
			[...walk("GitHubApp.ts")].some((file) => file.endsWith("InstallationTokenStore.ts")),
			"control: GitHubApp imports the store",
		);
		assert.isFalse(reachableBareImports("InstallationTokenStore.ts").has(SIGNER));
		const reached = walk("InstallationTokenStore.ts");
		assert.isFalse(
			[...reached].some((file) => file.endsWith("GitHubApp.ts")),
			"InstallationTokenStore reaches GitHubApp.ts",
		);
		assert.deepStrictEqual([...reachableBareImports("InstallationTokenStore.ts")].sort(), ["effect"]);
	});

	it("the OAuth user flow reaches neither octokit nor the JWT signer", () => {
		// A Worker that only signs users in imports this module; it must link
		// neither the REST transport nor the App signer. The client module
		// reaching octokit is the control: it proves the walker sees that edge,
		// so its absence here is not a broken walker.
		assert.isTrue(reachableBareImports("GitHubClient.ts").has("@octokit/core"), "control: the client reaches octokit");
		assert.deepStrictEqual(
			[...reachableBareImports("GitHubUserAuth.ts")].sort(),
			["@effected/crypto", "effect", "effect/encoding"],
			"GitHubUserAuth.ts",
		);
	});

	it("the octokit type packages are reachable only as types", () => {
		// `@octokit/types` ships no JavaScript at all, and `plugin-paginate-rest`'s
		// generated route map is likewise types. Leaning on them costs zero runtime
		// bytes, which is why this package types every endpoint rather than none.
		const reachable = reachableBareImports("Rest.ts");
		assert.deepStrictEqual([...reachable].sort(), ["effect"]);
	});

	it("the pure classes reach nothing but effect", () => {
		assert.deepStrictEqual([...reachableBareImports("Resilience.ts")].sort(), ["effect"], "Resilience.ts");
		// `@effected/crypto` for `HttpRedaction`, which the kept-cause scrubber
		// builds on; it is pure, with an `effect` peer and nothing else.
		for (const entry of ["GraphQL.ts", "GitHubError.ts"]) {
			assert.deepStrictEqual([...reachableBareImports(entry)].sort(), ["@effected/crypto", "effect"], entry);
		}
	});

	it("the package declares itself side-effect free", () => {
		// The other half of the mechanism: without this a bundler must assume
		// evaluating an unreferenced module matters, and keeps it.
		const manifest = JSON.parse(readFileSync(resolve(SRC, "..", "package.json"), "utf8")) as {
			sideEffects?: unknown;
		};
		assert.strictEqual(manifest.sideEffects, false);
	});

	it("reaches no node: builtin, and a future one fails HERE rather than as a fake missing dependency", () => {
		// Two properties in one assertion. First, this package's source reaches no
		// builtin, which is worth pinning rather than assuming: a `node:` import is
		// the smell the consolidated-core rule warns about, so a new one should be
		// a deliberate edit to this line.
		//
		// Second, the declared-dependency check below now SKIPS builtins. It used
		// to classify any non-relative specifier as a package, so the first builtin
		// to appear anywhere in the reachable graph would have failed that check
		// with "node:x is imported but not declared" — blaming the manifest for a
		// package that did nothing wrong. It had simply never happened, because
		// nothing reachable had imported one. Reported by @spencerbeggs/reposets
		// (2026-08-13) while porting modules that would have.
		const builtins = [...reachableBareImports("index.ts"), ...reachableBareImports("GitHubApp.ts")]
			.filter((specifier) => specifier.startsWith("node:"))
			.sort();
		assert.deepStrictEqual(builtins, []);
	});

	it("names no Node Buffer anywhere in src, so it runs on a Worker without nodejs_compat", () => {
		// `Buffer` is a Node global, not an import, so neither the bare-import
		// walk nor the node: check above can see it. A Worker without the
		// nodejs_compat flag throws a ReferenceError the first time such a line
		// runs, which for CheckRun's byte cap was the first update or complete.
		// The fixture is the positive control: it proves the pattern finds a real
		// use and ignores one that only exists in a comment.
		const usesBuffer = (source: string): boolean =>
			/\bBuffer\b/.test(source.replace(/(^|\n)\s*\/\/.*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, ""));
		assert.isTrue(usesBuffer('const n = Buffer.byteLength(value, "utf8");'), "control: a real use is found");
		assert.isFalse(usesBuffer("/** Unlike Buffer, this is portable. */\n// Buffer\nconst n = 1;"), "prose is not");
		const files = readdirSync(SRC, { recursive: true, encoding: "utf8" })
			.filter((name) => name.endsWith(".ts"))
			.sort();
		assert.isAbove(files.length, 20, "control: the walk sees the source tree, internal/ included");
		assert.include(files, join("internal", "ids.ts"));
		const offenders = files.filter((name) => usesBuffer(readFileSync(resolve(SRC, name), "utf8")));
		assert.deepStrictEqual(offenders, [], "src module(s) that name the Node Buffer global");
	});

	it("every module in src/ is reachable from the entrypoint", () => {
		// The gap this closes: a module can exist, compile, build warning-free and
		// pass its own tests while being importable by nobody, because 18 of this
		// package's 19 test files import `../src/<Module>.js` directly and only one
		// goes through `../src/index.js`. A suite is therefore no evidence at all
		// that an export is reachable.
		//
		// It bit for real: a ported `RepositorySettings` module was never added to
		// the entrypoint, because a `type RepositorySettings` was already exported
		// there and the collision was silent — tsc, the bundler and API Extractor
		// all said nothing, since a valid export with that name existed. Ten green
		// tests, zero warnings, unreachable. Found by @spencerbeggs/reposets,
		// 2026-08-13, only by trying to consume it.
		const modules = readdirSync(SRC)
			.filter((name) => name.endsWith(".ts") && name !== "index.ts")
			.map((name) => name.replace(/\.ts$/, ""))
			.sort();
		const entry = readFileSync(resolve(SRC, "index.ts"), "utf8");
		const unreachable = modules.filter((name) => !entry.includes(`"./${name}.js"`));
		assert.deepStrictEqual(unreachable, [], "module(s) in src/ that the entrypoint never re-exports");
	});

	it("every runtime dependency is declared", () => {
		// A package you import but do not declare is how a peer closure rots; the
		// classifier in GitHubError reads octokit's throwables structurally rather
		// than importing `@octokit/request-error` for exactly this reason.
		const manifest = JSON.parse(readFileSync(resolve(SRC, "..", "package.json"), "utf8")) as {
			dependencies?: Record<string, string>;
			peerDependencies?: Record<string, string>;
		};
		const declared = new Set([
			...Object.keys(manifest.dependencies ?? {}),
			...Object.keys(manifest.peerDependencies ?? {}),
		]);
		const used = new Set([...reachableBareImports("index.ts"), ...reachableBareImports("GitHubApp.ts")]);
		for (const specifier of used) {
			// A `node:` builtin is not a package and can never appear in a manifest.
			// Treating one as a package failed this check for a package that did
			// nothing wrong; it had simply never happened, because nothing in the
			// reachable graph had imported a builtin yet. Reported by
			// @spencerbeggs/reposets (2026-08-13) while porting modules that would.
			if (specifier.startsWith("node:")) continue;
			const packageName = specifier.startsWith("@")
				? specifier.split("/").slice(0, 2).join("/")
				: specifier.split("/")[0];
			assert.isTrue(declared.has(packageName ?? specifier), `${specifier} is imported but not declared`);
		}
	});
});
