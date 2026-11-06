// A body with enough distinct statements that unminified output keeps them on
// separate lines while a minified bundle collapses to a handful of lines.
const parts: string[] = [];
for (const word of ["default", "minify", "fixture"]) {
	const upper = word.toUpperCase();
	const doubled = `${upper}-${upper}`;
	parts.push(doubled);
}

process.stdout.write(`${parts.join("|")}\n`);
