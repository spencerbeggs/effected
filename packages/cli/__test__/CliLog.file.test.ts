import { assert, describe, it } from "@effect/vitest";
import { Audience, TerminalEnv } from "@effected/env";
import { MemoryFileSystem } from "@effected/memfs";
import { ConfigProvider, Console, Effect, Exit, Layer, PlatformError, Scope } from "effect";
import { CliLog } from "../src/index.js";

const LEVEL_ENV = "TOOL_LOG_LEVEL";
const FILE_ENV = "TOOL_LOG_FILE";
const PATH = "/logs/diagnostics.ndjson";

const capturing = () => {
	const out: string[] = [];
	const err: string[] = [];
	const double: Console.Console = Object.assign(Object.create(console) as Console.Console, {
		log: (...args: ReadonlyArray<unknown>) => out.push(args.map(String).join(" ")),
		error: (...args: ReadonlyArray<unknown>) => err.push(args.map(String).join(" ")),
	});
	return { double, out, err };
};

const deny = PlatformError.systemError({
	_tag: "PermissionDenied",
	module: "FileSystem",
	method: "writeFileString",
	pathOrDescriptor: PATH,
	description: "disk said no",
});

/** Run `body` with the file sink built over a memfs volume, in a scope the test closes itself. */
const harness = (options: {
	readonly file: { readonly envVar: string } | { readonly path: string };
	readonly env?: Record<string, string>;
	readonly failFirstAppend?: boolean;
}) =>
	Effect.gen(function* () {
		const handle = MemoryFileSystem.makeSync(
			{},
			options.failFirstAppend === true
				? { faults: { writeFileString: MemoryFileSystem.failTimes(1, deny) } }
				: undefined,
		);
		const { double, out, err } = capturing();
		const layer = CliLog.layer({ envVar: LEVEL_ENV, file: options.file }).pipe(
			Layer.provide(Layer.mergeAll(Audience.layerTest("agent"), TerminalEnv.layerTest())),
			Layer.provide(handle.layer),
		);
		const scope = yield* Scope.make();
		const context = yield* Layer.buildWithScope(layer, scope).pipe(
			Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(options.env ?? {})),
			Effect.provideService(Console.Console, double),
		);
		return {
			handle,
			out,
			err,
			/** Run `program` with the built loggers. */
			log: (program: Effect.Effect<void>) =>
				program.pipe(Effect.provideContext(context), Effect.provideService(Console.Console, double)),
			close: Scope.close(scope, Exit.void),
			file: () => handle.volume.text(PATH),
		};
	});

const ndjson = (lines: ReadonlyArray<string>) => lines.filter((line) => line.startsWith("{"));
/** The sink's one error line. CliLogger's plain lines share stderr, so it is picked out by its prefix. */
const plain = (lines: ReadonlyArray<string>) => lines.filter((line) => line.startsWith("diagnostics log file"));
const settle = Effect.forEach(Array.from({ length: 50 }), () => Effect.yieldNow);

const program = Effect.gen(function* () {
	yield* Effect.logDebug("dbg");
	yield* Effect.logError("boom");
});

describe("CliLog.layer file option", () => {
	it("requires FileSystem and Path only when a file is given", () => {
		const without: Layer.Layer<never, never, Audience | TerminalEnv> = CliLog.layer({ envVar: LEVEL_ENV });
		assert.isDefined(without);
		// @ts-expect-error a layer with a file option needs FileSystem and Path, which the narrower type does not allow
		const narrowed: Layer.Layer<never, never, Audience | TerminalEnv> = CliLog.layer({ file: { path: PATH } });
		assert.isDefined(narrowed);
	});

	it.effect("writes the same NDJSON lines as the stderr sink, one per record, and flushes when the scope closes", () =>
		Effect.gen(function* () {
			const h = yield* harness({ file: { path: PATH }, env: { [LEVEL_ENV]: "debug" } });
			yield* h.log(program);
			yield* h.close;
			const lines = (h.file() ?? "").split("\n").filter((l) => l !== "");
			assert.strictEqual(lines.length, 2);
			// Identical to the stderr line for the same log call, byte for byte.
			assert.deepStrictEqual(lines, ndjson(h.err));
			assert.deepStrictEqual(
				lines.map((l) => JSON.parse(l).level),
				["DEBUG", "ERROR"],
			);
			assert.isTrue((h.file() ?? "").endsWith("\n"));
		}),
	);

	it.effect("filters by the same level: nothing is written while the diagnostics level is None", () =>
		Effect.gen(function* () {
			const h = yield* harness({ file: { path: PATH } });
			yield* h.log(program);
			yield* h.close;
			assert.isUndefined(h.file());
			// CliLogger still prints the error plainly; nothing is written as NDJSON.
			assert.deepStrictEqual(ndjson(h.err), []);
		}),
	);

	it.effect("takes the path from an env var, and does nothing when it is unset", () =>
		Effect.gen(function* () {
			const set = yield* harness({
				file: { envVar: FILE_ENV },
				env: { [LEVEL_ENV]: "error", [FILE_ENV]: PATH },
			});
			yield* set.log(program);
			yield* set.close;
			assert.strictEqual((set.file() ?? "").split("\n").filter((l) => l !== "").length, 1);

			const unset = yield* harness({ file: { envVar: FILE_ENV }, env: { [LEVEL_ENV]: "error" } });
			yield* unset.log(program);
			yield* unset.close;
			assert.isFalse(unset.handle.volume.has(PATH));
			assert.deepStrictEqual(plain(unset.err), []);
		}),
	);

	it.effect("creates the parent directory", () =>
		Effect.gen(function* () {
			const h = yield* harness({ file: { path: "/deep/er/log.ndjson" }, env: { [LEVEL_ENV]: "error" } });
			yield* h.log(program);
			yield* h.close;
			assert.isTrue(h.handle.volume.has("/deep/er/log.ndjson"));
		}),
	);

	// Review Focus 5.
	describe("the first write error", () => {
		it.effect("prints exactly one stderr line, keeps the program running, and drops later writes", () =>
			Effect.gen(function* () {
				const h = yield* harness({
					file: { path: PATH },
					env: { [LEVEL_ENV]: "debug" },
					failFirstAppend: true,
				});
				// The first batch fails.
				yield* h.log(Effect.logError("first"));
				let spins = 0;
				while (plain(h.err).length === 0 && spins++ < 1000) yield* Effect.yieldNow;
				assert.strictEqual(plain(h.err).length, 1, h.err.join("\n"));

				// The program is unaffected: it keeps logging and finishes with its own value. The fault has used up its
				// one failure, so a healthy sink WOULD write these: they are dropped because the sink disabled itself.
				const exit = yield* Effect.exit(
					h.log(
						Effect.gen(function* () {
							yield* Effect.logError("second");
							yield* settle;
							yield* Effect.logError("third");
						}),
					),
				);
				assert.isTrue(Exit.isSuccess(exit));
				yield* settle;
				yield* h.close;

				const errors = plain(h.err);
				assert.strictEqual(errors.length, 1, errors.join("\n"));
				assert.match(
					errors[0] ?? "",
					new RegExp(`^diagnostics log file ${PATH} failed: .*disk said no.*; further file logging disabled$`),
				);
				assert.isFalse(h.handle.volume.has(PATH), "later lines are dropped, not written");
				// The stderr sink still recorded every record: only the file went away.
				assert.strictEqual(ndjson(h.err).length, 3);
			}),
		);

		it.effect("lines still queued when the scope closes after the sink disabled itself are discarded silently", () =>
			Effect.gen(function* () {
				const h = yield* harness({
					file: { path: PATH },
					env: { [LEVEL_ENV]: "debug" },
					failFirstAppend: true,
				});
				yield* h.log(Effect.logError("first"));
				let spins = 0;
				while (plain(h.err).length === 0 && spins++ < 1000) yield* Effect.yieldNow;
				// Queued after the failure and never given a chance to drain before the scope closes.
				yield* h.log(Effect.logError("queued one"));
				yield* h.log(Effect.logError("queued two"));
				yield* h.close;
				assert.strictEqual(plain(h.err).length, 1, h.err.join("\n"));
				assert.isFalse(h.handle.volume.has(PATH));
			}),
		);
	});
});
