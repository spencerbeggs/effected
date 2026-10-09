import { build } from "@savvy-web/bundler";

await build({
	// ./cache names the root's types through the package's own name; keep that import external in the declarations so
	// cache.d.ts refers to the root's ImageFacts instead of carrying a copy.
	dtsExternals: ["@effected/images"],
	meta: {
		localPaths: ["../../website/lib/models/images"],
		tsdoc: {
			// The narrow, house-standard suppression for the anonymous heritage types Effect's class factories synthesize
			// (Schema.Class, TaggedError, Context.Service). Scoped to `_base` ONLY — never widen it.
			suppressWarnings: [
				{ messageId: "ae-forgotten-export", pattern: "_base" },
				// ./cache names root types through the type-only `import type * as Images from "@effected/images"` self-reference.
				// API Extractor follows it back into the root's source and reports exactly three symbols as forgotten from
				// cache.d.ts: the `Images` namespace itself and the two root types ImageCache's signatures name, ImageFacts and
				// ImageParseError. All three are exported by the root entry point. This matches those three messages only, not
				// other cache.d.ts entries, so a genuinely forgotten cache export still fails the build. ImageFacts and
				// ImageParseError come from the self-reference pass with no file or line, and once suppressed they are not
				// listed in issues.json's `suppressed` array: narrowing this to `Images` alone turns both into ciFatal warnings.
				{ messageId: "ae-forgotten-export", pattern: 'The symbol "(Images|ImageFacts|ImageParseError)" needs' },
			],
		},
	},
});
