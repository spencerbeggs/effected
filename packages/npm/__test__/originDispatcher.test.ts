import { assert, describe, it } from "@effect/vitest";
import { Result } from "effect";
import { connectionFor, requestUrl } from "../src/internal/originDispatcher.js";
import { NpmConfig } from "../src/NpmConfig.js";

const config = (...lines: ReadonlyArray<string>): NpmConfig => {
	const result = NpmConfig.fromSourcesResult([{ text: lines.join("\n") }], {});
	if (Result.isFailure(result)) throw new Error(result.failure.message);
	return result.success;
};

describe("OriginDispatcher routing", () => {
	it("keeps the origin for a path beginning with two slashes", () => {
		assert.strictEqual(
			requestUrl("https://art.example.com", "//pkg/-/pkg-1.0.0.tgz"),
			"https://art.example.com//pkg/-/pkg-1.0.0.tgz",
		);
		assert.strictEqual(
			requestUrl(new URL("https://art.example.com:8443/ignored"), "/a?b=1"),
			"https://art.example.com:8443/a?b=1",
		);
	});

	it("routes by the origin host, never a host named in the path", () => {
		const context = {
			config: config(
				"registry=https://registry.corp/",
				"//internal.corp/:cafile=/internal-ca.pem",
				"//internal.corp/:certfile=/internal.pem",
				"//internal.corp/:keyfile=/internal.key",
			),
			env: {},
			packageManager: "npm" as const,
			files: new Map([
				["/internal-ca.pem", "CA"],
				["/internal.pem", "CERT"],
				["/internal.key", "KEY"],
			]),
		};
		const viaOrigin = connectionFor(requestUrl("https://registry.corp", "//internal.corp/x"), context);
		const direct = connectionFor("https://registry.corp/x", context);
		assert.strictEqual(viaOrigin.key, direct.key);
		assert.isUndefined(viaOrigin.tls.cert);
		// The control: the path's host really does carry a certificate when it is the origin.
		const internal = connectionFor(requestUrl("https://internal.corp", "/x"), context);
		assert.notStrictEqual(internal.key, direct.key);
		assert.strictEqual(internal.tls.cert, "CERT");
	});
});
