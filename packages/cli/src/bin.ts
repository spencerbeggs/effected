#!/usr/bin/env node
// Linked source needs tsx, and a pnpm script loads it through nodeOptions. A direct run of the bin does not, so it
// registers tsx here, before anything resolves a sibling's source. A built `.js` bin never takes this branch. tsx is
// the workspace root's alone, and the specifier is computed because rolldown inlines a literal, or a const it can fold,
// into the published package.
if (import.meta.url.endsWith(".ts")) {
	const tsx = ["tsx", "esm", "api"].join("/");
	const { register } = (await import(tsx)) as { readonly register: () => void };
	register();
}

const { main } = await import("./main.js");

main();
