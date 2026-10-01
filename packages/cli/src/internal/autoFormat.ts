import type { AudienceKind } from "@effected/env";
import { CurrentRuntimeEnv } from "@effected/env";
import { Effect, Option } from "effect";

/**
 * The renderer an audience gets when nothing says otherwise: a person is painted, a machine reads plain text.
 *
 * @remarks
 * A CI gets GitHub's log format only where `CurrentRuntimeEnv` says it is GitHub Actions; that service is read if the
 * environment has it and is not required. Shared by `Doc.print` and the failure report.
 *
 * @internal
 */
export const autoFormat = (audience: AudienceKind): Effect.Effect<"plain" | "ansi" | "githubLog"> =>
	Effect.gen(function* () {
		if (audience === "human") return "ansi";
		if (audience === "agent") return "plain";
		const runtime = yield* Effect.serviceOption(CurrentRuntimeEnv);
		const ci = Option.flatMap(runtime, (env) => env.ci);
		return Option.contains(ci, "github-actions") ? "githubLog" : "plain";
	});
