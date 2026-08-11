import { build } from "@savvy-web/bundler";

await build({
	meta: {
		localPaths: ["../../website/lib/models/templates"],
		tsdoc: {
			// Effect's class factories (Schema.Class, Schema.TaggedError,
			// Context.Service) synthesize an anonymous heritage type that API
			// Extractor reports as a forgotten export on `X_base`. The emitted
			// .d.ts names it as a module-local, non-exported `declare const`
			// whose full shape is inlined into the exported class, so it is
			// genuinely un-nameable and un-needed by a consumer.
			//
			// NEVER widen this: the pattern is scoped to `_base` precisely so a
			// genuinely forgotten export still fails the gate.
			suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
		},
	},
});
