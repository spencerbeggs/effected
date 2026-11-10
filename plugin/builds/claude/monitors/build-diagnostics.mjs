#!/usr/bin/env node
// Background monitor: polls the dist/prod/issues.json each `effected package build` writes and prints one line per
// package once its count of API Extractor and TSDoc diagnostics (codes ae-* and tsdoc-*) settles at a non-zero value.
// A count still moving build to build (an agent fixing diagnostics one by one, or a package mid-build) is held back
// until it holds steady for a short quiet period (savvy-web/systems#248).
//
// issues.json is a gitignored, shared, mutable artifact, which makes it a poor channel for evidence: a stray build
// from another tree rewrites it, a crashed build writes one with empty buckets, and a reviewer proving a fix is
// load-bearing must reintroduce the bug and rebuild. A watcher that reports whatever it finds reads all three as
// regressions; one session got five events on one package, none of which described HEAD (savvy-web/systems#255).
// Three gates exist for that: buildOk, artifact newer than its inputs, and inputs clean in git. Each is a reason to
// stay quiet, never a reason to report harder: an artifact this monitor cannot vouch for produces no line at all.
//
// It polls the per-package artifacts rather than the workspace's .cache/effected journals. A journal line names its
// package and build time but no commit and no tree state, so it cannot stand in for either gate, and a turbo cache
// hit restores dist/prod/issues.json without appending a line, so only the artifact is always current.
//
// Ported from the silk plugin's tsdoc-diagnostics monitor. It runs as a resident node process rather than on the
// shell monitor library, because the lock below needs one long-lived pid; it honours PLUGINFINITY_MONITOR_MAX_TICKS
// itself and logs through the build's lib/pluginfinity/log.sh.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { globSync, readFileSync, realpathSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const LOG_LIB = join(dirname(SELF), "..", "lib", "pluginfinity", "log.sh");
const DIAGNOSTIC_CODE = /^(ae-|tsdoc-)/;
const SOURCE_EXT = /\.(ts|tsx|mts|cts)$/;
// The effected.toml files `effected package build` reads, per tier: the workspace root's and the package's. These
// are the build's config inputs (turbo.json lists the same), and `[package.build.meta.tsdoc]` lives in them.
const ROOT_CONFIGS = [".config/effected.toml", "effected.toml"];
const PACKAGE_CONFIGS = [".config/effected.toml", "effected.toml", "lib/configs/effected.toml"];
// Directories never searched for artifacts: dependencies, vendored sources and caches hold artifacts that are not
// this workspace's builds, and walking them costs most of a scan.
const SKIP_DIRS = new Set(["node_modules", ".git", ".repos", ".cache", ".turbo"]);
const POLL_MS = 2000;
// A full search for artifacts walks every source tree, so it runs on the first tick and then every this many ticks
// (~30 s); every tick in between re-reads the artifacts already found, which is cheap.
const DISCOVERY_TICKS = 15;
// Consecutive polls a non-zero count must hold, unchanged, before the monitor notifies. With POLL_MS=2000 the
// default (3) is a ~6 s quiet period. Override with EFFECTED_BUILD_MONITOR_STABLE_POLLS (0 fires at once).
const STABLE_POLLS = stablePollsFromEnv();
// How long a lock may go untouched before a rival treats it as abandoned. The holder refreshes its lock's mtime every
// tick, so this only elapses when the holder is gone, the one case a pid probe cannot detect: a recycled pid answers
// `kill(pid, 0)` exactly like the original holder.
const STALE_LOCK_MS = POLL_MS * 5;

function stablePollsFromEnv() {
	const n = Number(process.env.EFFECTED_BUILD_MONITOR_STABLE_POLLS ?? 3);
	return Number.isInteger(n) && n >= 0 ? n : 3;
}

function realpathish(p) {
	try {
		return realpathSync(p);
	} catch {
		return p;
	}
}

// The git toplevel of `cwd`, or undefined outside a repository or without git.
function gitToplevel(cwd) {
	try {
		const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return out === "" ? undefined : realpathish(out);
	} catch {
		return undefined;
	}
}

// Claude Code starts a monitor in the session's project with no CLAUDE_PROJECT_DIR, so the project is the git
// toplevel of the working directory, else the working directory itself.
const GIT_ROOT = gitToplevel(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
const ROOT = realpathish(process.env.CLAUDE_PROJECT_DIR ?? GIT_ROOT ?? process.cwd());

// Append one line to the plugin's error.log through the build's log library. Never throws; never touches stdout.
function log(message) {
	try {
		const script = '_pf_log_dir="$1"; . "$_pf_log_dir/log.sh"; pf_log monitor "$2"';
		// $0 names this script in the log line; $1 is the library's directory.
		execFileSync("sh", ["-c", script, basename(SELF), dirname(LOG_LIB), message], { stdio: "ignore" });
	} catch {
		/* logging is best-effort */
	}
}

function countDiagnostics(issues) {
	const warnings = Array.isArray(issues?.warnings) ? issues.warnings : [];
	const all = [...warnings, ...(Array.isArray(issues?.errors) ? issues.errors : [])];
	let count = 0;
	let ciFatal = 0;
	for (const d of all) {
		if (typeof d?.code !== "string" || !DIAGNOSTIC_CODE.test(d.code)) continue;
		count += 1;
		if (d.ciFatal === true) ciFatal += 1;
	}
	return { count, ciFatal };
}

function discover() {
	return globSync("**/dist/prod/issues.json", {
		cwd: ROOT,
		exclude: (p) => SKIP_DIRS.has(basename(p)),
	}).map((rel) => join(ROOT, rel));
}

function mtimeOf(path) {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return undefined;
	}
}

// Whether the artifact is at least as new as every input this monitor measures: the package's src/ sources and the
// effected.toml files of both tiers. A package with no visible source tree is "cannot vouch", the same as a stale
// artifact, never a pass.
function isFresh(c, root = ROOT) {
	const artifact = mtimeOf(c.path);
	if (artifact === undefined) return false;
	let sources = 0;
	try {
		for (const rel of globSync("src/**/*", { cwd: c.pkgDir, exclude: (p) => SKIP_DIRS.has(basename(p)) })) {
			if (!SOURCE_EXT.test(rel)) continue;
			sources += 1;
			const ms = mtimeOf(join(c.pkgDir, rel));
			if (ms !== undefined && ms > artifact) return false;
		}
	} catch {
		return false;
	}
	if (sources === 0) return false;
	const configs = [...PACKAGE_CONFIGS.map((p) => join(c.pkgDir, p)), ...ROOT_CONFIGS.map((p) => join(root, p))];
	for (const config of configs) {
		const ms = mtimeOf(config);
		if (ms !== undefined && ms > artifact) return false;
	}
	return true;
}

// The repository-relative paths `git status` reports as changed or untracked, read once per tick at most and only
// once a candidate is otherwise ready to fire. Undefined when there is no repository, which makes no claim either way.
function changedPaths() {
	if (GIT_ROOT === undefined) return undefined;
	try {
		const out = execFileSync("git", ["status", "--porcelain", "-z", "--untracked-files=all"], {
			cwd: GIT_ROOT,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		const paths = new Set();
		const fields = out.split("\0");
		for (let i = 0; i < fields.length; i++) {
			const field = fields[i];
			if (field.length < 4) continue;
			paths.add(field.slice(3));
			// A rename or copy is followed by its source path; the destination is what the build read.
			if (field[0] === "R" || field[0] === "C") i += 1;
		}
		return paths;
	} catch {
		return undefined;
	}
}

// Whether any build input of the candidate's package is uncommitted: a src/ source, one of its effected.toml files,
// or one of the workspace's. Scoped to the same inputs the freshness gate measures, so an uncommitted __test__/ file
// or vitest config, neither an input to the ae-*/tsdoc-* pass, does not silence it.
function makeIsDirty() {
	let paths;
	return (c) => {
		paths ??= changedPaths() ?? null;
		if (paths === null) return false;
		const pkg = relative(GIT_ROOT, realpathish(c.pkgDir)).split("\\").join("/");
		const root = relative(GIT_ROOT, ROOT).split("\\").join("/");
		const base = pkg === "" ? "" : `${pkg}/`;
		const rootBase = root === "" ? "" : `${root}/`;
		const configs = new Set([...PACKAGE_CONFIGS.map((p) => base + p), ...ROOT_CONFIGS.map((p) => rootBase + p)]);
		for (const p of paths) {
			if ((p.startsWith(`${base}src/`) && SOURCE_EXT.test(p)) || configs.has(p)) return true;
		}
		return false;
	};
}

// The mtime at which each unreadable artifact was last logged. read() runs every tick, so without this a file a crashed
// build truncated would append a line (and spawn sh) every POLL_MS for as long as it stays malformed. One line per
// state: a rewrite that is still unreadable logs again, and a successful read forgets the path.
const loggedUnreadable = new Map();

function read(path) {
	let issues;
	try {
		issues = JSON.parse(readFileSync(path, "utf8"));
	} catch (err) {
		if (err?.code === "ENOENT") {
			loggedUnreadable.delete(path);
			return undefined;
		}
		const mtime = mtimeOf(path);
		if (!loggedUnreadable.has(path) || loggedUnreadable.get(path) !== mtime) {
			loggedUnreadable.set(path, mtime);
			log(`could not read ${relative(ROOT, path) || path}: ${err?.message ?? err}`);
		}
		return undefined;
	}
	loggedUnreadable.delete(path);
	// <pkg>/dist/prod/issues.json: up three to the package root.
	const pkgDir = dirname(dirname(dirname(path)));
	return {
		path,
		pkgDir,
		pkg: typeof issues?.package === "string" ? issues.package : relative(ROOT, pkgDir),
		...countDiagnostics(issues),
		// Three-state on purpose: true, false or undefined. An artifact without the stamp cannot be vouched for.
		buildOk: typeof issues?.buildOk === "boolean" ? issues.buildOk : undefined,
	};
}

// The pure debounce and provenance step. State per artifact carries its count, how many consecutive scans held that
// count (`streak`) and the last count notified (`notified`). A non-zero count fires once its streak reaches
// `minStablePolls`, when it differs from the last notified value and the artifact can be vouched for: a count that
// keeps changing never fires, a new settled value fires once, and a return to zero re-arms.
//
// `isDirty` and `isFresh` are injected so this stays pure; both are consulted only for a candidate that has cleared
// every cheaper gate, because each costs a git call or a source walk.
export function diagnose(current, prev, minStablePolls, isDirty = () => false, isFresh = () => true) {
	const lines = [];
	const next = new Map();
	for (const c of current) {
		const before = prev.get(c.path);
		const streak = before && before.count === c.count ? before.streak + 1 : 0;
		let notified = before?.notified;
		if (c.count === 0) {
			notified = undefined;
		} else if (streak >= minStablePolls && notified !== c.count && c.buildOk === true) {
			if (isFresh(c) && !isDirty(c)) {
				const plural = c.count === 1 ? "" : "s";
				const fatal = c.ciFatal > 0 ? ` (${c.ciFatal} fails CI)` : "";
				const rel = relative(ROOT, c.path) || c.path;
				lines.push(
					`build: ${c.pkg} has ${c.count} ae-*/tsdoc-* diagnostic${plural} in ${rel}${fatal}. Read it for the entries before acting; this line reports an artifact, not the state of any agent's in-flight work.`,
				);
				notified = c.count;
			}
		}
		next.set(c.path, { count: c.count, streak, notified });
	}
	return { lines, next };
}

// Per-project single-instance lock. Monitors start once per session and are never deduplicated: one repository
// accumulated 70 live watchers, and each firing woke every idle agent (savvy-web/systems#255). The lock is advisory:
// an abandoned one is taken over, never trusted. Acquisition is an exclusive create (`wx`), never read-then-write,
// so of two monitors cold-starting at once exactly one wins.
function claimLock() {
	const key = createHash("sha256").update(ROOT).digest("hex").slice(0, 16);
	const lockPath = join(tmpdir(), `effected-build-monitor-${key}.pid`);
	// Two attempts: the first claim, and one retry after reclaiming an abandoned lock. A second EEXIST means another
	// starter won the reclaim, which settles it.
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			writeFileSync(lockPath, String(process.pid), { flag: "wx" });
			return { lockPath, release: releaseFn(lockPath) };
		} catch (err) {
			if (err?.code !== "EEXIST") {
				// No lock can be written at all (a read-only tmp): run unlocked rather than not at all. The same
				// shape as the success path, minus lockPath, which tells the loop to skip the heartbeat.
				log(`running unlocked, could not write ${lockPath}: ${err?.code ?? err}`);
				return { release: () => {} };
			}
		}
		if (lockIsHeld(lockPath)) return null;
		try {
			unlinkSync(lockPath);
		} catch {
			// Another starter reclaimed it first; the retry's EEXIST settles it.
		}
	}
	return null;
}

// Whether the lock is still held. Two cases a pid probe alone cannot settle:
//   1. `wx` creates the file and writes it separately, so a rival can read it empty. A fresh unparsable file is a
//      rival mid-write: yield to it. An old one is a process that died between the two: reclaim it.
//   2. A SIGKILLed holder never releases, and its recycled pid answers the probe. The heartbeat settles it: a lock
//      quiet for STALE_LOCK_MS is abandoned whatever the pid probe says.
function lockIsHeld(lockPath) {
	const age = Date.now() - (mtimeOf(lockPath) ?? Number.NEGATIVE_INFINITY);
	if (!Number.isFinite(age)) return false; // vanished between the EEXIST and this read
	let held;
	try {
		held = Number(readFileSync(lockPath, "utf8").trim());
	} catch {
		held = Number.NaN;
	}
	if (!Number.isInteger(held) || held <= 0) return age < STALE_LOCK_MS;
	if (held === process.pid) return false;
	let alive;
	try {
		process.kill(held, 0);
		alive = true;
	} catch (err) {
		// EPERM is alive under another uid; only a missing process is gone.
		alive = err?.code === "EPERM";
	}
	return alive && age < STALE_LOCK_MS;
}

// Refresh our lock's mtime so rivals can tell a live holder from a recycled pid, and answer whether we still hold it.
// Touches only a file naming us. A lock naming anyone else (or no one: a rival mid-write) means a rival judged ours
// abandoned and took it over, which happens when this process was suspended past STALE_LOCK_MS (a stopped session,
// a stalled event loop): we lost it, and reporting on would duplicate every line the rival prints. A lock that
// vanished (a tmp cleaner) is claimed again with the same exclusive create, so the project is not left unwatched;
// only an EEXIST there, a rival that won the race, means we lost. Any other failure (an unwritable tmp) keeps us
// running, as claimLock does.
function heartbeat(lockPath) {
	let holder;
	try {
		holder = readFileSync(lockPath, "utf8").trim();
	} catch (err) {
		if (err?.code !== "ENOENT") return true;
		try {
			writeFileSync(lockPath, String(process.pid), { flag: "wx" });
			return true;
		} catch (claimErr) {
			return claimErr?.code !== "EEXIST";
		}
	}
	if (holder !== String(process.pid)) return false;
	try {
		const now = new Date();
		utimesSync(lockPath, now, now);
	} catch {
		/* unwritable: the lock still names us */
	}
	return true;
}

function releaseFn(lockPath) {
	return () => {
		try {
			if (readFileSync(lockPath, "utf8").trim() === String(process.pid)) unlinkSync(lockPath);
		} catch {
			/* nothing to release */
		}
	};
}

/** PLUGINFINITY_MONITOR_MAX_TICKS as a positive integer, else undefined (unbounded). */
function maxTicksFromEnv() {
	const raw = process.env.PLUGINFINITY_MONITOR_MAX_TICKS;
	if (raw === undefined) return undefined;
	const n = Number(raw);
	if (Number.isInteger(n) && n > 0) return n;
	log(`ignoring PLUGINFINITY_MONITOR_MAX_TICKS=${raw}: not a positive integer`);
	return undefined;
}

async function main() {
	// pluginfinity's monitor contract: PLUGINFINITY_MONITOR_MAX_TICKS=<n> stops the monitor after n polls (only a test
	// sets it). One tick is a single-shot check, the same as --once.
	const maxTicks = maxTicksFromEnv();
	const once = process.argv.includes("--once") || maxTicks === 1;
	// A single-shot check has no history to build a quiet period from, so it reports settled-looking counts at once,
	// and as a diagnostic invocation rather than a resident watcher it takes no lock.
	const minStablePolls = once ? 0 : STABLE_POLLS;
	let lockPath;
	if (!once) {
		const claimed = claimLock();
		if (claimed === null) return; // another watcher already owns this project
		lockPath = claimed.lockPath;
		process.on("exit", claimed.release);
		for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => process.exit(0));
	}
	// A closed stdout means the host is gone: stop rather than poll forever.
	process.stdout.on("error", () => process.exit(0));
	let prev = new Map();
	let known = [];
	let ticks = 0;
	const tick = () => {
		// Counted first, so a poll that throws still counts toward PLUGINFINITY_MONITOR_MAX_TICKS.
		ticks += 1;
		try {
			// Lost the lock to a rival: stop, as a starter that finds it held does. The exit handler's release only
			// unlinks a file naming this pid, so it leaves the rival's lock alone.
			if (lockPath !== undefined && !heartbeat(lockPath)) process.exit(0);
			if ((ticks - 1) % DISCOVERY_TICKS === 0) known = discover();
			const current = [];
			for (const path of known) {
				const c = read(path);
				if (c !== undefined) current.push(c);
			}
			const { lines, next } = diagnose(current, prev, minStablePolls, makeIsDirty(), isFresh);
			prev = next;
			for (const line of lines) process.stdout.write(`${line}\n`);
		} catch (err) {
			log(`poll failed: ${err?.message ?? err}`);
		}
	};
	tick();
	if (once) return;
	// Self-scheduling rather than setInterval, so a slow scan never overlaps the next one and both read one `prev`.
	const loop = () => {
		if (maxTicks !== undefined && ticks >= maxTicks) return;
		tick();
		setTimeout(loop, POLL_MS);
	};
	setTimeout(loop, POLL_MS);
}

// Run the loop only when invoked as a script, so a test can import `diagnose`. Compare real paths, so a symlinked
// plugin root still starts the monitor.
function invokedDirectly() {
	const entry = process.argv[1];
	if (!entry) return false;
	try {
		return realpathSync(entry) === realpathSync(SELF);
	} catch {
		return false;
	}
}

if (invokedDirectly()) {
	await main();
}
