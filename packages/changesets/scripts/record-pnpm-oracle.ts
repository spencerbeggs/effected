// Records the pnpm-native release-planning oracle into
// __test__/fixtures/pnpm-native/<case>/. Never shipped: it exists so the
// committed answers can be re-derived after a pnpm re-pin. Run from the package
// directory: `node scripts/record-pnpm-oracle.ts [case ...]` (no argument
// records every case). The method is in __test__/fixtures/pnpm-native/README.md.
//
// pnpm has no JSON plan, so each case is APPLIED, never dry-run: the fixture is
// copied to a throwaway directory outside this repository (so pnpm never climbs
// into this workspace), `pnpm change status` is run for the per-project causes,
// then `pnpm version -r --json` for the versions, and the answers are written
// back beside the fixture. The registry is pointed at an unreachable address, so
// nothing ever reaches a real one.

import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PLAN_LINE, containedPath } from "./oracleSupport.ts";

const PACKAGE = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FIXTURES = join(PACKAGE, "__test__/fixtures/pnpm-native");
const RECORDED = new Set(["expected.json", "status.txt", "ledger.after.yaml", "prelude.json"]);

/**
 * A case may carry `prelude.json`, `{ "steps": [...] }`, that pnpm-built state is
 * made of: each step is `{ "run": [pnpm args] }`, `{ "write": { "path", "content" } }`
 * or `{ "remove": "path" }`. The prelude runs in the scratch copy before the recorded
 * `status` and `version`, so a pre-state that a real workflow produces is produced by
 * pnpm, not typed by hand.
 */
type Step =
	| { readonly run: ReadonlyArray<string> }
	| { readonly write: { readonly path: string; readonly content: string } }
	| { readonly remove: string };

interface Run {
	readonly exitCode: number;
	readonly output: string;
}

const EXPECTED_PNPM = "12.20.0";

/**
 * The pnpm this repository pins, by absolute path. A bare `pnpm` run outside the
 * repository is the global one, which may be another version, so the pinned binary
 * is asked for by path from inside the package. Anything but an existing absolute
 * path to the expected version fails, naming what was found.
 */
const pinnedPnpm = (): string => {
	const result = spawnSync("pnpm", ["exec", "node", "-p", "process.env.npm_execpath"], {
		cwd: PACKAGE,
		encoding: "utf8",
	});
	const path = result.stdout.trim();
	if (result.status !== 0 || !isAbsolute(path) || !existsSync(path)) {
		throw new Error(
			`cannot resolve the pinned pnpm: npm_execpath was ${JSON.stringify(path)} (exit ${result.status}) ${result.stderr}`,
		);
	}
	const version = spawnSync(path, ["--version"], { cwd: tmpdir(), encoding: "utf8" }).stdout.trim();
	if (version !== EXPECTED_PNPM) {
		throw new Error(`the pinned pnpm at ${path} is ${JSON.stringify(version)}, expected ${EXPECTED_PNPM}`);
	}
	return path;
};

let PNPM = "";

const run = (cwd: string, home: string, args: ReadonlyArray<string>): Run => {
	const env: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (!/^(npm_|pnpm_)/i.test(key) && value !== undefined) env[key] = value;
	}
	env.HOME = home;
	env.XDG_CONFIG_HOME = join(home, ".config");
	env.XDG_CACHE_HOME = join(home, ".cache");
	env.XDG_DATA_HOME = join(home, ".local/share");
	env.XDG_STATE_HOME = join(home, ".local/state");
	// Unreachable on purpose: no case may contact a real registry.
	env.npm_config_registry = "http://127.0.0.1:9/";
	const result = spawnSync(PNPM, [...args], { cwd, env, encoding: "utf8" });
	return { exitCode: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
};

/**
 * pnpm wraps its messages in a box and names the throwaway workspace in them, and a
 * wrap can fall inside the path. Match the path with optional wrap debris between
 * characters, then unwrap the rest, so the committed message does not depend on the
 * temp directory.
 */
const normalise = (text: string, workspace: string): string => {
	const gap = "(?:\\s*\\u2502?\\s*)?";
	const path = [...workspace].map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(gap);
	return text
		.replace(new RegExp(path, "g"), "<workspace>")
		.replace(/\n\s*\u2502\s*/g, " ")
		.trim();
};

const errorOf = (stage: string, result: Run, workspace: string) => ({
	stage,
	exitCode: result.exitCode,
	code: /ERR_PNPM_[A-Z0-9_]+/.exec(result.output)?.[0] ?? null,
	message: normalise(result.output, workspace),
});

const parseStatus = (text: string) => {
	const releases: Array<{
		name: string;
		currentVersion: string;
		newVersion: string;
		bump: string;
		causes: Array<string>;
	}> = [];
	const unparsed: Array<string> = [];
	let inPlan = false;
	for (const line of text.split("\n")) {
		if (line.startsWith("Release plan:")) {
			inPlan = true;
			continue;
		}
		if (!inPlan || line.trim() === "") continue;
		const match = PLAN_LINE.exec(line);
		if (match === null) {
			unparsed.push(line);
			continue;
		}
		releases.push({
			name: match[1] as string,
			currentVersion: match[2] as string,
			newVersion: match[3] as string,
			bump: match[4] as string,
			causes: (match[5] as string).split("+"),
		});
	}
	return { releases, unparsed };
};

const recordCase = (name: string, pnpmVersion: string): void => {
	const source = join(FIXTURES, name);
	const scratch = realpathSync(mkdtempSync(join(tmpdir(), "pnpm-oracle-")));
	try {
		const work = join(scratch, "workspace");
		const home = join(scratch, "home");
		mkdirSync(home);
		cpSync(source, work, { recursive: true, filter: (path) => !RECORDED.has(path.slice(source.length + 1)) });

		const preludePath = join(source, "prelude.json");
		if (existsSync(preludePath)) {
			const { steps } = JSON.parse(readFileSync(preludePath, "utf8")) as { steps: ReadonlyArray<Step> };
			for (const step of steps) {
				if ("run" in step) {
					const result = run(work, home, step.run);
					if (result.exitCode !== 0) throw new Error(`prelude step ${step.run.join(" ")} failed: ${result.output}`);
				} else if ("write" in step) {
					writeFileSync(containedPath(work, step.write.path), step.write.content);
				} else {
					rmSync(containedPath(work, step.remove), { force: true });
				}
			}
		}

		const status = run(work, home, ["change", "status"]);
		const version = run(work, home, ["version", "-r", "--json"]);

		let applied: ReadonlyArray<{ name: string; currentVersion: string; newVersion: string }> | null = null;
		if (version.exitCode === 0) {
			const start = version.output.indexOf("[");
			applied = JSON.parse(version.output.slice(start));
		}
		const plan = status.exitCode === 0 ? parseStatus(status.output) : { releases: [], unparsed: [] };
		const bumps = new Map(plan.releases.map((release) => [release.name, release]));
		const releases = (applied ?? []).map((release) => ({
			name: release.name,
			currentVersion: release.currentVersion,
			newVersion: release.newVersion,
			bump: bumps.get(release.name)?.bump ?? null,
			causes: bumps.get(release.name)?.causes ?? [],
		}));
		const ledgerPath = join(work, ".changeset/ledger.yaml");
		const ledger = version.exitCode === 0 && existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : null;

		const expected = {
			pnpmVersion,
			case: name,
			outcome: version.exitCode === 0 ? "applied" : "rejected",
			releases,
			ledgerFile: ledger === null ? null : "ledger.after.yaml",
			statusFile: "status.txt",
			statusUnparsed: plan.unparsed,
			errors: [
				...(status.exitCode === 0 ? [] : [errorOf("status", status, work)]),
				...(version.exitCode === 0 ? [] : [errorOf("version", version, work)]),
			],
		};
		writeFileSync(join(source, "status.txt"), `${normalise(status.output, work)}\n`);
		if (ledger === null) rmSync(join(source, "ledger.after.yaml"), { force: true });
		else writeFileSync(join(source, "ledger.after.yaml"), ledger);
		writeFileSync(join(source, "expected.json"), `${JSON.stringify(expected, null, "\t")}\n`);
		console.log(`${name}: ${expected.outcome}${expected.errors.map((e) => ` ${e.stage}:${e.code}`).join("")}`);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
};

const main = (): number => {
	PNPM = pinnedPnpm();
	const pnpmVersion = EXPECTED_PNPM;
	const requested = process.argv.slice(2);
	const cases = readdirSync(FIXTURES, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.filter((name) => requested.length === 0 || requested.includes(name))
		.sort();
	let failures = 0;
	for (const name of cases) {
		try {
			recordCase(name, pnpmVersion);
		} catch (error) {
			failures += 1;
			console.error(`${name}: FAILED ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return failures;
};

process.exitCode = main() === 0 ? 0 : 1;
