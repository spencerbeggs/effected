#!/usr/bin/env node
// List outdated dependencies that are pinned DIRECTLY in a manifest -- i.e.
// NOT via `catalog:` (those move when the config dependency supplying the
// catalog is bumped) and NOT `workspace:`. Wraps `pnpm outdated -r --json`
// and checks each dependent's own package.json specifier.
//
// Usage: node outdated-direct.mjs            (run from the workspace root)
//
// Prints `<name> <current> -> <latest>  [<type>] in <pkg> (<specifier>)`,
// one line per (package, dependent). Prints nothing when all are current.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const run = (argv) => {
	try {
		return execFileSync("pnpm", argv, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
	} catch (err) {
		// `pnpm outdated` exits 1 when anything is outdated; stdout is still the report.
		return err.stdout ?? "";
	}
};

const outdated = JSON.parse(run(["outdated", "-r", "--json"]) || "{}");
const projects = JSON.parse(run(["ls", "-r", "--depth", "-1", "--json"]) || "[]");
const pathOf = new Map(projects.map((p) => [p.name, p.path]));

for (const [name, info] of Object.entries(outdated)) {
	for (const dependent of info.dependentPackages ?? []) {
		const dir = pathOf.get(dependent.name) ?? dependent.location;
		if (!dir) continue;
		const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
		const spec =
			manifest.dependencies?.[name] ??
			manifest.devDependencies?.[name] ??
			manifest.optionalDependencies?.[name] ??
			manifest.peerDependencies?.[name];
		if (!spec || spec.startsWith("catalog:") || spec.startsWith("workspace:")) continue;
		console.log(`${name} ${info.current} -> ${info.latest}  [${info.dependencyType}] in ${dependent.name} (${spec})`);
	}
}
