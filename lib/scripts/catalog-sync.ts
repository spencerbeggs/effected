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
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
}

/** The package whose build config carries the catalog, and which the changeset bumps. */
export const PLUGIN = "@effected/pnpm-plugin-effect";

/** The config file the CLI rewrites, relative to the repository root. */
export const CONFIG_PATH = "packages/pnpm-plugin-effect/savvy.build.ts";

/** Fixed name: repeated runs overwrite one changeset rather than accumulating many. */
export const CHANGESET_PATH = ".changeset/catalog-sync.md";

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
	if (anchor === -1) throw new Error(`no \`${catalog}\` catalog declared in ${CONFIG_PATH}`);
	const packagesAt = source.indexOf("packages: {", anchor);
	if (packagesAt === -1) throw new Error(`\`${catalog}\` catalog has no packages map in ${CONFIG_PATH}`);

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

	for (const entry of parseChanged(stdout)) {
		console.log(`  ${entry.catalog}.${entry.pkg}  ${entry.from} -> ${entry.to}`);
	}

	if (readConfig(root) === before) return false;

	writeFileSync(join(root, CHANGESET_PATH), CHANGESET_BODY);
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
