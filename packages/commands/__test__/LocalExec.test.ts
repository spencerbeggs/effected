import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { ChildProcess } from "effect/unstable/process";
import { ExecContext, LocalExec, LocalExecError } from "../src/LocalExec.js";

/** The argv a command would actually spawn with. */
const argv = (command: ChildProcess.Command): ReadonlyArray<string> => {
	if (!ChildProcess.isStandardCommand(command)) {
		throw new Error("expected a standard command");
	}
	return [command.command, ...command.args];
};

describe("LocalExec.prefixes", () => {
	it("knows each package manager's exec and dlx argv", () => {
		assert.deepStrictEqual(LocalExec.prefixes("pnpm"), { prefix: ["pnpm", "exec"], dlxPrefix: ["pnpm", "dlx"] });
		assert.deepStrictEqual(LocalExec.prefixes("npm"), { prefix: ["npx", "--no", "--"], dlxPrefix: ["npx"] });
		assert.deepStrictEqual(LocalExec.prefixes("yarn"), { prefix: ["yarn", "exec"], dlxPrefix: ["yarn", "dlx"] });
		assert.deepStrictEqual(LocalExec.prefixes("bun"), {
			prefix: ["bun", "x", "--no-install"],
			dlxPrefix: ["bun", "x"],
		});
	});
});

describe("ExecContext", () => {
	const context = ExecContext.make({
		label: "pnpm",
		prefix: ["pnpm", "exec"],
		dlxPrefix: ["pnpm", "dlx"],
		directory: "/repo",
	});

	it("prefixes a command and applies the directory", () => {
		const applied = context.apply(ChildProcess.make("biome", ["--version"]));
		assert.deepStrictEqual(argv(applied), ["pnpm", "exec", "biome", "--version"]);
		if (!ChildProcess.isStandardCommand(applied)) assert.fail("expected a standard command");
		assert.strictEqual(applied.options.cwd, "/repo");
	});

	it("applyDlx uses the dlx prefix", () => {
		const applied = context.applyDlx(ChildProcess.make("biome", ["--version"]));
		assert.deepStrictEqual(argv(applied), ["pnpm", "dlx", "biome", "--version"]);
	});

	it("leaves cwd unset when the context carries no directory", () => {
		const anywhere = ExecContext.make({ label: "npm", prefix: ["npx", "--no", "--"], dlxPrefix: ["npx"] });
		const applied = anywhere.apply(ChildProcess.make("biome", []));
		if (!ChildProcess.isStandardCommand(applied)) assert.fail("expected a standard command");
		assert.strictEqual(applied.options.cwd, undefined);
		assert.deepStrictEqual(argv(applied), ["npx", "--no", "--", "biome"]);
	});

	it("does not mutate the command it is given", () => {
		const original = ChildProcess.make("biome", ["check"]);
		context.apply(original);
		assert.deepStrictEqual(argv(original), ["biome", "check"]);
	});
});

describe("LocalExec layers", () => {
	it.effect("layerNone answers None — the global-only wiring", () =>
		Effect.gen(function* () {
			const local = yield* LocalExec;
			const context = yield* local.context;
			assert.isTrue(Option.isNone(context));
		}).pipe(Effect.provide(LocalExec.layerNone)),
	);

	it.effect("layerFor answers a context built from the static prefix table", () =>
		Effect.gen(function* () {
			const local = yield* LocalExec;
			const context = yield* local.context;
			if (Option.isNone(context)) assert.fail("expected a context");
			assert.strictEqual(context.value.label, "pnpm");
			assert.deepStrictEqual(argv(context.value.apply(ChildProcess.make("biome", []))), ["pnpm", "exec", "biome"]);
		}).pipe(Effect.provide(LocalExec.layerFor("pnpm", { directory: "/repo" }))),
	);

	it.effect("layerContext answers a caller-supplied context verbatim", () =>
		Effect.gen(function* () {
			const local = yield* LocalExec;
			const context = yield* local.context;
			if (Option.isNone(context)) assert.fail("expected a context");
			assert.strictEqual(context.value.label, "custom");
		}).pipe(
			Effect.provide(
				LocalExec.layerContext(ExecContext.make({ label: "custom", prefix: ["run"], dlxPrefix: ["fetch"] })),
			),
		),
	);

	it.effect("layerTest defaults to None and accepts an override", () =>
		Effect.gen(function* () {
			const local = yield* LocalExec;
			assert.isTrue(Option.isNone(yield* local.context));
		}).pipe(Effect.provide(LocalExec.layerTest())),
	);

	it.effect("layerTest can answer a failure, so consumers can exercise the error path", () =>
		Effect.gen(function* () {
			const local = yield* LocalExec;
			const error = yield* Effect.flip(local.context);
			assert.instanceOf(error, LocalExecError);
		}).pipe(Effect.provide(LocalExec.layerTest({ context: Effect.fail(new LocalExecError({})) }))),
	);
});
