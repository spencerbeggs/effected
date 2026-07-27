import { Config, Effect, Redacted } from "effect";
import { ActionOutputs } from "./ActionOutputs.js";

/**
 * The declassification seam: the **only** place in this package where a
 * `Redacted` value becomes a plain string.
 *
 * @remarks
 * Some boundaries cannot carry a `Redacted`. A detached child process reads
 * its configuration from environment variables; `GITHUB_STATE` is a plaintext
 * file by GitHub's protocol. `Redacted` refusing to serialize is the whole
 * value of the type, so this module does not try to make it serializable —
 * it makes declassification **explicit, auditable, and impossible to do
 * quietly**.
 *
 * The invariant: **masking and declassification are the same call.** Every
 * member registers the value with the runner's log filter (`::add-mask::`)
 * *before* returning plaintext, so a secret cannot reach a child's environment
 * or a state file without the runner already knowing to redact it from logs.
 *
 * `Redacted.value` appears nowhere else in this package, and a test asserts
 * that structurally — a reintroduction elsewhere fails the suite rather than
 * review.
 *
 * What this deliberately does **not** do is encrypt the handoff. The child
 * runs on the same runner, as the same user, as the parent; a key would have
 * to travel the same channel as the secret it protects.
 *
 * @example
 * ```ts
 * import { Secret } from "@effected/github-actions";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const env = yield* Secret.forChildEnv({ MY_TOKEN: theToken });
 *   // every value in `env` is already masked in the runner log
 *   return env;
 * });
 * ```
 *
 * @public
 */
export class Secret {
	private constructor() {}

	/**
	 * Declassify a set of secrets for a child process's environment.
	 *
	 * @remarks
	 * Every value is masked before any plaintext is returned — including when
	 * one of them fails, because masking happens for the whole set first.
	 */
	static readonly forChildEnv = (
		entries: Readonly<Record<string, Redacted.Redacted<string>>>,
	): Effect.Effect<Record<string, string>, never, ActionOutputs> =>
		Effect.gen(function* () {
			const outputs = yield* ActionOutputs;
			const declassified: Record<string, string> = {};
			for (const [name, secret] of Object.entries(entries)) {
				const plaintext = Redacted.value(secret);
				yield* outputs.setSecret(plaintext);
				declassified[name] = plaintext;
			}
			return declassified;
		});

	/**
	 * Declassify one secret for a runner file (`GITHUB_STATE`, `GITHUB_OUTPUT`).
	 *
	 * @remarks
	 * Masks first. The runner file is plaintext regardless; the mask is what
	 * keeps the value out of the visible log.
	 */
	static readonly forRunnerFile = (secret: Redacted.Redacted<string>): Effect.Effect<string, never, ActionOutputs> =>
		Effect.gen(function* () {
			const outputs = yield* ActionOutputs;
			const plaintext = Redacted.value(secret);
			yield* outputs.setSecret(plaintext);
			return plaintext;
		});

	/**
	 * Declassify one secret for an in-process use that needs the raw bytes.
	 *
	 * @remarks
	 * Request signing is the case this exists for: an HMAC cannot be computed
	 * over a `Redacted`, so a signing key has to become a string somewhere, and
	 * the point of this module is that "somewhere" is here and nowhere else.
	 *
	 * Signing named the member; it does not gate it. **Any in-process use that
	 * needs the raw value without writing it to a runner file is this
	 * operation** — bridging a token into this process's own `process.env` for
	 * an SDK that only reads the environment, or handing a key to a library
	 * that takes a plain string. The dividing line is where the value goes, not
	 * what it is for: a value crossing into a **child's** environment is
	 * {@link Secret.forChildEnv}, one written to `GITHUB_STATE` or
	 * `GITHUB_OUTPUT` is {@link Secret.forRunnerFile}, and one that stays in
	 * this process is this member.
	 *
	 * It masks even though the value is never *written* anywhere, and that is
	 * deliberate rather than superstitious: a signing key that leaks does so
	 * through something nobody audited — a debug log of outgoing headers, a
	 * serialized error, a stack trace carrying the closure. Registering it with
	 * the runner's filter costs one call and makes every one of those redacted.
	 *
	 * Call it **once, at layer construction**, not per operation: masking is
	 * idempotent but a workflow command per request is noise in the log.
	 */
	static readonly forSigning = (secret: Redacted.Redacted<string>): Effect.Effect<string, never, ActionOutputs> =>
		Secret.forRunnerFile(secret);

	/**
	 * The far side of a handoff: re-wrap a plaintext environment variable.
	 *
	 * @remarks
	 * A `Config`, so a missing or empty handoff is an honest `ConfigError`
	 * naming the variable rather than an empty `Redacted` that fails much later
	 * as an authentication error.
	 */
	static readonly adopt = (name: string): Config.Config<Redacted.Redacted<string>> => Config.redacted(name);
}
