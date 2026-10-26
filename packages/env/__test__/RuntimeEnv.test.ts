import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Context, Effect, Layer, Option, Schema } from "effect";
import { CurrentRuntimeEnv, RuntimeEnv } from "../src/RuntimeEnv.js";

const withEnv = (env: Record<string, string>) =>
	Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(env));

describe("RuntimeEnv", () => {
	it.effect("layer reads agent, CI and terminal through Config", () =>
		Effect.gen(function* () {
			const env = yield* CurrentRuntimeEnv;
			assert.deepStrictEqual(env.agent, Option.some("claude"));
			assert.deepStrictEqual(env.ci, Option.some("github-actions"));
			// The name comes from the ported std-osc8 table, where iTerm's entry is named "iTerm.app".
			const terminal = Option.getOrThrow(env.terminal);
			assert.strictEqual(terminal.name, "iTerm.app");
			assert.deepStrictEqual(terminal.version, Option.some("3.5.0"));
		}).pipe(
			Effect.provide(CurrentRuntimeEnv.layer),
			withEnv({ CLAUDECODE: "1", GITHUB_ACTIONS: "true", TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "3.5.0" }),
		),
	);

	it.effect("empty environment → all none", () =>
		Effect.gen(function* () {
			const env = yield* CurrentRuntimeEnv;
			assert.isTrue(Option.isNone(env.agent) && Option.isNone(env.ci) && Option.isNone(env.terminal));
		}).pipe(Effect.provide(CurrentRuntimeEnv.layer), withEnv({})),
	);

	it.effect("a terminal identified without a version has a None version", () =>
		Effect.gen(function* () {
			const env = yield* CurrentRuntimeEnv;
			assert.deepStrictEqual(env.terminal, Option.some({ name: "kitty", version: Option.none() }));
		}).pipe(Effect.provide(CurrentRuntimeEnv.layer), withEnv({ TERM: "xterm-kitty" })),
	);

	it.effect("layerTest overrides without touching Config", () =>
		Effect.gen(function* () {
			const env = yield* CurrentRuntimeEnv;
			assert.deepStrictEqual(env.agent, Option.some("codex"));
			assert.deepStrictEqual(env.ci, Option.none());
			assert.deepStrictEqual(env.terminal, Option.none());
		}).pipe(Effect.provide(CurrentRuntimeEnv.layerTest({ agent: Option.some("codex") })), withEnv({ CI: "true" })),
	);

	it.effect("a ConfigProvider whose reads fail yields an all-none snapshot", () =>
		Effect.gen(function* () {
			const env = yield* CurrentRuntimeEnv;
			assert.deepStrictEqual(env.agent, Option.none());
			assert.deepStrictEqual(env.ci, Option.none());
			assert.deepStrictEqual(env.terminal, Option.none());
		}).pipe(
			Effect.provide(CurrentRuntimeEnv.layer),
			Effect.provideService(
				ConfigProvider.ConfigProvider,
				ConfigProvider.make(() => Effect.fail(new ConfigProvider.SourceError({ message: "boom" }))),
			),
		),
	);

	it("round-trips through JSON text (persistable snapshot)", () => {
		const codec = Schema.fromJsonString(RuntimeEnv);
		const value = RuntimeEnv.make({
			agent: Option.some("claude"),
			ci: Option.none(),
			terminal: Option.some({ name: "iTerm.app", version: Option.some("3.5.0") }),
		});
		const json = Schema.encodeSync(codec)(value);
		assert.strictEqual(
			json,
			'{"agent":"claude","ci":null,"terminal":{"name":"iTerm.app","version":"3.5.0"},"session":null,"ciRun":null,"termProgram":{"name":null,"version":null}}',
		);
		assert.deepStrictEqual(Schema.decodeSync(codec)(json), value);
	});

	// The frozen 0.1.0 wire form, exactly as that version's encoder emits it. A snapshot persisted then must keep
	// decoding: fields added later have to decode when absent. This literal is the oracle; never regenerate it.
	const FROZEN_0_1_0 = '{"agent":"claude","ci":null,"terminal":{"name":"iTerm.app","version":"3.5.0"}}';

	it("decodes the frozen 0.1.0 wire literal", () => {
		const decoded = Schema.decodeSync(Schema.fromJsonString(RuntimeEnv))(FROZEN_0_1_0);
		assert.deepStrictEqual(decoded.agent, Option.some("claude"));
		assert.deepStrictEqual(decoded.ci, Option.none());
		assert.deepStrictEqual(decoded.terminal, Option.some({ name: "iTerm.app", version: Option.some("3.5.0") }));
		// It re-encodes as itself plus the fields added since, each in its absent form.
		assert.strictEqual(
			Schema.encodeSync(Schema.fromJsonString(RuntimeEnv))(decoded),
			`${FROZEN_0_1_0.slice(0, -1)},"session":null,"ciRun":null,"termProgram":{"name":null,"version":null}}`,
		);
	});

	// A second frozen 0.1.0 literal, with a CI named: `ci` was a plain string then, and `github-actions` is one of the
	// two values 0.1.0 ever wrote. Like the first, never regenerate it.
	const FROZEN_0_1_0_CI = '{"agent":"codex","ci":"github-actions","terminal":null}';

	it("decodes the frozen 0.1.0 wire literal that names a CI, and encodes it back with the added fields absent", () => {
		const decoded = Schema.decodeSync(Schema.fromJsonString(RuntimeEnv))(FROZEN_0_1_0_CI);
		assert.deepStrictEqual(decoded.agent, Option.some("codex"));
		assert.deepStrictEqual(decoded.ci, Option.some("github-actions"));
		assert.deepStrictEqual(decoded.terminal, Option.none());
		assert.strictEqual(
			Schema.encodeSync(Schema.fromJsonString(RuntimeEnv))(decoded),
			`${FROZEN_0_1_0_CI.slice(0, -1)},"session":null,"ciRun":null,"termProgram":{"name":null,"version":null}}`,
		);
	});

	it("every field decodes when its key is absent, so an older or sparser snapshot keeps decoding", () => {
		const codec = Schema.fromJsonString(RuntimeEnv);
		const empty = Schema.decodeSync(codec)("{}");
		assert.deepStrictEqual([empty.agent, empty.ci, empty.terminal], [Option.none(), Option.none(), Option.none()]);
		assert.deepStrictEqual([empty.session, empty.ciRun], [Option.none(), Option.none()]);
		assert.deepStrictEqual(empty.termProgram, { name: Option.none(), version: Option.none() });
		const partial = Schema.decodeSync(codec)('{"agent":"claude"}');
		assert.deepStrictEqual(partial.agent, Option.some("claude"));
		assert.deepStrictEqual(partial.ci, Option.none());
		assert.deepStrictEqual(partial.terminal, Option.none());
		const noVersion = Schema.decodeSync(codec)('{"terminal":{"name":"kitty"}}');
		assert.deepStrictEqual(noVersion.terminal, Option.some({ name: "kitty", version: Option.none() }));
	});

	it("ci is the CiName literal union: every name decodes and encodes, and anything else is rejected", () => {
		const codec = Schema.fromJsonString(RuntimeEnv);
		for (const ci of ["github-actions", "generic", "gitlab", "jenkins", "azure-pipelines", "circleci"] as const) {
			const decoded = Schema.decodeSync(codec)(`{"agent":null,"ci":"${ci}","terminal":null}`);
			assert.deepStrictEqual(decoded.ci, Option.some(ci));
			assert.strictEqual(
				Schema.encodeSync(codec)(decoded),
				`{"agent":null,"ci":"${ci}","terminal":null,"session":null,"ciRun":null,"termProgram":{"name":null,"version":null}}`,
			);
		}
		for (const bad of ["JENKINS", "", "GITHUB-ACTIONS", "true", "github", "circle", "google-cloudrun"]) {
			assert.throws(
				() => Schema.decodeSync(codec)(`{"agent":null,"ci":"${bad}","terminal":null}`),
				Error,
				"github-actions",
				bad,
			);
		}
	});

	it("consumers match ci exhaustively: a Record over CiName must name every provider", () => {
		const unknown = () =>
			// @ts-expect-error a CI that is not a CiName is not a RuntimeEnv
			RuntimeEnv.make({ agent: Option.none(), ci: Option.some("not-a-ci"), terminal: Option.none() });
		assert.throws(unknown);
		// A widened name constructs.
		assert.deepStrictEqual(
			RuntimeEnv.make({ agent: Option.none(), ci: Option.some("jenkins"), terminal: Option.none() }).ci,
			Option.some("jenkins"),
		);
	});

	it("round-trips the all-none snapshot", () => {
		const codec = Schema.fromJsonString(RuntimeEnv);
		const value = RuntimeEnv.make({ agent: Option.none(), ci: Option.none(), terminal: Option.none() });
		assert.strictEqual(
			Schema.encodeSync(codec)(value),
			'{"agent":null,"ci":null,"terminal":null,"session":null,"ciRun":null,"termProgram":{"name":null,"version":null}}',
		);
		assert.deepStrictEqual(Schema.decodeSync(codec)('{"agent":null,"ci":null,"terminal":null}'), value);
	});
});

const RECORDS: ReadonlyArray<Record<string, string>> = [
	{},
	{ CLAUDECODE: "1" },
	{ AI_AGENT: "claude-code_2-1-285_agent" },
	{ AI_AGENT: "mystery-agent" },
	{ GITHUB_ACTIONS: "true" },
	{ CI: "true" },
	{ CONTINUOUS_INTEGRATION: "1", TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "3.5.0" },
	{ TERM: "xterm-kitty" },
	{ CLAUDECODE: "1", GITHUB_ACTIONS: "true", TERM_PROGRAM: "vscode", TERM_PROGRAM_VERSION: "1.99.0" },
	{ AI_AGENT: "", CI: "", CLAUDECODE: "", GITHUB_ACTIONS: "" },
	// An empty variable is unset for the terminal too: no version, and no program name to identify.
	{ TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "" },
	{ TERM_PROGRAM: "", TERM: "xterm-kitty" },
	{ TMUX_PANE: "%3", TMUX: "/tmp/tmux-501/default,1,0", TERM_PROGRAM: "tmux", TERM_PROGRAM_VERSION: "3.4" },
	{ STY: "1.pts-0.h", TERM_SESSION_ID: "w0t0p0:X" },
	{ GITHUB_ACTIONS: "true", GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "2", RUNNER_OS: "Linux", RUNNER_ARCH: "X64" },
	{ bamboo_planKey: "PROJ-PLAN", bamboo_buildNumber: "12" },
	{ SYSTEM_TEAMFOUNDATIONCOLLECTIONURI: "https://dev.azure.com/x/", BUILD_BUILDID: "5", AGENT_OS: "Linux" },
];

describe("RuntimeEnv.fromRecord", () => {
	for (const record of RECORDS) {
		it.effect(`equals what the layer reads from the same record: ${JSON.stringify(record)}`, () =>
			Effect.gen(function* () {
				const viaLayer = yield* CurrentRuntimeEnv;
				assert.deepStrictEqual(RuntimeEnv.fromRecord(record), viaLayer);
			}).pipe(Effect.provide(CurrentRuntimeEnv.layer), withEnv(record)),
		);
	}

	it("an empty string and an undefined value both read as unset", () => {
		const unset = RuntimeEnv.fromRecord({});
		assert.deepStrictEqual(RuntimeEnv.fromRecord({ AI_AGENT: "", CI: "", GITHUB_ACTIONS: "", CLAUDECODE: "" }), unset);
		assert.deepStrictEqual(RuntimeEnv.fromRecord({ AI_AGENT: undefined, CI: undefined, CLAUDECODE: undefined }), unset);
		// Control: a non-empty value is not unset.
		assert.notDeepEqual(RuntimeEnv.fromRecord({ CLAUDECODE: "1" }), unset);
	});

	it("never reads the process environment", () => {
		const before = process.env.CLAUDECODE;
		process.env.CLAUDECODE = "1";
		try {
			assert.deepStrictEqual(RuntimeEnv.fromRecord({}), RuntimeEnv.fromRecord({}));
			assert.isTrue(Option.isNone(RuntimeEnv.fromRecord({}).agent));
		} finally {
			if (before === undefined) delete process.env.CLAUDECODE;
			else process.env.CLAUDECODE = before;
		}
	});
});

describe("CurrentRuntimeEnv.layerFrom", () => {
	class First extends Context.Service<First, Option.Option<string>>()("test/First") {}
	class Second extends Context.Service<Second, Option.Option<string>>()("test/Second") {}
	const envOf = Effect.gen(function* () {
		return yield* CurrentRuntimeEnv;
	});
	const agentOf = Effect.map(envOf, (env) => env.agent);

	it.effect("a record source is read without the ambient provider", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual((yield* CurrentRuntimeEnv).agent, Option.none());
		}).pipe(Effect.provide(CurrentRuntimeEnv.layerFrom({})), withEnv({ CLAUDECODE: "1" })),
	);

	it.effect("a ConfigProvider source is read instead of the ambient one", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual((yield* CurrentRuntimeEnv).agent, Option.some("claude"));
		}).pipe(Effect.provide(CurrentRuntimeEnv.layerFrom(ConfigProvider.fromUnknown({ CLAUDECODE: "1" }))), withEnv({})),
	);

	it.effect("a record source agrees with fromRecord", () =>
		Effect.gen(function* () {
			for (const record of RECORDS) {
				const viaLayer = yield* envOf.pipe(Effect.provide(CurrentRuntimeEnv.layerFrom(record)));
				assert.deepStrictEqual(viaLayer, RuntimeEnv.fromRecord(record));
			}
		}),
	);

	it.effect("two calls with different records in ONE graph see different values", () =>
		Effect.gen(function* () {
			const graph = Layer.mergeAll(
				Layer.effect(First, agentOf).pipe(Layer.provide(CurrentRuntimeEnv.layerFrom({ CLAUDECODE: "1" }))),
				Layer.effect(Second, agentOf).pipe(Layer.provide(CurrentRuntimeEnv.layerFrom({ AI_AGENT: "codex" }))),
			);
			const context = yield* Layer.build(graph);
			assert.deepStrictEqual(Context.get(context, First), Option.some("claude"));
			assert.deepStrictEqual(Context.get(context, Second), Option.some("codex"));
		}).pipe(Effect.scoped),
	);

	it.effect("control: CurrentRuntimeEnv.layer is ONE shared snapshot, so the second provider is never read", () =>
		Effect.gen(function* () {
			const graph = Layer.mergeAll(
				Layer.effect(First, agentOf).pipe(
					Layer.provide(CurrentRuntimeEnv.layer),
					Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ CLAUDECODE: "1" }))),
				),
				Layer.effect(Second, agentOf).pipe(
					Layer.provide(CurrentRuntimeEnv.layer),
					Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ AI_AGENT: "codex" }))),
				),
			);
			const context = yield* Layer.build(graph);
			assert.deepStrictEqual(Context.get(context, First), Context.get(context, Second));
		}).pipe(Effect.scoped),
	);

	it.effect("the same layerFrom value used twice in one graph is read twice: each use sees the provider as it is", () =>
		Effect.gen(function* () {
			let reads = 0;
			const counting = ConfigProvider.make((path) => {
				reads += 1;
				return ConfigProvider.fromUnknown({ CLAUDECODE: "1" }).load(path);
			});
			const shared = CurrentRuntimeEnv.layerFrom(counting);
			const graph = Layer.mergeAll(
				Layer.effect(First, agentOf).pipe(Layer.provide(shared)),
				Layer.effect(Second, agentOf).pipe(Layer.provide(shared)),
			);
			yield* Layer.build(graph);
			const perBuild = reads / 2;
			assert.isAbove(perBuild, 0);
			assert.strictEqual(Number.isInteger(perBuild), true);
			// A single build reads each key once; two uses read it twice as often.
			let single = 0;
			const once = ConfigProvider.make((path) => {
				single += 1;
				return ConfigProvider.fromUnknown({ CLAUDECODE: "1" }).load(path);
			});
			yield* Layer.build(Layer.effect(First, agentOf).pipe(Layer.provide(CurrentRuntimeEnv.layerFrom(once))));
			assert.strictEqual(reads, single * 2);
		}).pipe(Effect.scoped),
	);
});

// The wire form after the kit-ports revision (session, ciRun and termProgram added after 0.5.0), every field
// populated, exactly as the encoder emits it. Like the 0.1.0 literals, never regenerate it.
const FROZEN_KIT_PORTS =
	'{"agent":"claude","ci":"github-actions","terminal":{"name":"iTerm.app","version":"3.5.0"},' +
	'"session":{"source":"tmux","variable":"TMUX_PANE","id":"%3","multiplexer":{"name":"tmux","value":"/tmp/tmux-501/default,1,0"}},' +
	'"ciRun":{"runId":"123","attempt":"1","jobId":"test","sha":"abc","refName":"main","runner":{"os":"Linux","arch":"X64"}},' +
	'"termProgram":{"name":"iTerm.app","version":"3.5.0"}}';

describe("RuntimeEnv: session, ciRun and termProgram", () => {
	const codec = Schema.fromJsonString(RuntimeEnv);
	const full = RuntimeEnv.fromRecord({
		CLAUDECODE: "1",
		GITHUB_ACTIONS: "true",
		GITHUB_RUN_ID: "123",
		GITHUB_RUN_ATTEMPT: "1",
		GITHUB_JOB: "test",
		GITHUB_SHA: "abc",
		GITHUB_REF_NAME: "main",
		RUNNER_OS: "Linux",
		RUNNER_ARCH: "X64",
		TERM_PROGRAM: "iTerm.app",
		TERM_PROGRAM_VERSION: "3.5.0",
		TMUX_PANE: "%3",
		TMUX: "/tmp/tmux-501/default,1,0",
	});

	it("the frozen kit-ports literal decodes and encodes back identically", () => {
		const decoded = Schema.decodeSync(codec)(FROZEN_KIT_PORTS);
		assert.strictEqual(Schema.encodeSync(codec)(decoded), FROZEN_KIT_PORTS);
		assert.deepStrictEqual(decoded, full);
	});

	it("make defaults the added fields, so a caller written against agent/ci/terminal keeps constructing", () => {
		const made = RuntimeEnv.make({ agent: Option.none(), ci: Option.none(), terminal: Option.none() });
		assert.deepStrictEqual(made.session, Option.none());
		assert.deepStrictEqual(made.ciRun, Option.none());
		assert.deepStrictEqual(made.termProgram, { name: Option.none(), version: Option.none() });
	});

	it("an unknown session source is rejected on decode", () =>
		assert.throws(() =>
			Schema.decodeSync(codec)('{"session":{"source":"byobu","variable":"X","id":"1","multiplexer":null}}'),
		));

	it.effect("layer reads the session, run and term-program variables through Config", () =>
		Effect.gen(function* () {
			const env = yield* CurrentRuntimeEnv;
			assert.deepStrictEqual(env, full);
		}).pipe(
			Effect.provide(CurrentRuntimeEnv.layer),
			withEnv({
				CLAUDECODE: "1",
				GITHUB_ACTIONS: "true",
				GITHUB_RUN_ID: "123",
				GITHUB_RUN_ATTEMPT: "1",
				GITHUB_JOB: "test",
				GITHUB_SHA: "abc",
				GITHUB_REF_NAME: "main",
				RUNNER_OS: "Linux",
				RUNNER_ARCH: "X64",
				TERM_PROGRAM: "iTerm.app",
				TERM_PROGRAM_VERSION: "3.5.0",
				TMUX_PANE: "%3",
				TMUX: "/tmp/tmux-501/default,1,0",
			}),
		),
	);

	it.effect("layerFrom over core's env provider reads a lower-case provider variable (bamboo_planKey)", () =>
		Effect.gen(function* () {
			const env = yield* CurrentRuntimeEnv;
			assert.deepStrictEqual(env.ci, Option.some("bamboo"));
			assert.deepStrictEqual(
				Option.flatMap(env.ciRun, (run) => run.runId),
				Option.some("12"),
			);
		}).pipe(
			Effect.provide(
				CurrentRuntimeEnv.layerFrom(
					ConfigProvider.fromEnv({ env: { bamboo_planKey: "PROJ-PLAN", bamboo_buildNumber: "12" } }),
				),
			),
		),
	);

	it.effect("layerTest sets the added fields, and defaults them when not given", () =>
		Effect.gen(function* () {
			const env = yield* CurrentRuntimeEnv;
			assert.deepStrictEqual(env.session, full.session);
			assert.deepStrictEqual(env.ciRun, Option.none());
			assert.deepStrictEqual(env.termProgram, { name: Option.some("zed"), version: Option.none() });
		}).pipe(
			Effect.provide(
				CurrentRuntimeEnv.layerTest({
					session: full.session,
					termProgram: { name: Option.some("zed"), version: Option.none() },
				}),
			),
			withEnv({ CI: "true" }),
		),
	);

	// vitest-agent persists host_source / host_value / host_metadata from these fields; the stored values are the raw
	// variable names and values, so they must come back verbatim.
	it("reproduces vitest-agent's persisted host values verbatim", () => {
		const env = RuntimeEnv.fromRecord({
			TMUX_PANE: "%12",
			TMUX: "/private/tmp/tmux-501/default,4242,0",
			TERM_PROGRAM: "tmux",
			TERM_PROGRAM_VERSION: "3.5a",
		});
		const session = Option.getOrThrow(env.session);
		assert.strictEqual(session.variable, "TMUX_PANE");
		assert.strictEqual(session.id, "%12");
		assert.strictEqual(Option.getOrThrow(session.multiplexer).value, "/private/tmp/tmux-501/default,4242,0");
		assert.strictEqual(Option.getOrThrow(env.termProgram.name), "tmux");
		assert.strictEqual(Option.getOrThrow(env.termProgram.version), "3.5a");
		// Control: the normalized terminal name does not carry an unknown program.
		assert.deepStrictEqual(env.terminal, Option.none());
	});
});
