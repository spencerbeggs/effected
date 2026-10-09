import { build } from "@savvy-web/bundler";

await build({
	// ./testing names the root's types through the package's own name; keep that import external in the declarations so
	// testing.d.ts refers to the root's types instead of carrying a copy.
	dtsExternals: ["@effected/jwt"],
	meta: {
		localPaths: ["../../website/lib/models/jwt"],
		tsdoc: {
			// The narrow, house-standard suppression for the anonymous heritage types Effect's class factories synthesize
			// (Schema.Class, TaggedError, Context.Service). Scoped to `_base` ONLY — never widen it.
			suppressWarnings: [
				{ messageId: "ae-forgotten-export", pattern: "_base" },
				// ./testing names root types through the type-only `import type * as Root from "@effected/jwt"` self-reference.
				// API Extractor follows it back into the root's source and reports `Root` itself plus the sixteen root symbols
				// TestIssuer's signatures reach, transitively, as forgotten from testing.d.ts. Every one of them is exported by
				// the root entry point. This matches those seventeen names, and only for testing.d.ts, so a genuinely forgotten
				// export from either entry point still fails the build. The root symbols come from the self-reference pass with
				// no file or line.
				{
					messageId: "ae-forgotten-export",
					pattern:
						'The symbol "(Root|CachedJwks|DecodedJws|JoseHeader|Jwk|Jwks|JwksResolver|JwksResolverOptions|JwksResolverShape|JwksStore|JwksStoreShape|JwtAlgorithm|JwtError|JwtErrorReason|SigningKey|VerificationKey|VerifyOptions)" needs to be exported by the entry point testing\\.d\\.ts',
				},
			],
		},
	},
});
