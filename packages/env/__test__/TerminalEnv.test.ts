import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Option, Stdio, Terminal } from "effect";
import type { ColorLevel } from "../src/TerminalEnv.js";
import { TerminalEnv } from "../src/TerminalEnv.js";

const withEnv = (env: Record<string, string>) =>
	Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(env));

const stdio = (opts: { readonly stdin?: boolean; readonly stdout: boolean }) =>
	Stdio.layerTest({
		stdinIsTerminal: Effect.succeed(opts.stdin ?? opts.stdout),
		stdoutIsTerminal: Effect.succeed(opts.stdout),
	});

const terminal = (columns: number) =>
	Layer.succeed(
		Terminal.Terminal,
		Terminal.make({
			columns: Effect.succeed(columns),
			rows: Effect.succeed(24),
			readInput: Effect.die("unused"),
			readLine: Effect.die("unused"),
			display: () => Effect.void,
		}),
	);

/** Provide the platform doubles and the environment, build `TerminalEnv.layer`, and read the service. */
const read = <A>(
	env: Record<string, string>,
	io: { readonly stdin?: boolean; readonly stdout: boolean; readonly columns?: number },
	use: (terminalEnv: TerminalEnv["Service"]) => A,
	options?: Parameters<typeof TerminalEnv.layer>[0],
) =>
	Effect.gen(function* () {
		return use(yield* TerminalEnv);
	}).pipe(
		Effect.provide(TerminalEnv.layer(options)),
		Effect.provide(Layer.mergeAll(stdio(io), terminal(io.columns ?? 0))),
		withEnv(env),
	);

describe("TerminalEnv.layer", () => {
	it.effect("a TTY stdout with TERM=xterm-256color has 256 colours", () =>
		Effect.map(
			read({ TERM: "xterm-256color" }, { stdout: true }, (t) => t.stdout.color),
			(color) => assert.strictEqual(color, "256"),
		),
	);

	it.effect("a non-TTY stdout under a hyperlink-capable terminal has no hyperlinks and no colour", () =>
		Effect.map(
			read({ TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "3.5.0" }, { stdout: false }, (t) => t.stdout),
			(stream) => {
				assert.strictEqual(stream.isTerminal, false);
				assert.strictEqual(stream.hyperlinks, false);
				assert.strictEqual(stream.color, "none");
			},
		),
	);

	it.effect("a TTY stdout under iTerm 3.5.0 has hyperlinks", () =>
		Effect.map(
			read({ TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "3.5.0" }, { stdout: true }, (t) => t.stdout.hyperlinks),
			(hyperlinks) => assert.strictEqual(hyperlinks, true),
		),
	);

	it.effect("stdinIsTerminal is read from Stdio independently of stdout", () =>
		Effect.map(
			read({}, { stdin: true, stdout: false }, (t) => t.stdinIsTerminal),
			(stdin) => assert.strictEqual(stdin, true),
		),
	);

	it.effect("stderr mirrors stdout when stderrIsTerminal is omitted", () =>
		Effect.map(
			read({ TERM: "xterm-256color" }, { stdout: true }, (t) => t.stderr),
			(stderr) => {
				assert.strictEqual(stderr.isTerminal, true);
				assert.strictEqual(stderr.color, "256");
			},
		),
	);

	it.effect("stderrIsTerminal false gives stderr no colour while stdout keeps it", () =>
		Effect.map(
			read(
				{ TERM: "xterm-256color", TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "3.5.0" },
				{ stdout: true },
				(t) => t,
				{ stderrIsTerminal: Effect.succeed(false) },
			),
			(t) => {
				// Node's table reads TERM_PROGRAM (iTerm 3.5 → truecolor) before TERM.
				assert.strictEqual(t.stdout.color, "truecolor");
				assert.strictEqual(t.stderr.isTerminal, false);
				assert.strictEqual(t.stderr.color, "none");
				assert.strictEqual(t.stderr.hyperlinks, false);
				assert.strictEqual(t.stdout.hyperlinks, true);
			},
		),
	);

	it.effect("Terminal.columns 0 is None and width() is 80", () =>
		Effect.map(
			read({}, { stdout: true, columns: 0 }, (t) => [t.stdout.columns, t.width()] as const),
			([columns, width]) => {
				assert.deepStrictEqual(columns, Option.none());
				assert.strictEqual(width, 80);
			},
		),
	);

	it.effect("with no columns, COLUMNS supplies the width, then the fallback", () =>
		Effect.map(
			Effect.all([
				read({ COLUMNS: "100" }, { stdout: true }, (t) => t.width()),
				read({ COLUMNS: "garbage" }, { stdout: true }, (t) => t.width(60)),
			]),
			([fromEnv, fallback]) => {
				assert.strictEqual(fromEnv, 100);
				assert.strictEqual(fallback, 60);
			},
		),
	);

	it.effect("Terminal.columns 120 is Some(120) and beats both COLUMNS and the fallback", () =>
		Effect.map(
			read({ COLUMNS: "100" }, { stdout: true, columns: 120 }, (t) => [t.stdout.columns, t.width(60)] as const),
			([columns, width]) => {
				assert.deepStrictEqual(columns, Option.some(120));
				assert.strictEqual(width, 120);
			},
		),
	);
});

describe("TerminalEnv.layerTest", () => {
	// No Stdio, no Terminal, no ConfigProvider is provided: this compiling is the type-level check that the layer
	// has no requirements, and running is the behavioural one.
	it.effect("is quiet by default and needs no platform services", () =>
		Effect.gen(function* () {
			const t = yield* TerminalEnv;
			assert.strictEqual(t.stdinIsTerminal, false);
			for (const stream of [t.stdout, t.stderr]) {
				assert.deepStrictEqual(stream, { isTerminal: false, color: "none", hyperlinks: false, columns: Option.none() });
			}
			assert.strictEqual(t.width(), 80);
		}).pipe(Effect.provide(TerminalEnv.layerTest())),
	);

	it.effect("a test opts into colour per stream", () =>
		Effect.gen(function* () {
			const t = yield* TerminalEnv;
			assert.strictEqual(t.stdout.color, "truecolor");
			assert.strictEqual(t.stderr.color, "none");
			assert.deepStrictEqual(t.stdout.columns, Option.some(90));
			assert.strictEqual(t.width(), 90);
		}).pipe(
			Effect.provide(
				TerminalEnv.layerTest({ stdout: { color: "truecolor", columns: Option.some(90) }, stderr: { color: "none" } }),
			),
		),
	);
});

describe("TerminalEnv.colorLevel", () => {
	it.effect("FORCE_COLOR=2 gives 256 on a non-TTY stdout", () =>
		Effect.map(
			TerminalEnv.colorLevel("stdout").pipe(Effect.provide(stdio({ stdout: false })), withEnv({ FORCE_COLOR: "2" })),
			(level) => assert.strictEqual(level, "256"),
		),
	);

	it.effect("needs only Stdio: it is assignable to Effect<ColorLevel, never, Stdio> (no Terminal in R)", () => {
		const program = TerminalEnv.colorLevel("stdout") satisfies Effect.Effect<ColorLevel, never, Stdio.Stdio>;
		// A TTY stdout with no colour variables: the terminal table, not the TTY gate, decides.
		return Effect.map(
			program.pipe(Effect.provide(stdio({ stdout: true })), withEnv({ TERM: "xterm-256color" })),
			(level) => assert.strictEqual(level, "256"),
		);
	});

	it.effect("a non-TTY stdout without FORCE_COLOR is none", () =>
		Effect.map(
			TerminalEnv.colorLevel("stdout").pipe(
				Effect.provide(stdio({ stdout: false })),
				withEnv({ TERM: "xterm-256color" }),
			),
			(level) => assert.strictEqual(level, "none"),
		),
	);
});
