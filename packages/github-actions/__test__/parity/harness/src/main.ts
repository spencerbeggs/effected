import { Git } from "@effected/git";
import { Config, Effect, Path } from "effect";
import { Action } from "../../../../src/Action.js";
import { ActionEnvironment } from "../../../../src/ActionEnvironment.js";
import { ActionInput } from "../../../../src/ActionInput.js";
import { ActionOutputs } from "../../../../src/ActionOutputs.js";
import { Checkout } from "../../../../src/Checkout.js";
import { diff, snapshot } from "./compare.js";

/** The kit's checkout: the inputs the stock action reads, then the outputs it writes. */
const run = Effect.gen(function* () {
	const options = yield* Checkout.fromInputs();
	const result = yield* Checkout.checkout(options);
	yield* Checkout.writeOutputs(result);
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
	return yield* run;
});

await Action.run(Effect.scoped(program), { layer: Git.layer });
