import { build } from "@savvy-web/bundler";

await build({
	// ./node names the root's types through the package's own name; keep that import external in the declarations so
	// node.d.ts refers to the root's JournalWatcher instead of carrying a copy.
	dtsExternals: ["@effected/jsonl"],
	meta: {
		localPaths: ["../../website/lib/models/jsonl"],
		tsdoc: {
			// The narrow, house-standard suppression for the anonymous heritage
			// types Effect's class factories synthesize (Schema.Class,
			// TaggedClass, TaggedError, Context.Service). The emitted .d.ts
			// names each base as a module-local `declare const X_base` whose full
			// shape is inlined into the exported class, so it is genuinely
			// un-nameable and un-needed by consumers. Scoped to `_base` ONLY —
			// never widen it: an internal type named on a public signature is a
			// different symbol and stays un-masked.
			suppressWarnings: [
				{ messageId: "ae-forgotten-export", pattern: "_base" },
				// API Extractor follows ./node's self-referencing "@effected/jsonl" import back into the root's source and
				// reports every root type as forgotten from node.d.ts. Scoped to that one entry: the root entry keeps the
				// full check, and node.ts exports its one class and names nothing of its own on a public signature.
				{ messageId: "ae-forgotten-export", pattern: "entry point node\\.d\\.ts$" },
			],
		},
	},
});
