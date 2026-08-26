/**
 * Sync the `effected` catalog to the kit's next release versions.
 *
 * The CLI is the only writer. `rolldown-pnpm-config upgrade --yes` resolves every
 * `source: "workspace"` entry against the local workspace and rewrites the literal in
 * `savvy.build.ts`; this script decides whether that rewrite earns a changeset. Builds
 * never write — an earlier revision of the seam rewrote the config from the build's
 * freeze path, which made a developer's `build:dev` and every CI build mutate the repo.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** One upgrade CLI invocation: its exit code and whatever it wrote to stdout. */
export interface UpgradeResult {
	readonly code: number;
	readonly stdout: string;
}

/** Runs the upgrade CLI. Injectable so tests need no CLI. */
export type UpgradeRunner = (args: readonly string[], cwd: string) => Promise<UpgradeResult>;

/** Options for {@link sync} and {@link check}. */
export interface SyncOptions {
	/** Repository root. Defaults to the root this script ships in. */
	readonly root?: string;
	/** Override the upgrade invocation. Defaults to the real CLI. */
	readonly run?: UpgradeRunner;
	/** Override the `changeset status` invocation. Defaults to the real CLI. */
	readonly status?: StatusRunner;
}

/** The package whose build config carries the catalog, and which the changeset bumps. */
export const PLUGIN = "@effected/pnpm-plugin-effect";

/** The config file the CLI rewrites, relative to the repository root. */
export const CONFIG_PATH = "packages/pnpm-plugin-effect/savvy.build.ts";

/** Fixed name: repeated runs overwrite one changeset rather than accumulating many. */
export const CHANGESET_PATH = ".changeset/catalog-sync.md";

/**
 * Where the commit message is written for the workflow to read.
 *
 * @remarks
 * Untracked and gitignored: the sync's own commit step stages exactly the
 * catalog literal and the changeset, so this file never enters a commit. It
 * exists because the message names the moves, and only this script knows them.
 */
export const COMMIT_MESSAGE_PATH = ".changeset/catalog-sync.commit.txt";

/**
 * Fallback body, used only when the rewrite moved something the CLI did not
 * report — a shape that should not occur, and one worth not crashing over.
 */
const CHANGESET_BODY = `---
"${PLUGIN}": patch
---

## Maintenance

- Synced the \`effected\` catalog to the current kit release versions
`;

const DEFAULT_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const defaultRunner: UpgradeRunner = (args, cwd) =>
	new Promise((resolve, reject) => {
		// stdout is captured because `--json` puts its document there; stderr is inherited
		// so the CLI's human commentary reaches the terminal live either way. The two
		// modes have two audiences: `--json` for this script, text for whoever is reading
		// a red check, which is why the gate below prints what it captured.
		const child = spawn("pnpm", ["exec", "rolldown-pnpm-config", ...args], {
			cwd,
			stdio: ["ignore", "pipe", "inherit"],
		});
		let stdout = "";
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.on("error", reject);
		// A non-zero exit is the gate reporting drift, not a failure to run.
		child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
	});

/**
 * Read the moved entries out of an `--json` upgrade document. Reporting only: whether the
 * catalog moved is decided by the config file, which cannot disagree with itself.
 */
function parseChanged(stdout: string): { catalog: string; pkg: string; from: string; to: string }[] {
	try {
		const doc = JSON.parse(stdout) as { changed?: { catalog: string; pkg: string; from: string; to?: string }[] };
		return (doc.changed ?? []).map((entry) => ({ ...entry, to: entry.to ?? "?" }));
	} catch {
		// A non-JSON stdout is not worth failing a completed sync over.
		return [];
	}
}

/** One catalogued version move, with the peer range the rewrite settled on. */
export interface CatalogMove {
	readonly catalog: string;
	readonly pkg: string;
	readonly from: string;
	readonly to: string;
	/** Absent only if the rewritten entry somehow declares no peer. */
	readonly peer: string | undefined;
}

/** The `peer:` range declared by one catalog entry's literal body. */
function peerOf(spec: string): string | undefined {
	return /\bpeer:\s*"([^"]+)"/.exec(spec)?.[1];
}

/**
 * Join the CLI's reported moves to the peer ranges in the rewritten literal.
 *
 * @remarks
 * The CLI reports the `range` move only — its `--json` names one catalog and
 * says nothing about the peers catalog, because `lock-minor` DERIVES the peer
 * from the new range rather than moving it independently. So the peer is read
 * back out of the file the CLI just wrote, which is also the only account of
 * it that cannot disagree with what ships.
 */
function movesWithPeers(
	root: string,
	changed: readonly { catalog: string; pkg: string; from: string; to: string }[],
): CatalogMove[] {
	const specs = new Map<string, ReadonlyMap<string, string>>();
	return changed.map((entry) => {
		let entries = specs.get(entry.catalog);
		if (entries === undefined) {
			entries = catalogEntries(root, entry.catalog);
			specs.set(entry.catalog, entries);
		}
		const spec = entries.get(entry.pkg);
		return { ...entry, peer: spec === undefined ? undefined : peerOf(spec) };
	});
}

/** `4 catalog:effected versions`, pluralized. */
function moveSummary(catalog: string, count: number): string {
	return `${count} catalog:${catalog} version${count === 1 ? "" : "s"}`;
}

/** Moves grouped by catalog, each group sorted by package name. */
function byCatalog(moves: readonly CatalogMove[]): [string, CatalogMove[]][] {
	const groups = new Map<string, CatalogMove[]>();
	for (const move of moves) {
		const group = groups.get(move.catalog) ?? [];
		group.push(move);
		groups.set(move.catalog, group);
	}
	return [...groups.entries()]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([catalog, group]) => [catalog, group.sort((a, b) => (a.pkg < b.pkg ? -1 : a.pkg > b.pkg ? 1 : 0))]);
}

/** `^0.13.0 -> ^0.13.1 (peer ^0.13.0)` — the peer parenthetical is dropped when unknown. */
function moveText(move: CatalogMove): string {
	const peer = move.peer === undefined ? "" : ` (peer ${move.peer})`;
	return `${move.from} -> ${move.to}${peer}`;
}

/**
 * The changeset body for a set of moves.
 *
 * @remarks
 * Names every package and both of its ranges. The previous body said only that
 * the catalog had been synced, which told a reader of the changelog nothing
 * they could check: consumers take their `@effected/*` ranges from this
 * catalog, so which packages moved and to what IS the release note.
 */
export function renderChangeset(moves: readonly CatalogMove[]): string {
	const sections = byCatalog(moves).map(([catalog, group]) => {
		const heading = `### Updates ${moveSummary(catalog, group.length)}`;
		const lines = group.map((move) => `- \`${move.pkg}\` ${moveText(move)}`);
		return `${heading}\n\n${lines.join("\n")}`;
	});
	return `---\n"${PLUGIN}": patch\n---\n\n## Maintenance\n\n${sections.join("\n\n")}\n`;
}

/**
 * The commit message for a set of moves: a conventional-commit headline, a
 * blank line, then one bullet per package.
 *
 * @remarks
 * Deliberately free of backticks — the repo's commit contract allows at most
 * two inline-code spans in a body, and a per-package list would blow past that
 * instantly. The changeset is where the formatted version lives.
 */
export function renderCommitMessage(moves: readonly CatalogMove[]): string {
	const groups = byCatalog(moves);
	const headline =
		groups.length === 1 && groups[0] !== undefined
			? `chore(pnpm-plugin-effect): update ${moveSummary(groups[0][0], groups[0][1].length)}`
			: `chore(pnpm-plugin-effect): update ${moves.length} catalog version${moves.length === 1 ? "" : "s"}`;
	const body = groups.flatMap(([catalog, group]) => [
		...(groups.length === 1 ? [] : [`${catalog}:`]),
		...group.map((move) => `- ${move.pkg} ${moveText(move)}`),
	]);
	return `${headline}\n\n${body.join("\n")}\n`;
}

function configFile(root: string): string {
	return join(root, CONFIG_PATH);
}

function readConfig(root: string): string {
	const file = configFile(root);
	if (!existsSync(file)) throw new Error(`no catalog config at ${file}`);
	return readFileSync(file, "utf8");
}

// ── Membership ──────────────────────────────────────────────────────────
//
// The upgrade CLI answers one question: are the versions of the packages the
// catalog ALREADY NAMES current. It never asks whether every publishable
// package is named at all, because it walks the literal rather than the
// workspace. So a package added to the repo and not to the catalog is
// invisible to it, and `--check` reported "in sync" on a tree whose catalog
// was incomplete — a successful-looking answer to a question that was never
// evaluated.
//
// That is not hypothetical: it is how `@effected/schema-org` reached a release
// branch absent from the catalog while the gate stayed green. Membership was
// pinned only by `packages/pnpm-plugin-effect/__test__/catalog.test.ts`, so
// the tool that could see the gap was not the tool the gate ran. The gate now
// asks the question too. That test still pins the same fact independently, and
// deliberately so: it is a second pair of eyes on one rule, and the two live in
// different projects (the root tsconfig cannot see a package's files, and a
// package's rootDir cannot see the root's), so sharing one function would mean
// widening a tsconfig to buy less than the redundancy already gives.

/** The catalog whose membership is derived from the workspace. */
const MEMBERSHIP_CATALOG = "effected";

/**
 * The `@effected/*` names a catalog literal declares.
 *
 * @remarks
 * Reads `savvy.build.ts` as SOURCE TEXT, the same way the upgrade CLI does,
 * and for the same reason: the literal must stay inline at the
 * `PnpmConfigPlugin(...)` call site or the CLI's static walk cannot find it.
 * Hoisting it into an exported `const` would make it importable here and
 * invisible to the rewriter, and importing `savvy.build.ts` would run the
 * bundler.
 */
export function catalogEntries(root: string, catalog: string = MEMBERSHIP_CATALOG): ReadonlyMap<string, string> {
	const source = readConfig(root);
	const anchor = source.indexOf(`${catalog}: {`);
	// An absent catalog yields NO members rather than an error, and the caller is
	// still safe: `missingFromCatalog` subtracts members from the packages it
	// discovers, so a real config that lost its catalog reports every publishable
	// package as missing — loudly — while a fixture that declares no catalog and
	// contains no packages reports nothing. Throwing here instead would couple
	// every test of the version-sync behaviour to a concern it is not exercising.
	if (anchor === -1) return new Map();
	const packagesAt = source.indexOf("packages: {", anchor);
	if (packagesAt === -1) return new Map();

	const open = source.indexOf("{", packagesAt);
	let depth = 0;
	let close = open;
	for (let i = open; i < source.length; i++) {
		if (source[i] === "{") depth++;
		else if (source[i] === "}") {
			depth--;
			if (depth === 0) {
				close = i;
				break;
			}
		}
	}

	const body = source.slice(open + 1, close);
	const entries = new Map<string, string>();
	for (const match of body.matchAll(/"(@[^"]+)"\s*:\s*\{/g)) {
		const name = match[1];
		if (name === undefined || match.index === undefined) continue;
		// Capture the entry's own braces so a caller can assert on its VALUES —
		// `strategy` and `source` are policy, and a presence-only check cannot tell
		// a changed policy from an intact one.
		const valueOpen = body.indexOf("{", match.index);
		let depth = 0;
		let valueClose = valueOpen;
		for (let i = valueOpen; i < body.length; i++) {
			if (body[i] === "{") depth++;
			else if (body[i] === "}") {
				depth--;
				if (depth === 0) {
					valueClose = i;
					break;
				}
			}
		}
		entries.set(name, body.slice(valueOpen, valueClose + 1));
	}
	return entries;
}

/** The `@effected/*` names a catalog literal declares. */
export function catalogMembers(root: string, catalog: string = MEMBERSHIP_CATALOG): ReadonlySet<string> {
	return new Set(catalogEntries(root, catalog).keys());
}

/**
 * Every publishable package in the workspace.
 *
 * @remarks
 * Publishability is `publishConfig.access === "public"`, **never**
 * `private === false`: every source manifest in this repo is `private: true`
 * and the bundler's `publishConfig` transform produces the publishable one at
 * build time. A membership check written against `private` classifies the
 * whole kit as unpublishable and silently reports an empty set, which passes
 * every comparison it is used in.
 */
export function publishablePackages(root: string): readonly string[] {
	const dir = join(root, "packages");
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.flatMap((entry) => {
			const manifest = join(dir, entry.name, "package.json");
			if (!existsSync(manifest)) return [];
			const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
				name?: string;
				publishConfig?: { access?: string };
			};
			return parsed.publishConfig?.access === "public" && parsed.name !== undefined ? [parsed.name] : [];
		})
		.sort();
}

/**
 * Publishable packages the catalog does not name, sorted.
 *
 * @remarks
 * {@link PLUGIN} is excluded deliberately and must stay excluded: cataloguing
 * the plugin makes every rewrite bump it, invalidating the catalog and writing
 * another changeset — a release loop with no termination condition. Its
 * absence IS the termination condition.
 */
export function missingFromCatalog(root: string): readonly string[] {
	const members = catalogMembers(root);
	return publishablePackages(root).filter((name) => name !== PLUGIN && !members.has(name));
}

/** Human-readable instruction for a gap the CLI cannot close on its own. */
export function membershipFailure(missing: readonly string[]): string {
	return [
		`Catalog is missing ${missing.length} publishable package(s): ${missing.join(", ")}.`,
		"",
		"The upgrade CLI cannot add these: it walks the catalog literal, so a package",
		"that is not already in it is invisible to the sync. Add an entry by hand at the",
		`PnpmConfigPlugin(...) call site in ${CONFIG_PATH}, keeping the literal inline,`,
		'with range and peer at the package\'s next release version, strategy: "lock-minor"',
		'and source: "workspace".',
	].join("\n");
}

// ── Ripple bumps ────────────────────────────────────────────────────────
//
// The upgrade CLI resolves a `source: "workspace"` entry to its next release
// version from the package manifest plus the pending changesets. A package
// that changesets bumps only as a DEPENDENCY RIPPLE has no changeset naming
// it, so the CLI leaves it at its current version and the catalog goes stale
// the moment the release branch bumps it — reliably, on the one branch where
// the catalog matters most (effected#542).
//
// `changeset status --output` already computes the true plan, ripples
// included, so this asks it rather than reimplementing changesets' dependency
// resolution.

/** One package's next release version, as changesets computes it. */
export type ReleasePlan = ReadonlyMap<string, string>;

/** Runs `changeset status --output`. Injectable so tests need no changesets CLI. */
export type StatusRunner = (outputPath: string, cwd: string) => Promise<UpgradeResult>;

const defaultStatusRunner: StatusRunner = (outputPath, cwd) =>
	new Promise((resolve, reject) => {
		const child = spawn("pnpm", ["exec", "changeset", "status", `--output=${outputPath}`], {
			cwd,
			stdio: ["ignore", "pipe", "ignore"],
		});
		let stdout = "";
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.on("error", reject);
		child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
	});

/**
 * Every package changesets would release, and the version it would get.
 *
 * @remarks
 * Empty when there are no pending changesets — `changeset status` exits
 * non-zero in that case, which is not an error here: no changesets means no
 * ripples, so there is nothing for this to contribute.
 */
export async function releasePlan(root: string, run: StatusRunner = defaultStatusRunner): Promise<ReleasePlan> {
	const dir = mkdtempSync(join(tmpdir(), "catalog-plan-"));
	const outputPath = join(dir, "status.json");
	try {
		await run(outputPath, root);
		if (!existsSync(outputPath)) return new Map();
		const doc = JSON.parse(readFileSync(outputPath, "utf8")) as {
			releases?: { name: string; newVersion: string; type: string }[];
		};
		const plan = new Map<string, string>();
		for (const release of doc.releases ?? []) {
			// `type: "none"` entries are listed but not released; taking their
			// version would pin the catalog to a version nothing publishes.
			if (release.type !== "none") plan.set(release.name, release.newVersion);
		}
		return plan;
	} catch {
		// A plan this cannot read is not worth failing a sync over; the CLI's own
		// resolution still covers every directly-bumped package.
		return new Map();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** `lock-minor`: the peer floors the patch, so `0.4.5` advertises `^0.4.0`. */
function peerFor(version: string): string {
	const [major = "0", minor = "0"] = version.split(".");
	return `^${major}.${minor}.0`;
}

/** Catalogued packages whose entry does not name the version the plan would release. */
export function rippleMismatches(
	root: string,
	plan: ReleasePlan,
): readonly { pkg: string; from: string; to: string }[] {
	const mismatches: { pkg: string; from: string; to: string }[] = [];
	for (const [pkg, spec] of catalogEntries(root)) {
		const planned = plan.get(pkg);
		if (planned === undefined) continue;
		const range = /\brange:\s*"([^"]+)"/.exec(spec)?.[1];
		const expected = `^${planned}`;
		if (range !== undefined && range !== expected) mismatches.push({ pkg, from: range, to: expected });
	}
	return mismatches;
}

/**
 * Rewrite each mismatched entry's `range` and `peer` in place.
 *
 * @remarks
 * A targeted per-entry replacement rather than a re-render: the literal is
 * hand-maintained and inline at the `PnpmConfigPlugin(...)` call site, and the
 * upgrade CLI owns rewriting it wholesale. This only touches the two fields of
 * the entries the CLI could not see.
 */
function applyRipples(root: string, mismatches: readonly { pkg: string; from: string; to: string }[]): void {
	if (mismatches.length === 0) return;
	const file = configFile(root);
	let source = readFileSync(file, "utf8");
	for (const { pkg, to } of mismatches) {
		const at = source.indexOf(`"${pkg}": {`);
		if (at === -1) continue;
		const close = source.indexOf("}", at);
		const body = source.slice(at, close);
		const rewritten = body
			.replace(/\brange:\s*"[^"]+"/, `range: "${to}"`)
			.replace(/\bpeer:\s*"[^"]+"/, `peer: "${peerFor(to.slice(1))}"`);
		source = source.slice(0, at) + rewritten + source.slice(close);
	}
	writeFileSync(file, source);
}

/**
 * Apply the sync. Returns whether the catalog moved.
 *
 * A move is decided by comparing the config file around the CLI invocation rather than by
 * parsing the CLI's output: the file is the artifact that matters, and a diff cannot
 * disagree with it. When it moved, the changeset is written; when it did not, nothing is
 * written at all.
 */
export async function sync(options: SyncOptions = {}): Promise<boolean> {
	const root = options.root ?? DEFAULT_ROOT;
	const run = options.run ?? defaultRunner;

	// Checked BEFORE the CLI runs: a sync that upgrades versions while a package is
	// missing entirely would write a changeset and commit, reporting success for a
	// catalog that is still incomplete. Refusing here keeps "synced" meaning what a
	// reader assumes it means.
	const missing = missingFromCatalog(root);
	if (missing.length > 0) throw new Error(membershipFailure(missing));

	const before = readConfig(root);
	const { code, stdout } = await run(
		["upgrade", "savvy.build.ts", "--yes", "--json"],
		join(root, "packages/pnpm-plugin-effect"),
	);
	if (code !== 0) throw new Error(`rolldown-pnpm-config upgrade --yes exited ${code}`);

	const changed = parseChanged(stdout);
	for (const entry of changed) {
		console.log(`  ${entry.catalog}.${entry.pkg}  ${entry.from} -> ${entry.to}`);
	}

	// The CLI cannot see a package bumped only as a dependency ripple, so ask
	// changesets for the real plan and close the gap it leaves.
	const ripples = rippleMismatches(root, await releasePlan(root, options.status));
	applyRipples(root, ripples);
	for (const ripple of ripples) {
		console.log(`  effected.${ripple.pkg}  ${ripple.from} -> ${ripple.to}  (ripple)`);
	}

	if (readConfig(root) === before) return false;

	// Peers are read AFTER the rewrite, from the file the CLI just wrote.
	const moves = movesWithPeers(root, [
		...changed,
		...ripples.map((r) => ({ catalog: "effected", pkg: r.pkg, from: r.from, to: r.to })),
	]);
	writeFileSync(join(root, CHANGESET_PATH), moves.length > 0 ? renderChangeset(moves) : CHANGESET_BODY);
	writeFileSync(join(root, COMMIT_MESSAGE_PATH), renderCommitMessage(moves));
	return true;
}

/**
 * Gate mode: report drift and write nothing. Returns the CLI's exit code — 0 in sync,
 * non-zero on drift — for a caller to propagate.
 *
 * Deliberately the TEXT output, not `--json`: this is what a release gate runs, and the
 * failure message a human reads on a red check should be the drift list, not a blob.
 */
export async function check(options: SyncOptions = {}): Promise<number> {
	const root = options.root ?? DEFAULT_ROOT;
	const run = options.run ?? defaultRunner;
	const { code, stdout } = await run(
		["upgrade", "savvy.build.ts", "--check"],
		join(root, "packages/pnpm-plugin-effect"),
	);
	if (stdout !== "") process.stdout.write(stdout);

	// The CLI's verdict covers versions only. Membership is this script's to check,
	// and a green CLI over an incomplete catalog is the exact false pass this gate
	// exists to stop: both answers are correct about different questions, and only
	// one of them was being asked.
	const missing = missingFromCatalog(root);
	if (missing.length > 0) {
		process.stdout.write(`${membershipFailure(missing)}\n`);
		return code === 0 ? 1 : code;
	}

	// Ripple drift is invisible to the CLI for the same reason it is invisible
	// to the sync: no changeset names the package, so its own resolution never
	// moves it. Asking changesets for the plan is what makes this gate honest
	// on a release branch (effected#542).
	const ripples = rippleMismatches(root, await releasePlan(root, options.status));
	if (ripples.length > 0) {
		const lines = ripples.map((r) => `  ${r.pkg}  ${r.from} -> ${r.to}`).join("\n");
		process.stdout.write(
			`Catalog is behind on ${ripples.length} dependency-ripple bump(s):\n${lines}\n\nThese carry no changeset of their own, so the upgrade CLI cannot see them. Run \`pnpm catalog:sync\`.\n`,
		);
		return code === 0 ? 1 : code;
	}

	return code;
}

if (import.meta.main) {
	if (process.argv.includes("--check")) {
		// Propagate the gate's verdict: non-zero is drift, and the caller is a CI gate.
		process.exitCode = await check();
	} else {
		try {
			const changed = await sync();
			console.log(changed ? `Catalog synced; wrote ${CHANGESET_PATH}` : "Catalog already in sync; nothing written");
		} catch (error) {
			// A membership gap is an actionable instruction, not a crash. A stack trace
			// buries the one line telling the reader which package to add and where.
			process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
			process.exitCode = 1;
		}
	}
}
