// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the arbitraries mix in unsubstituted ${...} launch placeholders, and a literal placeholder is what the properties exercise
import { describe, it } from "@effect/vitest";
import { Depth } from "@effected/testing";
import { Option, Schema } from "effect";
import { LaunchContext } from "../src/index.js";

const keys = ["OKFIT_PROJECT_DIR", "CLAUDE_PROJECT_DIR"] as const;

// A mix of hostile literals (empty, whitespace-only, unsubstituted placeholders)
// and arbitrary strings — per effect-v4-testing, a Schema.Literals union rather
// than a filter, so the hostile shapes are sampled directly instead of hoped for.
const EdgeString = Schema.Union([
	Schema.Literals(["", " ", "\t", "${CLAUDE_PROJECT_DIR}", "  ${CLAUDE_PROJECT_DIR}  ", "${}"]),
	Schema.String,
]);

// A Struct of optionalKey fields, not a Schema.Record — a Record always emits
// every key, which would never exercise the "key absent" branch of projectDir.
const EnvArb = Schema.Struct({
	OKFIT_PROJECT_DIR: Schema.optionalKey(EdgeString),
	CLAUDE_PROJECT_DIR: Schema.optionalKey(EdgeString),
});

describe("LaunchContext.projectDir — property", () => {
	it.prop(
		"never returns an empty string when cwd is non-empty",
		{ argv: Schema.Array(EdgeString), env: EnvArb, cwd: Schema.NonEmptyString },
		({ argv, env, cwd }) => {
			const result = LaunchContext.projectDir({ argv, env, keys, cwd });
			return result !== "" && !LaunchContext.isUnsubstituted(result);
		},
		{ arbitrary: { runs: Depth.pick({ sample: 20, full: 200 }) } },
	);
});

describe("LaunchContext.resolve — property", () => {
	it.prop(
		"projectDir is resolve with cwd as the fallback",
		{ argv: Schema.Array(EdgeString), env: EnvArb, cwd: Schema.String },
		({ argv, env, cwd }) =>
			LaunchContext.projectDir({ argv, env, keys, cwd }) ===
			Option.getOrElse(LaunchContext.resolve({ argv, env, keys }), () => cwd),
		{ arbitrary: { runs: Depth.pick({ sample: 20, full: 200 }) } },
	);
});
