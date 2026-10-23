// Reading npm's own log lines off a `--loglevel=silly` publish.
//
// Pure functions over captured stderr text, kept out of `PackagePublish` so
// the classification and the error-output filter are table-testable without
// a spawner. npm writes every log line to stderr as
// `<heading> <level> [<title>] <message>`, the heading `npm` unless the user
// configured another; under colour each part is wrapped in SGR escapes.

import type { PublishAuthPath } from "../PackagePublish.js";

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the ESC byte is the point.
const SGR = /\u001b\[[0-9;]*m/g;

/**
 * Strip SGR colour escapes, so a coloured line classifies like a plain one.
 *
 * @internal
 */
export const stripAnsi = (text: string): string => text.replace(SGR, "");

/**
 * `lib/utils/oidc.js` logs this, at `verbose`, only after the exchanged token
 * has been installed as the registry credential.
 */
const EXCHANGED = /^\S+ verbose oidc Successfully retrieved and set token\s*$/m;

/**
 * Every other oidc outcome: a failed id-token fetch or exchange (`verbose
 * … Failed …` / `Failure …`) or an exchange skipped for want of an id token
 * or a permission (`silly … Skipped …`). Each returns without touching the
 * configured credential, and npm then publishes with whatever the npmrc holds
 * — so a SUCCESSFUL publish after one of these used the configured credential.
 */
const NOT_EXCHANGED = /^\S+ (?:verbose|silly) oidc (?:Failed|Failure|Skipped)\b/m;

/**
 * Which credential a successful `npm publish` authenticated with, read from
 * its stderr on positive evidence only.
 *
 * @remarks
 * Precedence is load-bearing. The success marker wins over every failure
 * marker, because `Failed to set provenance …` is logged only AFTER a
 * successful exchange; a first-match-wins reading would call that run
 * configured-credential. `tokenAuth` is second: the publish ran with every
 * id-token source blanked, so no exchange was possible.
 *
 * @internal
 */
export const classifyPublishAuth = (stderr: string, tokenAuth: boolean): PublishAuthPath => {
	const plain = stripAnsi(stderr);
	if (EXCHANGED.test(plain)) return "oidc-exchange";
	if (tokenAuth) return "configured-credential";
	if (NOT_EXCHANGED.test(plain)) return "configured-credential";
	return "unknown";
};

/** The levels `--loglevel=silly` adds below npm's default `notice`. */
const VERBOSE_LINE = /^\S+ (?:verbose|silly|http|info|timing) /;

/** A `notice` line with a message after the level. */
const NOTICE_LINE = /^\S+ notice \S/;

/**
 * The failure text a `PublishError` carries: npm's stderr at the default
 * levels, falling back to stdout when that leaves nothing.
 *
 * @remarks
 * The publish runs at `silly` to see the auth markers, which adds dozens of
 * `verbose`/`silly`/`http`/`info`/`timing` lines a failure report should not
 * carry, so they are dropped. Below `verbose` npm also deduplicates repeated
 * `notice` lines; at `silly` it does not, so a repeated non-blank notice is
 * kept once here. The stdout fallback runs on the FILTERED text — a silly
 * stderr is never empty, so selecting first would never fall back.
 *
 * @internal
 */
export const publishFailureOutput = (stdout: string, stderr: string): string => {
	const seen = new Set<string>();
	const kept: Array<string> = [];
	for (const line of stderr.split("\n")) {
		const plain = stripAnsi(line);
		if (VERBOSE_LINE.test(plain)) continue;
		if (NOTICE_LINE.test(plain)) {
			if (seen.has(plain)) continue;
			seen.add(plain);
		}
		kept.push(line);
	}
	const filtered = kept.join("\n");
	return filtered.trim() === "" ? stdout : filtered;
};
