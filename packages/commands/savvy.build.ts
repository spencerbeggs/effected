import { build } from "@savvy-web/bundler";

await build({
	meta: {
		localPaths: ["../../website/lib/models/commands"],
		tsdoc: {
			// The narrow, house-standard suppression for the anonymous heritage
			// types Effect's class factories synthesize (Schema.Class,
			// TaggedClass, TaggedErrorClass, Context.Service). The emitted .d.ts
			// names each base as a module-local `declare const X_base` whose full
			// shape is inlined into the exported class, so it is genuinely
			// un-nameable and un-needed by consumers. Scoped to `_base` ONLY —
			// never widen it: an internal type named on a public signature is a
			// different symbol and stays un-masked.
			suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
		},
	},
});
