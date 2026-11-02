#!/usr/bin/env node
// Rewrite every `configDependencies` pin in pnpm-workspace.yaml to the latest
// published version, as a plain `1.2.3`, and apply the renames the upgrade
// ledger declares (a config dependency republished under a new name).
//
// Usage: node bump-config-deps.mjs [path/to/pnpm-workspace.yaml] [--dry-run] [--ledger <dir>]
//
// pnpm records integrity in the lockfile, so a legacy `<version>+sha512-…`
// suffix is dropped, even on a pin that is already current. Only the pin lines
// inside the `configDependencies:` block are edited, in place; every other byte
// of the file is left alone. Prints one line per dependency:
// `<name> <old> -> <new>`, `<old-name> <old> -> <new-name> <new> (renamed)`,
// `<name> <version> (integrity dropped)` or `<name> <version> (current)`.
//
// Exit codes: 0 done, 1 a `pnpm view` failed (nothing written), 2 the file has
// no configDependencies block. Uses `pnpm view`, never `npm view`: npm enforces
// `devEngines.packageManager` and fails in a pnpm repository.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "./applicable.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const ledgerAt = args.indexOf("--ledger");
const ledgerDir =
	ledgerAt === -1
		? resolve(dirname(fileURLToPath(import.meta.url)), "../references/ledger")
		: resolve(args[ledgerAt + 1] ?? "");
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--ledger") ?? "pnpm-workspace.yaml";

/**
 * Every `renames` pair the ledger declares: the ones `BASELINE.md` carries
 * forward from earlier rounds, then the current round's entries.
 */
function ledgerRenames(dir) {
	const renames = new Map();
	if (!existsSync(dir)) return renames;
	const entries = readdirSync(dir)
		.filter((name) => /^\d{4}-.*\.md$/.test(name))
		.sort();
	for (const name of ["BASELINE.md", ...entries]) {
		if (!existsSync(join(dir, name))) continue;
		const parsed = parseFrontmatter(readFileSync(join(dir, name), "utf8"));
		for (const [from, to] of Object.entries(parsed?.data.renames ?? {})) renames.set(from, to);
	}
	return renames;
}

function latest(name) {
	try {
		const version = JSON.parse(
			execFileSync("pnpm", ["view", `${name}@latest`, "version", "--json"], { encoding: "utf8" }),
		);
		if (typeof version !== "string" || version === "") throw new Error("no version returned");
		return version;
	} catch (err) {
		process.stderr.write(`bump-config-deps: pnpm view ${name} failed: ${err.message}\n`);
		process.exit(1);
	}
}

const lines = readFileSync(file, "utf8").split("\n");
const start = lines.findIndex((l) => /^configDependencies:\s*$/.test(l));
if (start === -1) {
	process.stderr.write(`bump-config-deps: no configDependencies block in ${file}; nothing to bump\n`);
	process.exit(2);
}

const renames = ledgerRenames(ledgerDir);
// `  "@scope/name": 1.2.3` or a legacy `1.2.3+sha512-…`, quotes optional
const PIN = /^(\s+)(["']?)([^"':\s]+)\2:\s*([^\s#]+)(.*)$/;
const updates = [];
for (let i = start + 1; i < lines.length; i++) {
	const line = lines[i];
	if (/^\S/.test(line)) break; // the next top-level key ends the block
	const m = PIN.exec(line);
	if (!m) continue;
	const [, indent, quote, name, pin, rest] = m;
	const current = pin.split("+")[0];
	const target = renames.get(name) ?? name;
	const version = latest(target);
	if (target === name && version === pin) {
		process.stdout.write(`${name} ${current} (current)\n`);
		continue;
	}
	const q = quote || (target.startsWith("@") ? '"' : "");
	updates.push([i, `${indent}${q}${target}${q}: ${version}${rest}`]);
	if (target !== name) process.stdout.write(`${name} ${current} -> ${target} ${version} (renamed)\n`);
	else if (version === current) process.stdout.write(`${name} ${current} (integrity dropped)\n`);
	else process.stdout.write(`${name} ${current} -> ${version}\n`);
}

if (updates.length > 0 && !dryRun) {
	for (const [i, line] of updates) lines[i] = line;
	writeFileSync(file, lines.join("\n"));
}
