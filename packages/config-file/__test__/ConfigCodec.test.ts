import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Option } from "effect";
import { ConfigCodec, ConfigCodecError } from "../src/ConfigCodec.js";

describe("ConfigCodec.json", () => {
	it.effect("parses valid JSON to an unknown value", () =>
		Effect.gen(function* () {
			const parsed = yield* ConfigCodec.json.parse(`{"port":8080}`);
			expect(parsed).toEqual({ port: 8080 });
		}),
	);

	it.effect("stringifies a value back to JSON text", () =>
		Effect.gen(function* () {
			const text = yield* ConfigCodec.json.stringify({ port: 8080 });
			expect(JSON.parse(text)).toEqual({ port: 8080 });
		}),
	);

	it.effect("fails with ConfigCodecError carrying a structured cause, not a string", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(ConfigCodec.json.parse("{ not json"));
			expect(error).toBeInstanceOf(ConfigCodecError);
			expect(error._tag).toBe("ConfigCodecError");
			expect(error.codec).toBe("json");
			expect(error.operation).toBe("parse");
			// The underlying SyntaxError survives structurally.
			expect(error.cause).toBeInstanceOf(SyntaxError);
		}),
	);

	it.effect("fails with operation: stringify on a circular value", () =>
		Effect.gen(function* () {
			const circular: Record<string, unknown> = {};
			circular.self = circular;
			const error = yield* Effect.flip(ConfigCodec.json.stringify(circular));
			expect(error.operation).toBe("stringify");
			expect(error.cause).toBeInstanceOf(TypeError);
		}),
	);

	it.effect("never dies — malformed input fails through the typed channel", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(ConfigCodec.json.parse("{ not json"));
			expect(Exit.isFailure(exit)).toBe(true);
			// A defect would mean the parser threw instead of failing typed: assert the
			// cause is a genuine Fail reason, not a Die reason.
			if (Exit.isFailure(exit)) {
				const cause = Exit.getCause(exit);
				expect(Option.isSome(cause)).toBe(true);
				if (Option.isSome(cause)) {
					expect(Cause.hasFails(cause.value)).toBe(true);
					expect(Cause.hasDies(cause.value)).toBe(false);
				}
			}
		}),
	);
});
