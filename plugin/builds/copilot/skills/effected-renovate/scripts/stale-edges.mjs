#!/usr/bin/env node
// Find the kit packages a lockfile resolves at more than one version, the
// edges that pull each stale copy, and the parent-scoped overrides that bridge
// them onto the newest copy.
//
// Usage: node stale-edges.mjs [path/to/pnpm-lock.yaml] [--json]
//
// "Newest" is the highest version of an `@effected/*` package in the
// lockfile's `packages:` section; every lower version is stale. Each snapshot
// or importer whose dependencies name a stale version is an edge, printed as
// `parent@version -> child@version`. Only an edge whose parent is a tool (not
// an `@effected/*` package, not an importer of this repository) becomes an
// override line, `"<parent>><child>": "<newest>"`, ready for the `overrides`
// block of pnpm-workspace.yaml. A kit parent gets no line: when the stale
// child is its peer, it resolved inside the tool's subtree and the tool's
// line covers it; when it is a regular dependency, nothing printed does, so
// inspect it. An importer edge is this repository's own range: raise it instead.
// Each of the lockfile's documents is its own graph and is read separately.
//
// Exit codes: 0 nothing split, 1 the lockfile could not be read, 2 a split was
// found (the report and any override lines are printed), 64 a usage error.
// Dependency-free: it runs from an installed plugin.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions, parseVersion } from "./applicable.mjs";

const KIT = "@effected/";
const USAGE = "usage: node stale-edges.mjs [path/to/pnpm-lock.yaml] [--json]";

const unquote = (s) => s.trim().replace(/^(['"])(.*)\1$/, "$2");

/** Split `name@version(peer)(peer)` into its name and bare version; null when the version is not semver. */
export function parseKey(key) {
	const bare = unquote(key).replace(/\(.*$/, "");
	const at = bare.lastIndexOf("@");
	if (at <= 0) return null;
	const version = bareVersion(bare.slice(at + 1));
	return parseVersion(version) ? { name: bare.slice(0, at), version } : null;
}

/** A resolved version without a named-registry qualifier: `work:0.34.0` is `0.34.0`. */
const bareVersion = (version) => version.replace(/^[A-Za-z][\w-]*:(?=\d)/, "");

/**
 * One document's resolution graph: every package version in `packages:`, and
 * every edge from a snapshot or an importer to a resolved dependency.
 */
function readDocument(lines) {
	const versions = new Map();
	const edges = [];
	let section = null;
	let parent = null;
	let field = null;
	let dep = null;
	const addEdge = (child, raw, kind) => {
		const version = bareVersion(unquote(raw).replace(/\(.*$/, ""));
		if (parent && parseVersion(version)) edges.push({ ...parent, kind, child, version });
	};
	for (const line of lines) {
		if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
		if (/^\S/.test(line)) {
			section = line.replace(/:.*$/, "");
			parent = null;
			continue;
		}
		const top = /^ {2}(\S.*?):(?:\s*\{\})?\s*$/.exec(line);
		if (top) {
			field = null;
			dep = null;
			if (section === "packages") {
				const p = parseKey(top[1]);
				if (p) versions.set(p.name, [...(versions.get(p.name) ?? []), p.version]);
			} else if (section === "snapshots") {
				const p = parseKey(top[1]);
				parent = p ? { parent: p.name, parentVersion: p.version } : null;
			} else if (section === "importers") {
				parent = { parent: unquote(top[1]), parentVersion: null };
			}
			continue;
		}
		const sub = /^ {4}(\S[^:]*):\s*$/.exec(line);
		if (sub) {
			field = sub[1];
			dep = null;
			continue;
		}
		if (/^ {4}\S/.test(line)) {
			field = null;
			continue;
		}
		const isDeps = field === "dependencies" || field === "optionalDependencies" || field === "devDependencies";
		if (!isDeps) continue;
		if (section === "snapshots") {
			const m = /^ {6}(\S.*?):\s+(\S.*)$/.exec(line);
			if (m) addEdge(unquote(m[1]), m[2], "snapshot");
		} else if (section === "importers") {
			const name = /^ {6}(\S.*?):\s*$/.exec(line);
			if (name) {
				dep = unquote(name[1]);
				continue;
			}
			const ver = /^ {8}version:\s*(.+)$/.exec(line);
			if (ver && dep !== null) addEdge(dep, ver[1], "importer");
		}
	}
	return { versions, edges };
}

/** The split kit packages, their stale edges, and the override lines that bridge them. */
export function staleEdges(text) {
	const documents = text
		.split(/^---\s*$/m)
		.map((doc) => readDocument(doc.split(/\r?\n/)))
		.filter((doc) => doc.versions.size > 0);
	const kit = new Set();
	const split = [];
	const edges = [];
	const overrides = {};
	for (const doc of documents) {
		const newest = new Map();
		for (const [name, list] of doc.versions) {
			if (!name.startsWith(KIT)) continue;
			kit.add(name);
			const sorted = [...new Set(list)].sort(compareVersions);
			if (sorted.length < 2) continue;
			const top = sorted.at(-1);
			newest.set(name, { newest: top, stale: new Set(sorted.slice(0, -1)) });
			split.push({ name, newest: top, stale: sorted.slice(0, -1) });
		}
		const seen = new Set();
		for (const edge of doc.edges) {
			const hit = newest.get(edge.child);
			if (!hit?.stale.has(edge.version)) continue;
			const kind = edge.kind === "importer" ? "importer" : edge.parent.startsWith(KIT) ? "kit" : "tool";
			const id = `${edge.parent}@${edge.parentVersion}>${edge.child}@${edge.version}`;
			if (seen.has(id)) continue;
			seen.add(id);
			edges.push({
				parent: edge.parent,
				parentVersion: edge.parentVersion,
				child: edge.child,
				version: edge.version,
				kind,
			});
			if (kind === "tool") overrides[`${edge.parent}>${edge.child}`] = hit.newest;
		}
	}
	return { kit: kit.size, split, edges, overrides };
}

function render(report) {
	const out = [];
	if (report.split.length === 0) {
		out.push(`stale-edges: ${report.kit} kit packages, none at more than one version`);
		return out.join("\n");
	}
	out.push(`stale-edges: ${report.split.length} of ${report.kit} kit packages resolve at more than one version`);
	for (const s of report.split) out.push(`  ${s.name} ${s.newest} (stale: ${s.stale.join(", ")})`);
	out.push("edges to a stale version:");
	for (const e of report.edges) {
		const from = e.kind === "importer" ? `${e.parent} (importer)` : `${e.parent}@${e.parentVersion}`;
		const note =
			e.kind === "kit"
				? "  (kit parent: a tool override covers it only through a peer; inspect it)"
				: e.kind === "importer"
					? "  (raise this repository's range)"
					: "";
		out.push(`  ${from} -> ${e.child}@${e.version}${note}`);
	}
	const lines = Object.entries(report.overrides);
	if (lines.length === 0) out.push("overrides: none (no tool parent)");
	else {
		out.push("overrides:");
		for (const [key, version] of lines) out.push(`  "${key}": "${version}"`);
	}
	return out.join("\n");
}

function main(argv) {
	let json = false;
	let file = null;
	for (const arg of argv) {
		if (arg === "--json") json = true;
		else if (arg === "--help" || arg === "-h") {
			process.stdout.write(`${USAGE}\n`);
			return 0;
		} else if (arg.startsWith("-")) {
			process.stderr.write(`stale-edges: unknown argument ${arg}\n${USAGE}\n`);
			return 64;
		} else if (file !== null) {
			process.stderr.write(`stale-edges: one lockfile only\n${USAGE}\n`);
			return 64;
		} else file = arg;
	}
	file ??= "pnpm-lock.yaml";
	let text;
	try {
		text = readFileSync(file, "utf8");
	} catch (err) {
		process.stderr.write(`stale-edges: cannot read ${file}: ${err.message}\n`);
		return 1;
	}
	const report = staleEdges(text);
	process.stdout.write(`${json ? JSON.stringify(report, null, 2) : render(report)}\n`);
	return report.split.length === 0 ? 0 : 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exitCode = main(process.argv.slice(2));
}
