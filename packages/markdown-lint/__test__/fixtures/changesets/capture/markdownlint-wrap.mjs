// Records every string systems' markdownlint rule tests lint, then delegates.
const real = await import(`${process.env.SYSTEMS}/node_modules/markdownlint/lib/exports-sync.mjs`);

export function lint(options) {
	for (const text of Object.values(options.strings ?? {})) {
		globalThis.__records.push({
			via: "markdownlint",
			text,
			file: globalThis.__currentFile,
			test: globalThis.__currentTest,
		});
	}
	return real.lint(options);
}
