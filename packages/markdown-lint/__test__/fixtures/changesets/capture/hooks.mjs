// Module hooks for the golden capture (see ../README.md): route `vitest` to a
// stub that runs each test body, and wrap the two parse entry points and
// markdownlint's `lint` so every markdown string a systems rule test lints is
// recorded. Imports made by this directory's own modules pass through.
const HERE = new URL("./", import.meta.url).href;

export async function resolve(specifier, context, next) {
	if (specifier === "vitest") return { url: `${HERE}vitest-stub.mjs`, shortCircuit: true };
	const parent = context.parentURL ?? "";
	if (parent.startsWith(HERE)) return next(specifier, context);
	if (specifier === "markdownlint/sync") return { url: `${HERE}markdownlint-wrap.mjs`, shortCircuit: true };
	const resolved = await next(specifier, context);
	if (resolved.url.endsWith("/src/changesets/utils/markdown-emit.ts")) {
		return { url: `${HERE}emit-wrap.mjs?target=${encodeURIComponent(resolved.url)}`, shortCircuit: true };
	}
	return resolved;
}
