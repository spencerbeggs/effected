// The Azure confinement invariant, as a test rather than a promise.
//
// `@azure/storage-blob` is the only heavy dependency this package has, and the
// requirement is structural: a consumer that imports only `ActionOutputs` — a
// module that writes `::set-output::` to a file — must be unable to link a blob
// storage client. Three modules may import it (`ActionCache`, `Artifact` and
// `BlobStore.githubCache`, because the Actions-cache Twirp protocol hands back
// an Azure url), and nothing else may.
//
// So the claim is checked by walking the RUNTIME import graph of `src`. `import
// type` is skipped because it is erased. What this does not prove is that a
// downstream bundler drops an unreferenced module; that rests on
// `"sideEffects": false` (asserted below) plus the module-per-file output the
// builder emits. What it does prove is the part we control: no edge exists.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Every `from "..."` specifier in a module, ignoring type-only imports. */
const runtimeSpecifiers = (source: string): ReadonlyArray<string> => {
	// Doc comments carry `@example` blocks with real import statements in them,
	// so comments come out first or the walker "finds" edges that exist only in
	// prose.
	//
	// LINE comments must go FIRST, and the ordering is load-bearing rather than
	// stylistic: prose containing a token like `@azure/*` opens a block comment
	// as far as a regex is concerned, so stripping blocks first deletes
	// everything from that word to the end of the next doc comment — imports
	// included — and reports a module that imports Azure as importing nothing.
	// It fails SILENTLY in the safe direction, which for a confinement test is
	// the worst direction there is.
	const code = source.replace(/(^|\n)\s*\/\/.*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
	const pattern = /(?:^|\n)\s*(?:import|export)\b([^;]*?)\bfrom\s*["']([^"']+)["']/g;
	const specifiers: Array<string> = [];
	for (const match of code.matchAll(pattern)) {
		const clause = match[1] ?? "";
		const specifier = match[2];
		if (specifier === undefined) continue;
		if (/^\s*type\b/.test(clause)) continue;
		specifiers.push(specifier);
	}
	return specifiers;
};

/** Every bare (non-relative) specifier reachable at runtime from `entry`. */
const reachableBareImports = (entry: string): ReadonlySet<string> => {
	const seen = new Set<string>();
	const bare = new Set<string>();
	const queue = [resolve(SRC, entry)];
	while (queue.length > 0) {
		const file = queue.pop();
		if (file === undefined || seen.has(file)) continue;
		seen.add(file);
		for (const specifier of runtimeSpecifiers(readFileSync(file, "utf8"))) {
			if (specifier.startsWith(".")) {
				queue.push(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
			} else {
				bare.add(specifier);
			}
		}
	}
	return bare;
};

const reachesAzure = (entry: string): boolean =>
	[...reachableBareImports(entry)].some((specifier) => specifier.startsWith("@azure/"));

/** The three modules the confinement rule permits, and only these three. */
const AZURE_MODULES = ["ActionCache.ts", "Artifact.ts", "BlobStore.githubCache.ts"];

/** Everything else a consumer can name. */
const LIGHT_MODULES = [
	"ActionEnvironment.ts",
	"ActionInput.ts",
	"ActionLogger.ts",
	"ActionOutputs.ts",
	"ActionState.ts",
	"BlobEnvelope.ts",
	"BlobStore.ts",
	"BlobTransfer.ts",
	"CacheKey.ts",
	"DetachedProcess.ts",
	"DryRun.ts",
	"OidcTokenIssuer.ts",
	"Secret.ts",
	"ToolInstaller.ts",
	"WorkflowCommand.ts",
	"internal/actionsResults.ts",
	"internal/twirp.ts",
	"internal/sigv4.ts",
];

describe("bundle reachability", () => {
	it("the three permitted modules DO reach @azure/storage-blob", () => {
		// The control. Without it every assertion below could pass because the
		// walker is broken rather than because the edge is absent — the classic
		// test that cannot fail.
		for (const entry of AZURE_MODULES) {
			assert.isTrue(reachesAzure(entry), `${entry} does not reach Azure — the walker is blind`);
		}
	});

	it("no other module reaches @azure/storage-blob", () => {
		for (const entry of LIGHT_MODULES) {
			assert.isFalse(reachesAzure(entry), `${entry} reaches @azure/storage-blob — the confinement has leaked`);
		}
	});

	it("the comment stripper removes prose and keeps code", () => {
		// The stripper is load-bearing the moment the scan depends on it, and a
		// blinded scan is a silent false green — so it gets its own discriminating
		// test rather than being trusted.
		const source = [
			'// import { BlockBlobClient } from "@azure/storage-blob";',
			"/**",
			" * A doc comment whose @example imports the client:",
			' * import { BlobClient } from "@azure/storage-blob";',
			" */",
			'import { Effect } from "effect";',
			'export { thing } from "./thing.js";',
		].join("\n");
		assert.deepStrictEqual([...runtimeSpecifiers(source)], ["effect", "./thing.js"]);
	});

	it("the stripper survives prose that opens a block comment", () => {
		// `@azure/*` in prose is a `/*` to a regex. Stripping blocks BEFORE lines
		// eats the real import that follows and reports nothing at all.
		const source = ["// Confined to @azure/* and nothing else.", 'import { Effect } from "effect";'].join("\n");
		assert.deepStrictEqual([...runtimeSpecifiers(source)], ["effect"]);
	});

	it("the light half reaches only effect and the kit packages it derives from", () => {
		// Exact edge sets, so a stray value import fails here rather than in a
		// consumer's bundle — and so a stripper that blinded the walker shows up as
		// an empty set rather than as a pass.
		assert.deepStrictEqual([...reachableBareImports("ActionOutputs.ts")].sort(), ["effect"]);
		assert.deepStrictEqual([...reachableBareImports("BlobEnvelope.ts")].sort(), ["effect"]);
		// `node:crypto` is the sanctioned import, and it is here because core
		// `Crypto` is RNG-only at beta.101 — no digest, no HMAC.
		assert.deepStrictEqual([...reachableBareImports("CacheKey.ts")].sort(), [
			"@effected/glob",
			"effect",
			"node:crypto",
		]);
		assert.deepStrictEqual([...reachableBareImports("BlobStore.ts")].sort(), [
			"effect",
			"effect/unstable/http",
			"node:crypto",
		]);
		// The workflow-command protocol imports NOTHING — not even `effect`. It is
		// the one piece of this package a non-Actions consumer might legitimately
		// want, and it stays a pure string renderer so it costs nothing to take.
		assert.deepStrictEqual([...reachableBareImports("WorkflowCommand.ts")], []);
	});

	it("no shared internal helper reaches Azure", () => {
		// This is the specific mechanism the rule exists to prevent: the three
		// heavy modules share a Twirp client and a results-backend reader, and
		// hoisting their fifteen lines of Azure into either one would put the
		// client on the graph of everything that speaks the protocol.
		assert.deepStrictEqual([...reachableBareImports("internal/actionsResults.ts")].sort(), ["effect"]);
		assert.deepStrictEqual(
			[...reachableBareImports("internal/twirp.ts")].sort(),
			["effect", "effect/unstable/http"],
			"the Twirp client speaks HTTP and nothing heavier",
		);
	});

	it("the entry point reaches Azure, and that is correct", () => {
		// `src/index.ts` re-exports all three heavy modules, so of course it
		// reaches Azure. Asserting otherwise would be asserting the package does
		// not ship a cache. The property that matters is the one above: every light
		// module is reachable WITHOUT it.
		assert.isTrue(reachesAzure("index.ts"));
	});

	it("no module gathers the heavy three into a namespace object", () => {
		// The single easiest way to destroy this property: one
		// `export const Stores = { cache, artifact, blob }` makes every consumer of
		// any of them reachable to Azure, silently. The entry point re-exports
		// free-standing names, and no light module may import a heavy one.
		// Deliberately RAW source, not the stripped `code` the walker uses, and
		// that is safe in the direction that matters: this is a `notInclude`, so
		// a specifier appearing only in a comment fails the test — a spurious
		// ALARM, never a silent pass. Over-strict is the correct bias for a
		// confinement check.
		//
		// It sees only DIRECT imports, so a two-hop leak (light → mid → heavy)
		// would slip past it. That case is covered by the transitive
		// `assert.isFalse(reachesAzure(entry))` over the same LIGHT_MODULES
		// above — do not delete that test on the assumption this one subsumes it.
		for (const entry of LIGHT_MODULES) {
			const source = readFileSync(resolve(SRC, entry), "utf8");
			for (const heavy of ["./ActionCache.js", "./Artifact.js", "./BlobStore.githubCache.js"]) {
				assert.notInclude(source, heavy, `${entry} imports ${heavy}`);
			}
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

	it("every runtime dependency is declared", () => {
		// A package you import but do not declare is how a peer closure rots.
		const manifest = JSON.parse(readFileSync(resolve(SRC, "..", "package.json"), "utf8")) as {
			dependencies?: Record<string, string>;
			peerDependencies?: Record<string, string>;
		};
		const declared = new Set([
			...Object.keys(manifest.dependencies ?? {}),
			...Object.keys(manifest.peerDependencies ?? {}),
		]);
		for (const specifier of reachableBareImports("index.ts")) {
			if (specifier.startsWith("node:")) continue;
			const packageName = specifier.startsWith("@")
				? specifier.split("/").slice(0, 2).join("/")
				: specifier.split("/")[0];
			assert.isTrue(declared.has(packageName ?? specifier), `${specifier} is imported but not declared`);
		}
	});
});
