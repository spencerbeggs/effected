// Preloaded with `node --import`: appends every module the process resolves, through `import` and `require` alike, to
// the file `RESOLVED_LOG` names. Writes the line before the process can exit, synchronously.
// tsx because the built entry's siblings resolve to their source through the workspace links.
import "tsx";
import { appendFileSync } from "node:fs";
import { registerHooks } from "node:module";

const log = process.env.RESOLVED_LOG;
registerHooks({
	resolve(specifier, context, nextResolve) {
		const resolved = nextResolve(specifier, context);
		appendFileSync(log, `${resolved.url}\n`);
		return resolved;
	},
});
