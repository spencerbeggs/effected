import { assert, describe, it } from "@effect/vitest";
import { classifyPublishAuth, publishFailureOutput, stripAnsi } from "../src/internal/npmLog.js";

/**
 * A `npm publish --loglevel=silly` stderr transcript, trimmed from a recorded
 * run against a mock registry: the lines around the oidc step are verbatim,
 * and `oidc` slots the run's own oidc lines in where npm writes them.
 */
const transcript = (npmVersion: string, oidc: ReadonlyArray<string>): string =>
	[
		"npm verbose cli /usr/local/bin/node /usr/local/lib/node_modules/npm/bin/npm-cli.js",
		`npm info using npm@${npmVersion}`,
		"npm info using node@v24.11.0",
		"npm silly config load:file:/home/runner/.npmrc",
		"npm verbose title npm publish /tmp/pkg-1.0.0.tgz",
		"npm silly logfile done cleaning log files",
		"npm verbose publish [",
		"npm verbose publish   '/tmp/pkg-1.0.0.tgz'",
		"npm verbose publish ]",
		"npm notice",
		"npm notice package: pkg@1.0.0",
		"npm notice Tarball Contents",
		"npm notice 44B package.json",
		"npm notice",
		"npm http fetch GET 200 https://example.invalid/idtoken?audience=npm%3Aregistry.npmjs.org 7ms",
		...oidc,
		"npm http fetch GET 404 https://registry.npmjs.org/pkg 1ms (cache skip)",
		"npm notice Publishing to https://registry.npmjs.org/ with tag latest and default access",
		"npm http fetch PUT 200 https://registry.npmjs.org/pkg 1ms",
		"npm verbose exit 0",
		"npm info ok",
		"",
	].join("\n");

const SUCCESS = "npm verbose oidc Successfully retrieved and set token";

describe("classifyPublishAuth", () => {
	it("reads the exchange marker as oidc-exchange on npm 11", () => {
		assert.strictEqual(classifyPublishAuth(transcript("11.21.1", [SUCCESS]), false), "oidc-exchange");
	});

	it("reads the exchange marker as oidc-exchange on npm 12", () => {
		assert.strictEqual(classifyPublishAuth(transcript("12.2.1", [SUCCESS]), false), "oidc-exchange");
	});

	it("reads a failed exchange as configured-credential (npm fell back to the npmrc)", () => {
		const stderr = transcript("12.2.1", [
			"npm verbose oidc Failed token exchange request with body message: no trusted publisher",
		]);
		assert.strictEqual(classifyPublishAuth(stderr, false), "configured-credential");
	});

	it("reads a failed id-token fetch as configured-credential", () => {
		const stderr = transcript("12.2.1", ["npm verbose oidc Failed to fetch id_token from GitHub: missing value"]);
		assert.strictEqual(classifyPublishAuth(stderr, false), "configured-credential");
	});

	it("reads a catch-all oidc failure as configured-credential", () => {
		const stderr = transcript("11.21.1", ["npm verbose oidc Failure with message: socket hang up"]);
		assert.strictEqual(classifyPublishAuth(stderr, false), "configured-credential");
	});

	it("reads a skipped exchange (no id-token permission) as configured-credential", () => {
		const stderr = transcript("12.2.1", [
			"npm silly oidc Skipped because incorrect permissions for id-token within GitHub workflow",
		]);
		assert.strictEqual(classifyPublishAuth(stderr, false), "configured-credential");
	});

	it("reads a skipped exchange (no id token on GitLab or CircleCI) as configured-credential", () => {
		const stderr = transcript("12.2.1", ["npm silly oidc Skipped because no id_token available"]);
		assert.strictEqual(classifyPublishAuth(stderr, false), "configured-credential");
	});

	it("answers unknown when npm printed no oidc line at all, rather than guessing", () => {
		// The negative control: outside CI npm attempts no exchange and says
		// nothing, and an npm without trusted publishing says nothing either.
		assert.strictEqual(classifyPublishAuth(transcript("12.2.1", []), false), "unknown");
		assert.strictEqual(classifyPublishAuth("", false), "unknown");
	});

	it("lets the success marker win over a later provenance failure", () => {
		// `Failed to set provenance` is only logged AFTER a successful exchange;
		// a first-failure-marker-wins reading would call this configured.
		const stderr = transcript("12.2.1", [SUCCESS, "npm verbose oidc Failed to set provenance with message: x"]);
		assert.strictEqual(classifyPublishAuth(stderr, false), "oidc-exchange");
	});

	it("lets the success marker win even when a failure marker comes first in the text", () => {
		const stderr = transcript("12.2.1", ["npm verbose oidc Failed to set provenance with message: x", SUCCESS]);
		assert.strictEqual(classifyPublishAuth(stderr, false), "oidc-exchange");
	});

	it("reads tokenAuth with no marker as configured-credential, by construction", () => {
		assert.strictEqual(classifyPublishAuth(transcript("12.2.1", []), true), "configured-credential");
	});

	it("still reports an exchange under tokenAuth if npm says one happened", () => {
		// Positive evidence beats construction: if some other id-token source got
		// through, the report must say so rather than repeat the intent.
		assert.strictEqual(classifyPublishAuth(transcript("12.2.1", [SUCCESS]), true), "oidc-exchange");
	});

	it("matches a custom heading", () => {
		const stderr = transcript("12.2.1", ["release verbose oidc Successfully retrieved and set token"]);
		assert.strictEqual(classifyPublishAuth(stderr, false), "oidc-exchange");
	});

	it("answers unknown for an empty heading, whose lines no longer start with a word", () => {
		const stderr = transcript("12.2.1", [" verbose oidc Successfully retrieved and set token"]);
		assert.strictEqual(classifyPublishAuth(stderr, false), "unknown");
	});

	it("classifies a coloured line after stripping the escapes", () => {
		const coloured =
			"\u001b[37mnpm\u001b[39m \u001b[94mverbose\u001b[39m \u001b[35moidc\u001b[39m Successfully retrieved and set token";
		assert.strictEqual(classifyPublishAuth(transcript("12.2.1", [coloured]), false), "oidc-exchange");
	});

	it("does not match the marker text inside an unrelated line", () => {
		const stderr = "npm notice says: npm verbose oidc Successfully retrieved and set token\n";
		assert.strictEqual(classifyPublishAuth(stderr, false), "unknown");
	});
});

describe("stripAnsi", () => {
	it("removes SGR escapes and leaves the text", () => {
		assert.strictEqual(stripAnsi("\u001b[31mnpm\u001b[39m \u001b[1;31merror\u001b[0m x"), "npm error x");
	});
});

describe("publishFailureOutput", () => {
	it("keeps what npm prints at its default level and drops the silly additions", () => {
		const stderr = [
			"npm verbose cli /usr/local/bin/node npm-cli.js",
			"npm info using npm@12.2.1",
			"npm silly config load:file:/home/runner/.npmrc",
			"npm timing command:publish Completed in 30ms",
			"npm notice Publishing to https://registry.npmjs.org/ with tag latest and default access",
			"npm http fetch PUT 403 https://registry.npmjs.org/pkg 12ms",
			"npm error code E403",
			"npm error 403 Forbidden - PUT https://registry.npmjs.org/pkg",
			"npm verbose exit 1",
		].join("\n");
		const output = publishFailureOutput("", stderr);
		assert.include(output, "npm error 403 Forbidden");
		assert.include(output, "npm error code E403");
		assert.include(output, "npm notice Publishing to");
		for (const dropped of ["npm verbose", "npm silly", "npm http", "npm info", "npm timing"]) {
			assert.notInclude(output, dropped);
		}
	});

	it("keeps a repeated notice once, as npm itself does below verbose", () => {
		const header = "npm notice Beginning October 1st, some registry notice";
		const stderr = [header, "npm verbose x", header, "npm error 403 Forbidden"].join("\n");
		const output = publishFailureOutput("", stderr);
		assert.strictEqual(output.split(header).length - 1, 1);
		assert.include(output, "npm error 403 Forbidden");
	});

	it("keeps blank notice lines, which frame npm's tarball summary", () => {
		const stderr = ["npm notice", "npm notice package: pkg@1.0.0", "npm notice", "npm error x"].join("\n");
		assert.strictEqual(publishFailureOutput("", stderr), stderr);
	});

	it("falls back to stdout when filtering leaves stderr empty", () => {
		// Pins the order: a silly stderr is never empty, so a fallback decided
		// BEFORE filtering would never fire.
		const stderr = ["npm verbose cli x", "npm silly y", "npm info ok", ""].join("\n");
		assert.strictEqual(
			publishFailureOutput("npm ERR! the message on stdout", stderr),
			"npm ERR! the message on stdout",
		);
	});

	it("filters coloured lines by their plain text", () => {
		const stderr = ["\u001b[37mnpm\u001b[39m \u001b[90msilly\u001b[39m noise", "npm error real"].join("\n");
		assert.strictEqual(publishFailureOutput("", stderr), "npm error real");
	});
});
