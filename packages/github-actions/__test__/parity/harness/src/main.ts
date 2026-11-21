import { Git } from "@effected/git";
import { Config, Effect, FileSystem, Option, Path } from "effect";
import { Action } from "../../../../src/Action.js";
import { ActionEnvironment } from "../../../../src/ActionEnvironment.js";
import { ActionInput } from "../../../../src/ActionInput.js";
import { ActionOutputs } from "../../../../src/ActionOutputs.js";
import { ActionState } from "../../../../src/ActionState.js";
import { Checkout } from "../../../../src/Checkout.js";
import { CredentialRecord } from "../../../../src/internal/checkout/credentials.js";
import {
	cleanSnapshot,
	credentialLeftovers,
	diff,
	diffClean,
	snapshot,
	tempLeftovers,
	withoutStockLeftovers,
} from "./compare.js";
import { RECORD_FILE, fromFile, teeing } from "./record.js";

/** The state file the checkout step writes and the cleanup and compare-clean steps read. */
const recordFile = Effect.gen(function* () {
	const env = yield* ActionEnvironment;
	const path = yield* Path.Path;
	return path.join(yield* env.get("RUNNER_TEMP"), RECORD_FILE);
});

/**
 * The kit's checkout: the inputs the stock action reads, then the outputs it writes. What it saves for its post entry
 * is also written to the record file, for the cleanup step.
 */
const run = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const state = yield* ActionState;
	const file = yield* recordFile;
	const options = yield* Checkout.fromInputs();
	const result = yield* Checkout.checkout(options).pipe(Effect.provideService(ActionState, teeing(state, fs, file)));
	yield* Checkout.writeOutputs(result);
});

/** The kit's post-step cleanup, `Checkout.cleanup` itself, reading the record the checkout step saved. */
const cleanup = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const file = yield* recordFile;
	yield* Checkout.cleanup().pipe(Effect.provideService(ActionState, fromFile(fs, file)));
});

/**
 * Both checkouts after their own cleanup, snapshotted and diffed. Any difference, and any credential config or
 * `RUNNER_TEMP` credential material either side left behind, fails the step, except the submodule `insteadOf` values
 * the stock post step is known to leave, which are set aside and listed in the summary. With `official-cleaned` false the stock
 * action's cleanup was not observed: only the kit's side is checked, against the clean shape, and only for the files
 * its record names.
 */
const compareClean = Effect.gen(function* () {
	const env = yield* ActionEnvironment;
	const outputs = yield* ActionOutputs;
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const workspace = (yield* env.github).workspace;
	const runnerTemp = yield* env.get("RUNNER_TEMP");
	const official = path.resolve(workspace, yield* ActionInput.string("official"));
	const kit = path.resolve(workspace, yield* ActionInput.string("kit"));
	const observed = (yield* ActionInput.string("official-cleaned").pipe(Config.withDefault("true"))) === "true";

	const b = yield* cleanSnapshot(kit, path.relative(workspace, kit));
	const problems: Array<string> = [...credentialLeftovers("kit", b)];
	let exempt: ReadonlyArray<string> = [];
	if (observed) {
		const split = withoutStockLeftovers(yield* cleanSnapshot(official, path.relative(workspace, official)));
		const a = split.held;
		exempt = split.exempt;
		problems.push(...diffClean(a, b), ...credentialLeftovers("official", a));
		problems.push(...(yield* tempLeftovers(runnerTemp)).map((name) => `RUNNER_TEMP: left behind: ${name}`));
	} else {
		const record = yield* fromFile(fs, yield* recordFile).getOptional("effected-checkout", CredentialRecord);
		if (Option.isSome(record)) {
			const files = [record.value.credentialsFile, record.value.sshKeyPath, record.value.knownHostsPath];
			for (const file of files) {
				if (Option.isSome(file) && (yield* fs.exists(file.value))) {
					problems.push(`RUNNER_TEMP: kit left behind: ${path.basename(file.value)}`);
				}
			}
		}
	}

	const scope = observed ? "the official and kit cleanups agree" : "the kit cleanup is clean (official not observed)";
	// The stock leftover is reported, never failed, so a run shows what was set aside; a submodule case where the
	// stock post step left none means it now removes them, and the exemption in `withoutStockLeftovers` can go.
	const note =
		exempt.length > 0
			? `\nKnown stock leftovers, set aside (the kit removes them):\n\n${exempt.map((line) => `- \`${line}\``).join("\n")}\n`
			: "";
	if (problems.length === 0) {
		yield* outputs.summary(`Parity after cleanup: ${scope}.\n${note}`);
		return;
	}
	yield* outputs.summary(`## Parity after cleanup failed\n\n${problems.map((line) => `- \`${line}\``).join("\n")}\n`);
	return yield* Effect.fail(new Error(`${problems.length} problem(s) after cleanup:\n${problems.join("\n")}`));
});

/** Both checkouts snapshotted and diffed; any difference fails the step and lands in the summary. */
const compare = Effect.gen(function* () {
	const env = yield* ActionEnvironment;
	const outputs = yield* ActionOutputs;
	const path = yield* Path.Path;
	const workspace = (yield* env.github).workspace;
	const officialPath = yield* ActionInput.string("official");
	const kitPath = yield* ActionInput.string("kit");
	const official = path.resolve(workspace, officialPath);
	const kit = path.resolve(workspace, kitPath);
	// The workspace-relative paths name each checkout in its container includeIf keys.
	const [a, b] = [
		yield* snapshot(official, path.relative(workspace, official)),
		yield* snapshot(kit, path.relative(workspace, kit)),
	];
	const differences = diff(a, b);
	if (differences.length === 0) {
		yield* outputs.summary("Parity: the official and kit checkouts agree.\n");
		return;
	}
	const block = (label: string, value: unknown) =>
		`<details><summary>${label}</summary>\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n\n</details>\n`;
	yield* outputs.summary(
		`## Parity failed\n\n${differences.map((line) => `- \`${line}\``).join("\n")}\n\n${block("official", a)}\n${block("kit", b)}`,
	);
	return yield* Effect.fail(new Error(`${differences.length} difference(s):\n${differences.join("\n")}`));
});

const program = Effect.gen(function* () {
	const mode = yield* ActionInput.string("mode").pipe(Config.withDefault("checkout"));
	if (mode === "compare") return yield* compare;
	if (mode === "cleanup") return yield* cleanup;
	if (mode === "compare-clean") return yield* compareClean;
	return yield* run;
});

await Action.run(Effect.scoped(program), { layer: Git.layer });
