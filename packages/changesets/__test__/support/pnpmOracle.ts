import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { VersioningConfig } from "@effected/pnpm";
import { WorkspacePackage } from "@effected/workspaces";
import { Yaml } from "@effected/yaml";
import { Result, Schema } from "effect";
import { ChangesetFile } from "../../src/ChangesetFile.js";
import { Ledger, LedgerEntry } from "../../src/Ledger.js";
import { PendingChangeset } from "../../src/PendingChangesets.js";

/**
 * The pnpm-native oracle fixtures (`__test__/fixtures/pnpm-native/`), decoded
 * with schemas, never cast. `expected.json`'s shape is the recorder's
 * (`scripts/record-pnpm-oracle.ts`), documented in the fixtures' README.
 */

export const ROOT = new URL("../fixtures/pnpm-native/", import.meta.url).pathname;

const Bump = Schema.Literals(["patch", "minor", "major"]);
export const Cause = Schema.Literals(["intent", "dependencies", "fixed", "epic"]);

export const ExpectedRelease = Schema.Struct({
	name: Schema.String,
	currentVersion: Schema.String,
	newVersion: Schema.String,
	bump: Schema.NullOr(Bump),
	causes: Schema.Array(Cause),
});

export const ExpectedError = Schema.Struct({
	stage: Schema.Literals(["status", "version"]),
	exitCode: Schema.Number,
	code: Schema.NullOr(Schema.String),
	message: Schema.String,
});

export const Expected = Schema.Struct({
	pnpmVersion: Schema.String,
	case: Schema.String,
	outcome: Schema.Literals(["applied", "rejected"]),
	releases: Schema.Array(ExpectedRelease),
	ledgerFile: Schema.NullOr(Schema.String),
	statusFile: Schema.String,
	statusUnparsed: Schema.Array(Schema.String),
	errors: Schema.Array(ExpectedError),
});
export type Expected = typeof Expected.Type;

const PreludeStep = Schema.Union([
	Schema.Struct({ run: Schema.Array(Schema.String) }),
	Schema.Struct({ write: Schema.Struct({ path: Schema.String, content: Schema.String }) }),
	Schema.Struct({ remove: Schema.String }),
]);
type PreludeStep = typeof PreludeStep.Type;
const Prelude = Schema.Struct({ steps: Schema.Array(PreludeStep) });

const Manifest = Schema.Struct({
	name: Schema.optionalKey(Schema.String),
	version: Schema.optionalKey(Schema.String),
	private: Schema.optionalKey(Schema.Boolean),
	dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	devDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	peerDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
	optionalDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

const WorkspaceFile = Schema.Struct({
	packages: Schema.optionalKey(Schema.Array(Schema.String)),
	versioning: Schema.optionalKey(Schema.NullOr(VersioningConfig)),
});

/** Read a JSON file through its schema: one codec parses the text and decodes it. */
const decodeJson = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, path: string): S["Type"] =>
	Schema.decodeUnknownSync(Schema.fromJsonString(schema))(readFileSync(path, "utf8"));

/** Every recorded case, by directory name. */
export const caseNames = (): ReadonlyArray<string> =>
	readdirSync(ROOT, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();

/** The case's `expected.json`, decoded. */
export const loadExpected = (name: string): Expected => decodeJson(Expected, join(ROOT, name, "expected.json"));

/** pnpm's ledger after the recorded run, when the case has one. */
export const loadLedgerAfter = (name: string, expected: Expected): Ledger | undefined => {
	if (expected.ledgerFile === null) return undefined;
	const parsed = Ledger.parseResult(readFileSync(join(ROOT, name, expected.ledgerFile), "utf8"));
	if (Result.isFailure(parsed)) throw new Error(`${name}: ledger.after does not parse: ${parsed.failure.message}`);
	return parsed.success;
};

/**
 * A fixture's workspace as the pure planner takes it, mutable so a prelude can
 * move it forward the way pnpm moved the recorder's scratch copy.
 */
export interface OracleWorkspace {
	packages: Array<WorkspacePackage>;
	changesets: Array<PendingChangeset>;
	versioning: VersioningConfig | undefined;
	ledger: Array<LedgerEntry>;
}

const toPackage = (root: string, relativePath: string): WorkspacePackage | undefined => {
	const dir = relativePath === "." ? root : join(root, relativePath);
	const packageJsonPath = join(dir, "package.json");
	if (!existsSync(packageJsonPath)) return undefined;
	const manifest = decodeJson(Manifest, packageJsonPath);
	if (manifest.name === undefined) return undefined;
	return WorkspacePackage.make({
		name: manifest.name,
		...(manifest.version === undefined ? {} : { version: manifest.version }),
		private: manifest.private ?? false,
		path: dir,
		packageJsonPath,
		relativePath,
		workspaceRoot: root,
		dependencies: manifest.dependencies ?? {},
		devDependencies: manifest.devDependencies ?? {},
		peerDependencies: manifest.peerDependencies ?? {},
		optionalDependencies: manifest.optionalDependencies ?? {},
	});
};

const parseChangeset = (file: string, text: string): PendingChangeset => {
	const parsed = ChangesetFile.parseSync(text);
	if (Result.isFailure(parsed)) throw new Error(`${file}: ${parsed.failure.message}`);
	return PendingChangeset.make({ file, releases: parsed.success.releases, summary: parsed.success.summary });
};

const parseWorkspaceFile = (path: string): typeof WorkspaceFile.Type => {
	const yaml = Yaml.parseResult(readFileSync(path, "utf8"));
	if (Result.isFailure(yaml)) throw new Error(`${path}: ${yaml.failure.message}`);
	return Schema.decodeUnknownSync(WorkspaceFile)(yaml.success);
};

/**
 * The case's input, read from disk: the root and every `packages/*` project
 * (the only pattern the cases use), the `.changeset/*.md` intents, the decoded
 * `versioning` block and the input ledger, if any.
 */
export const loadWorkspace = (name: string): OracleWorkspace => {
	const root = join(ROOT, name);
	const workspace = parseWorkspaceFile(join(root, "pnpm-workspace.yaml"));
	const patterns = workspace.packages ?? [];
	if (patterns.some((pattern) => pattern !== "packages/*")) throw new Error(`${name}: unsupported package pattern`);
	const members = existsSync(join(root, "packages"))
		? readdirSync(join(root, "packages"), { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => `packages/${entry.name}`)
				.sort()
		: [];
	const packages = [".", ...members].flatMap((relative) => {
		const pkg = toPackage(root, relative);
		return pkg === undefined ? [] : [pkg];
	});
	const changesetDir = join(root, ".changeset");
	const changesets = existsSync(changesetDir)
		? readdirSync(changesetDir)
				.filter((file) => file.endsWith(".md") && file.toLowerCase() !== "readme.md")
				.sort()
				.map((file) => parseChangeset(file, readFileSync(join(changesetDir, file), "utf8")))
		: [];
	const ledgerPath = join(changesetDir, "ledger.yaml");
	let ledger: Array<LedgerEntry> = [];
	if (existsSync(ledgerPath)) {
		const parsed = Ledger.parseResult(readFileSync(ledgerPath, "utf8"));
		if (Result.isFailure(parsed)) throw new Error(`${name}: input ledger does not parse`);
		ledger = [...parsed.success.entries];
	}
	return { packages, changesets, versioning: workspace.versioning ?? undefined, ledger };
};

/** The case's `prelude.json` steps; empty when it has none. */
export const loadPrelude = (name: string): ReadonlyArray<PreludeStep> => {
	const path = join(ROOT, name, "prelude.json");
	return existsSync(path) ? decodeJson(Prelude, path).steps : [];
};

/** What one applied `pnpm version -r` wrote, as {@link applyRelease} needs it. */
export interface AppliedRelease {
	readonly name: string;
	readonly dir: string;
	readonly newVersion: string;
	readonly intents: ReadonlyArray<string>;
}

/**
 * Apply a plan to the model the way `pnpm version -r` writes it
 * (`crates/versioning/src/apply.rs`): each release's manifest takes its new
 * version (`write_new_versions`, apply.rs:197), and each release that consumed
 * intents appends `name@new: { dir, intents }` with the ids sorted
 * (`ledger_entries`, apply.rs:235). Intent files are left in place: none of the
 * preludes reaches `remove_consumed_intents` (apply.rs:273), because each one
 * consumes only on a lane, which keeps the file.
 */
export const applyRelease = (workspace: OracleWorkspace, releases: ReadonlyArray<AppliedRelease>): void => {
	for (const release of releases) {
		workspace.packages = workspace.packages.map((pkg) =>
			pkg.relativePath === release.dir ? WorkspacePackage.make({ ...pkg, version: release.newVersion }) : pkg,
		);
		if (release.intents.length === 0) continue;
		workspace.ledger.push(
			LedgerEntry.make({
				name: release.name,
				version: release.newVersion,
				dir: release.dir,
				intents: [...release.intents].sort(),
			}),
		);
	}
};

/**
 * Run one prelude step against the model. `version -r` plans with `plan` and
 * applies the answer; `lane main --filter <pkg>` drops the package's lane, as
 * `clear_lanes` (crates/cli/src/cli_args/lane.rs:168) does; `write` and
 * `remove` add or drop an intent file.
 */
export const runStep = (
	workspace: OracleWorkspace,
	step: PreludeStep,
	plan: (workspace: OracleWorkspace) => ReadonlyArray<AppliedRelease>,
): void => {
	if ("write" in step) {
		const file = step.write.path.replace(/^\.changeset\//, "");
		workspace.changesets = [
			...workspace.changesets.filter((c) => c.file !== file),
			parseChangeset(file, step.write.content),
		].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
		return;
	}
	if ("remove" in step) {
		const file = step.remove.replace(/^\.changeset\//, "");
		workspace.changesets = workspace.changesets.filter((c) => c.file !== file);
		return;
	}
	const [command, ...args] = step.run;
	if (command === "version" && args.join(" ") === "-r") {
		applyRelease(workspace, plan(workspace));
		return;
	}
	if (command === "lane" && args[0] === "main" && args[1] === "--filter" && args[2] !== undefined) {
		const target = args[2];
		const lanes = Object.fromEntries(
			Object.entries(workspace.versioning?.lanes ?? {}).filter(([key]) => key !== target),
		);
		workspace.versioning = VersioningConfig.make({ ...workspace.versioning, lanes });
		return;
	}
	throw new Error(`prelude step ${step.run.join(" ")} is not modelled`);
};

/** The ledger as a comparable set of `key dir [ids]` strings. */
export const ledgerLines = (entries: ReadonlyArray<LedgerEntry>): ReadonlyArray<string> =>
	entries
		.map((entry) => `${entry.name}@${entry.version} ${entry.dir ?? "-"} [${[...entry.intents].sort().join(",")}]`)
		.sort();
