#!/usr/bin/env node
// Which upgrade-ledger entries apply to this repository, and where its code
// meets them.
//
// Usage (from the repository root):
//   node applicable.mjs [--base <git-ref>] [--before <lockfile>] [--after <lockfile>]
//                       [--ledger <dir>] [--root <dir>] [--offline] [--json]
//   node applicable.mjs --check [--ledger <dir>]
//
// The versions before the upgrade come from the base branch's lockfile
// (`git show <base>:pnpm-lock.yaml`, base defaulting to the merge-base with the
// default branch), or from `--before`. The versions after come from the working
// tree's lockfile, or `--after`. An entry applies when one of the packages it
// names crossed its threshold: below it before, at or above it after.
//
// When the repository was older than the ledger's baseline, the entries of the
// earlier rounds are fetched from the plugin's previous release tags with `gh`
// (skipped under `--offline`, which prints the command to run instead).
//
// `--check` validates every entry and the baseline, and prints each problem.
//
// Exit codes: 0 done, 1 a failure (unreadable lockfile, bad entry, fetch
// failed), 64 a usage error. Dependency-free: it runs from an installed plugin.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LEDGER = resolve(SCRIPT_DIR, "../references/ledger");
const KINDS = ["security", "breaking", "behaviour", "tooling", "adopt"];
const SHOWS = ["typed", "behavioural", "none"];
const MAX_CHAIN = 10;
const MAX_HITS = 20;

// ── arguments ──────────────────────────────────────────────────────────────

function usage(message) {
	process.stderr.write(`applicable: ${message}\n`);
	process.exit(64);
}

function parseArgs(argv) {
	const opts = { offline: false, json: false, check: false };
	const valued = new Set(["--base", "--before", "--after", "--ledger", "--root"]);
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--offline") opts.offline = true;
		else if (arg === "--json") opts.json = true;
		else if (arg === "--check") opts.check = true;
		else if (valued.has(arg)) {
			const value = argv[++i];
			if (value === undefined || value.startsWith("--")) usage(`${arg} needs a value`);
			opts[arg.slice(2)] = value;
		} else usage(`unknown argument ${arg}`);
	}
	return opts;
}

// ── versions ───────────────────────────────────────────────────────────────

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Parse `X.Y.Z` or `X.Y.Z-pre`; null for anything else. */
export function parseVersion(text) {
	const m = VERSION.exec(String(text).trim());
	if (!m) return null;
	return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] === undefined ? [] : m[4].split(".") };
}

/** Semver precedence: negative, zero or positive. */
export function compareVersions(a, b) {
	const x = typeof a === "string" ? parseVersion(a) : a;
	const y = typeof b === "string" ? parseVersion(b) : b;
	for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
	if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length;
	for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
		if (x.pre[i] === undefined) return -1;
		if (y.pre[i] === undefined) return 1;
		const nx = /^\d+$/.test(x.pre[i]);
		const ny = /^\d+$/.test(y.pre[i]);
		if (nx && ny && Number(x.pre[i]) !== Number(y.pre[i])) return Number(x.pre[i]) - Number(y.pre[i]);
		if (nx !== ny) return nx ? -1 : 1;
		if (x.pre[i] !== y.pre[i]) return x.pre[i] < y.pre[i] ? -1 : 1;
	}
	return 0;
}

/** A threshold is `>=X.Y.Z`: the first release that carries the change. */
function parseThreshold(text) {
	const m = /^>=\s*(\S+)$/.exec(String(text).trim());
	return m && parseVersion(m[1]) ? m[1] : null;
}

// ── lockfile ───────────────────────────────────────────────────────────────

const unquote = (s) => s.trim().replace(/^(['"])(.*)\1$/, "$2");

/**
 * Every resolved version of every importer's direct dependency, across all of
 * the lockfile's documents (pnpm 11+ writes config dependencies in a document
 * of their own). `link:`, `file:` and `workspace:` resolutions are skipped.
 *
 * @returns Map<name, string[]>
 */
export function lockfileVersions(text) {
	const versions = new Map();
	const lines = text.split(/\r?\n/);
	let inImporters = false;
	let name = null;
	for (const line of lines) {
		if (line === "---" || /^\S/.test(line)) {
			inImporters = line === "importers:";
			name = null;
			continue;
		}
		if (!inImporters) continue;
		const dep = /^ {6}(\S.*?):\s*$/.exec(line);
		if (dep) {
			name = unquote(dep[1]);
			continue;
		}
		if (!/^ {6,}/.test(line)) {
			name = null;
			continue;
		}
		const ver = /^ {8}version:\s*(.+)$/.exec(line);
		if (ver && name !== null) {
			const raw = unquote(ver[1]).replace(/\(.*$/, "");
			if (parseVersion(raw)) {
				const list = versions.get(name) ?? [];
				list.push(raw);
				versions.set(name, list);
			}
		}
	}
	return versions;
}

const lowest = (list) => (list?.length ? [...list].sort(compareVersions)[0] : null);
const highest = (list) => (list?.length ? [...list].sort(compareVersions).at(-1) : null);

// ── frontmatter ────────────────────────────────────────────────────────────

/**
 * The frontmatter of a ledger file: a restricted YAML subset, so a script with
 * no dependencies can read it. Scalars (`key: value`, quoted or bare), flow
 * lists (`key: ["a", "b"]`), and block maps or block lists under a bare `key:`.
 */
export function parseFrontmatter(text) {
	const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
	if (!m) return null;
	const data = {};
	let key = null;
	for (const line of m[1].split(/\r?\n/)) {
		if (line.trim() === "" || line.trim().startsWith("#")) continue;
		const top = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
		if (top) {
			key = top[1];
			data[key] = top[2] === "" ? null : scalarOrList(top[2]);
			continue;
		}
		if (key === null) throw new Error(`unexpected line: ${line}`);
		const item = /^\s+-\s+(.+)$/.exec(line);
		if (item) {
			if (data[key] !== null && !Array.isArray(data[key])) throw new Error(`mixed block under ${key}`);
			data[key] = [...(data[key] ?? []), decodeScalar(item[1])];
			continue;
		}
		const pair = /^\s+(".*?"|'.*?'|[^\s:]+):\s*(.+)$/.exec(line);
		if (pair) {
			if (Array.isArray(data[key])) throw new Error(`mixed block under ${key}`);
			data[key] = { ...(data[key] ?? {}), [decodeScalar(pair[1])]: decodeScalar(pair[2]) };
			continue;
		}
		throw new Error(`unreadable line: ${line}`);
	}
	return { data, body: m[2] };
}

/**
 * One scalar, decoded the same way wherever it appears: a double-quoted value
 * is a JSON string (so `"Crypto\\."` is `Crypto\.`), a single-quoted one is
 * taken literally, and a bare one ends at a ` #` comment. A `#` inside quotes
 * is part of the value.
 */
export function decodeScalar(raw) {
	const value = raw.trim();
	if (value.startsWith('"')) {
		const m = /^("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/.exec(value);
		if (!m) throw new Error(`unterminated string: ${raw}`);
		return JSON.parse(m[1]);
	}
	if (value.startsWith("'")) {
		const m = /^'([^']*)'\s*(?:#.*)?$/.exec(value);
		if (!m) throw new Error(`unterminated string: ${raw}`);
		return m[1];
	}
	return value.replace(/\s+#.*$/, "");
}

function scalarOrList(raw) {
	const trimmed = raw.trim();
	if (!trimmed.startsWith("[")) return decodeScalar(trimmed);
	// A list's trailing comment follows its closing bracket.
	const value = trimmed.replace(/\]\s+#.*$/, "]");
	if (!value.endsWith("]")) throw new Error(`unterminated list: ${raw}`);
	const inner = value.slice(1, -1).trim();
	if (inner === "") return [];
	const items = [];
	const re = /\s*("(?:[^"\\]|\\.)*"|'[^']*'|[^,]+)\s*(?:,|$)/gy;
	while (re.lastIndex < inner.length) {
		const match = re.exec(inner);
		if (match === null) throw new Error(`unreadable list: ${raw}`);
		items.push(decodeScalar(match[1]));
	}
	return items;
}

// ── ledger ─────────────────────────────────────────────────────────────────

const ENTRY_FILE = /^(\d{4})-[a-z0-9-]+\.md$/;

/** Validate one entry; returns a list of problems (empty when valid). */
export function entryProblems(file, parsed) {
	const problems = [];
	const at = (msg) => problems.push(`${file}: ${msg}`);
	if (!parsed) return [`${file}: no frontmatter`];
	const { data, body } = parsed;
	const id = ENTRY_FILE.exec(file)?.[1];
	if (!id) at("file name must be NNNN-slug.md");
	if (String(data.id) !== id) at(`id ${JSON.stringify(data.id)} does not match the file name`);
	if (typeof data.title !== "string" || data.title === "") at("title is required");
	if (!KINDS.includes(data.kind)) at(`kind must be one of ${KINDS.join(", ")}`);
	if (!SHOWS.includes(data.shows)) at(`shows must be one of ${SHOWS.join(", ")}`);
	if (data.applies === null || typeof data.applies !== "object" || Array.isArray(data.applies)) {
		at("applies must be a map of package name to >=X.Y.Z");
	} else {
		if (Object.keys(data.applies).length === 0) at("applies names no package");
		for (const [pkg, thr] of Object.entries(data.applies)) {
			if (!parseThreshold(thr)) at(`applies.${pkg}: ${JSON.stringify(thr)} is not >=X.Y.Z`);
		}
	}
	if (
		data.renames !== undefined &&
		data.renames !== null &&
		(typeof data.renames !== "object" || Array.isArray(data.renames))
	) {
		at("renames must be a map of old package name to new");
	}
	for (const field of ["detect", "closes", "changesets"]) {
		if (data[field] !== undefined && data[field] !== null && !Array.isArray(data[field])) at(`${field} must be a list`);
	}
	for (const pattern of data.detect ?? []) {
		try {
			new RegExp(pattern);
		} catch {
			at(`detect pattern ${JSON.stringify(pattern)} is not a valid regular expression`);
		}
		// `git grep -E` is POSIX extended syntax: these escapes and lookaround
		// compile in JavaScript but match nothing there, so the entry would find no
		// hits silently. Spell them `[0-9]`, `[[:space:]]`, `[A-Za-z0-9_]`.
		const unsupported = /\\[dDsSwWbB<>]|\(\?/.exec(pattern);
		if (unsupported) {
			at(`detect pattern ${JSON.stringify(pattern)} uses ${unsupported[0]}, which git grep -E does not support`);
		}
	}
	if (data.kind !== "tooling" && data.kind !== "adopt" && !(data.detect?.length > 0)) {
		at("a security, breaking or behaviour entry needs at least one detect pattern");
	}
	if (body.trim() === "") at("the body is empty");
	return problems;
}

/** Validate the baseline record; returns a list of problems. */
export function baselineProblems(parsed) {
	if (!parsed) return ["BASELINE.md: no frontmatter"];
	const { data } = parsed;
	const problems = [];
	if (typeof data.repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(data.repo))
		problems.push("BASELINE.md: repo must be owner/name");
	if (typeof data.path !== "string" || data.path === "") problems.push("BASELINE.md: path is required");
	if (typeof data.previous !== "string" || data.previous === "")
		problems.push('BASELINE.md: previous must be a tag or "none"');
	if (data.floor !== null && (typeof data.floor !== "object" || Array.isArray(data.floor))) {
		problems.push("BASELINE.md: floor must be a map of package name to version");
	}
	if (
		data.renames !== undefined &&
		data.renames !== null &&
		(typeof data.renames !== "object" || Array.isArray(data.renames))
	) {
		problems.push("BASELINE.md: renames must be a map of old package name to new");
	}
	for (const [pkg, v] of Object.entries(data.floor ?? {})) {
		if (!parseVersion(v)) problems.push(`BASELINE.md: floor.${pkg}: ${JSON.stringify(v)} is not a version`);
	}
	return problems;
}

/** Read a ledger directory: its entries and its baseline. Throws on a bad file. */
export function readLedger(dir) {
	const files = existsSync(dir) ? readdirSync(dir).sort() : [];
	const baselineFile = join(dir, "BASELINE.md");
	if (!existsSync(baselineFile)) throw new Error(`${dir} has no BASELINE.md`);
	const baseline = parseFrontmatter(readFileSync(baselineFile, "utf8"));
	const problems = baselineProblems(baseline);
	const entries = [];
	const seen = new Set();
	for (const file of files) {
		if (file === "BASELINE.md" || !file.endsWith(".md")) continue;
		let parsed;
		try {
			parsed = parseFrontmatter(readFileSync(join(dir, file), "utf8"));
		} catch (err) {
			problems.push(`${file}: ${err.message}`);
			continue;
		}
		problems.push(...entryProblems(file, parsed));
		if (parsed && seen.has(String(parsed.data.id))) problems.push(`${file}: duplicate id ${parsed.data.id}`);
		if (parsed) seen.add(String(parsed.data.id));
		if (parsed) entries.push({ file: join(dir, file), ...parsed.data });
	}
	if (problems.length > 0) throw Object.assign(new Error("invalid ledger"), { problems });
	return { baseline: baseline.data, entries };
}

// ── applicability ──────────────────────────────────────────────────────────

/** The packages an entry names whose threshold the upgrade crossed. */
export function crossings(entry, before, after) {
	const out = [];
	for (const [pkg, thr] of Object.entries(entry.applies ?? {})) {
		const threshold = parseThreshold(thr);
		const from = lowest(before.get(pkg));
		const to = highest(after.get(pkg));
		if (threshold && from && to && compareVersions(from, threshold) < 0 && compareVersions(to, threshold) >= 0) {
			out.push({ pkg, from, to, threshold });
		}
	}
	return out;
}

/**
 * `before` with each renamed package also visible under its new name. A
 * republished package continues its old version line, so a repository that
 * resolved only the old name before the upgrade crosses the new name's
 * thresholds from the old name's version. A new name it already resolved wins.
 */
export function foldRenames(before, renames) {
	const out = new Map(before);
	for (const [oldName, newName] of Object.entries(renames)) {
		if (!out.has(newName) && out.has(oldName)) out.set(newName, out.get(oldName));
	}
	return out;
}

/** Every rename a ledger round records, in its baseline and its entries. */
export function roundRenames(round) {
	const renames = { ...(round.baseline?.renames ?? {}) };
	for (const entry of round.entries) Object.assign(renames, entry.renames ?? {});
	return renames;
}

/** True when the repository was on a release older than the ledger's baseline. */
export function olderThanBaseline(baseline, before) {
	for (const [pkg, floor] of Object.entries(baseline.floor ?? {})) {
		const from = lowest(before.get(pkg));
		if (from && compareVersions(from, floor) < 0) return true;
	}
	return false;
}

// ── git and gh ─────────────────────────────────────────────────────────────

function git(root, args) {
	return execFileSync("git", ["-C", root, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		// execFileSync's default 1 MiB overflows on a large lockfile or a minified bundle line.
		maxBuffer: 1 << 30,
	});
}

function defaultBase(root) {
	let branch = "main";
	try {
		branch = git(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).trim();
	} catch {
		for (const candidate of ["main", "master"]) {
			try {
				git(root, ["rev-parse", "--verify", "--quiet", candidate]);
				branch = candidate;
				break;
			} catch {}
		}
	}
	try {
		return git(root, ["merge-base", "HEAD", branch]).trim();
	} catch {
		return branch;
	}
}

/** `gh` with inherited host, repo and pager settings scrubbed for one call. */
function gh(args) {
	const env = { ...process.env, GH_PAGER: "cat" };
	delete env.GH_HOST;
	delete env.GH_REPO;
	if (env.GH_TOKEN === "") delete env.GH_TOKEN;
	return execFileSync("gh", args, { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
}

/** Fetch a previous round's ledger at `tag` into a cache directory and return it. */
function fetchRound(baseline, tag) {
	const state = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
	const dir = join(state, "effected", "renovate", tag.replace(/[^\w.@-]+/g, "_"));
	if (existsSync(join(dir, "BASELINE.md"))) return dir;
	const ref = encodeURIComponent(tag);
	const listing = JSON.parse(gh(["api", `repos/${baseline.repo}/contents/${baseline.path}?ref=${ref}`]));
	mkdirSync(dir, { recursive: true });
	for (const item of listing) {
		if (item.type !== "file" || !item.name.endsWith(".md")) continue;
		const content = gh(["api", `repos/${baseline.repo}/contents/${item.path}?ref=${ref}`, "--jq", ".content"]);
		writeFileSync(join(dir, item.name), Buffer.from(content.replace(/\s+/g, ""), "base64").toString("utf8"));
	}
	return dir;
}

const MAX_HIT_LINE = 240;

function detectHits(root, patterns) {
	if (!patterns?.length) return [];
	const args = ["grep", "-nIE"];
	for (const p of patterns) args.push("-e", p);
	// Committed build output (bundles, minified one-line files) is never the user's source to migrate.
	args.push("--", ".", ":(exclude)pnpm-lock.yaml", ":(exclude)**/CHANGELOG.md", ":(exclude).changeset/**");
	// Only directories that never hold source: a `build/` or `out/` can be source (lib/build/ is, here).
	for (const dir of ["dist", ".next", ".turbo", "coverage", "node_modules", ".github/actions/local"]) {
		args.push(`:(exclude)${dir}/**`, `:(exclude)**/${dir}/**`);
	}
	try {
		return git(root, args)
			.split("\n")
			.filter(Boolean)
			.map((line) => (line.length > MAX_HIT_LINE ? `${line.slice(0, MAX_HIT_LINE)}… [line truncated]` : line));
	} catch (err) {
		if (err.status === 1) return [];
		throw err;
	}
}

// ── main ───────────────────────────────────────────────────────────────────

function readBefore(opts, root) {
	if (opts.before) return readFileSync(opts.before, "utf8");
	const base = opts.base ?? defaultBase(root);
	try {
		return git(root, ["show", `${base}:pnpm-lock.yaml`]);
	} catch {
		throw new Error(`cannot read pnpm-lock.yaml at ${base}; pass --base <ref> or --before <lockfile>`);
	}
}

function main() {
	const opts = parseArgs(process.argv.slice(2));
	const ledgerDir = resolve(opts.ledger ?? DEFAULT_LEDGER);

	if (opts.check) {
		try {
			const { entries } = readLedger(ledgerDir);
			process.stdout.write(`applicable: ${entries.length} entries valid\n`);
			return 0;
		} catch (err) {
			process.stderr.write(`${(err.problems ?? [err.message]).join("\n")}\n`);
			return 1;
		}
	}

	const root = resolve(opts.root ?? process.cwd());
	const before = lockfileVersions(readBefore(opts, root));
	const after = lockfileVersions(readFileSync(opts.after ?? join(root, "pnpm-lock.yaml"), "utf8"));

	const rounds = [];
	const notices = [];
	let dir = ledgerDir;
	for (let depth = 0; depth < MAX_CHAIN; depth++) {
		const ledger = readLedger(dir);
		rounds.push({ dir, ...ledger });
		if (!olderThanBaseline(ledger.baseline, before)) break;
		const tag = ledger.baseline.previous;
		if (tag === "none") {
			const floor = Object.entries(ledger.baseline.floor ?? {})
				.map(([pkg, v]) => `${pkg} ${v}`)
				.join(", ");
			notices.push(`this repository predates the earliest ledger round (${floor}); changes before it are not recorded`);
			break;
		}
		if (opts.offline) {
			notices.push(
				`this repository predates the ledger's baseline; the earlier round is at ${tag} — rerun without --offline to fetch it`,
			);
			break;
		}
		dir = fetchRound(ledger.baseline, tag);
	}

	const renamed = foldRenames(before, Object.assign({}, ...rounds.map(roundRenames)));
	const applied = [];
	let total = 0;
	for (const round of rounds) {
		for (const entry of round.entries) {
			total++;
			const crossed = crossings(entry, renamed, after);
			if (crossed.length === 0) continue;
			const hits = detectHits(root, entry.detect);
			applied.push({ ...entry, crossed, hits });
		}
	}
	applied.sort(
		(a, b) =>
			KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) ||
			SHOWS.indexOf(a.shows) - SHOWS.indexOf(b.shows) ||
			String(a.file).localeCompare(String(b.file)),
	);

	if (opts.json) {
		process.stdout.write(`${JSON.stringify({ total, notices, entries: applied }, null, 2)}\n`);
		return 0;
	}
	const out = [`applicable: ${applied.length} of ${total} ledger entries apply`];
	for (const notice of notices) out.push(`notice: ${notice}`);
	for (const e of applied) {
		out.push("", `${e.kind} (${e.shows}) ${e.id} ${e.title}`);
		for (const c of e.crossed) out.push(`  crossed: ${c.pkg} ${c.from} -> ${c.to} (>=${c.threshold})`);
		out.push(`  read: ${e.file}`);
		if (e.detect?.length) {
			out.push(`  hits: ${e.hits.length === 0 ? "none" : e.hits.length}`);
			for (const hit of e.hits.slice(0, MAX_HITS)) out.push(`    ${hit}`);
			if (e.hits.length > MAX_HITS) out.push(`    … ${e.hits.length - MAX_HITS} more`);
		}
	}
	process.stdout.write(`${out.join("\n")}\n`);
	return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		process.exitCode = main();
	} catch (err) {
		process.stderr.write(`applicable: ${err.problems ? err.problems.join("\n") : err.message}\n`);
		process.exitCode = 1;
	}
}
