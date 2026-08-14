/**
 * Reset the scratchpad working areas to their seeded state.
 *
 * Deletes probes/ contents and __test__/*.test.ts, then reseeds from
 * lib/templates/. Committed files are outside the blast radius by
 * construction. Never runs git.
 *
 * Run from the repo root: pnpm scratchpad:reset
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scratchpadRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const probesDir = join(scratchpadRoot, "probes");
const testDir = join(scratchpadRoot, "__test__");
const templatesDir = join(scratchpadRoot, "lib", "templates");

const deleted: Array<string> = [];

mkdirSync(probesDir, { recursive: true });
for (const entry of readdirSync(probesDir)) {
	rmSync(join(probesDir, entry), { recursive: true });
	deleted.push(join("probes", entry));
}
for (const entry of readdirSync(testDir)) {
	if (entry.endsWith(".test.ts")) {
		rmSync(join(testDir, entry));
		deleted.push(join("__test__", entry));
	}
}

copyFileSync(join(templatesDir, "probe.ts"), join(probesDir, "probe.ts"));
copyFileSync(join(templatesDir, "artifact-probe.ts"), join(probesDir, "artifact-probe.ts"));
copyFileSync(join(templatesDir, "probe.test.ts"), join(testDir, "probe.test.ts"));

for (const path of deleted) {
	console.log(`deleted scratchpad/${path}`);
}
console.log("reseeded: probes/probe.ts, probes/artifact-probe.ts, __test__/probe.test.ts");
