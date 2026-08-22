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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

/** Fixed name: repeated runs overwrite one changeset rather than accumulating many. */
export const CHANGESET_PATH = ".changeset/catalog-sync.md";

/** The config file the CLI rewrites, relative to the repository root. */
export const CONFIG_PATH = "packages/pnpm-plugin-effect/savvy.build.ts";

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
	return code;
}

if (import.meta.main) {
	if (process.argv.includes("--check")) {
		// Propagate the gate's verdict: non-zero is drift, and the caller is a CI gate.
		process.exitCode = await check();
	} else {
		const changed = await sync();
		console.log(changed ? `Catalog synced; wrote ${CHANGESET_PATH}` : "Catalog already in sync; nothing written");
	}
}
