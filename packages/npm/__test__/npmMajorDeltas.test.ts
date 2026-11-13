// npm 11.21.2 -> 12.2.2: the setting deltas, frozen. Recomputed from the two
// `workspaces/config/lib/definitions/definitions.js` files (181 definitions in
// npm 11, 191 in npm 12) and a diff of `workspaces/config/lib/index.js`. A
// later npm bump that changes this list is a deliberate edit here.
//
// `NpmConfig` does not distinguish npm majors: it reads npmrc text and never
// refuses a file, so the rows below pin what it does under both majors' rules.

import { assert, describe, it } from "@effect/vitest";
import { Option, Result } from "effect";
import { NpmConfig } from "../src/NpmConfig.js";

const DELTAS = {
	added: [
		"allow-unused-patches",
		"edit-dir",
		"extension-file",
		"global-ignore-file",
		"ignore-existing",
		"ignore-extension",
		"ignore-patch-failures",
		"keep-edit-dir",
		"patches-dir",
		"strict-npmrc",
		"to",
	],
	removed: ["shrinkwrap"],
	defaultChanges: {
		"allow-git": { 11: "all", 12: "none" },
		"allow-remote": { 11: "all", 12: "none" },
		"init-license": { 11: "ISC", 12: "" },
		"init.license": { 11: "ISC", 12: "" },
	},
	// index.js `validate()`: top-level keys a global/user/project npmrc may not
	// hold. npm 11 (index.js:419) refuses the first four; npm 12 (index.js:461-486)
	// adds the last three.
	topLevelRefused: {
		11: ["_auth", "_authToken", "username", "_password"],
		12: ["_auth", "_authToken", "username", "_password", "email", "certfile", "keyfile"],
	},
} as const;

const load = (text: string): NpmConfig => {
	const result = NpmConfig.fromSourcesResult([{ text }], {});
	if (Result.isFailure(result)) throw new Error("config failed");
	return result.success;
};

describe("npm 11 to 12 deltas", () => {
	it("freezes the recomputed delta list", () => {
		assert.lengthOf(DELTAS.added, 11);
		assert.lengthOf(DELTAS.removed, 1);
		assert.deepStrictEqual(Object.keys(DELTAS.defaultChanges), [
			"allow-git",
			"allow-remote",
			"init-license",
			"init.license",
		]);
		assert.deepStrictEqual(
			DELTAS.topLevelRefused[12].filter((key) => !DELTAS.topLevelRefused[11].includes(key as never)),
			["email", "certfile", "keyfile"],
		);
	});

	it("accepts the npm 12 strict form: credentials under the registry's nerf-dart key", () => {
		const config = load("//registry.npmjs.org/:_authToken=tok\n//registry.npmjs.org/:email=me@example.com");
		const credential = config.credentialFor("https://registry.npmjs.org/left-pad");
		assert.isTrue(Option.isSome(credential));
		assert.strictEqual(config.settings["//registry.npmjs.org/:email"], "me@example.com");
	});

	it("loads the keys npm 11 refuses at top level, and never uses them as a credential", () => {
		const config = load(DELTAS.topLevelRefused[11].map((key) => `${key}=x`).join("\n"));
		for (const key of DELTAS.topLevelRefused[11]) {
			assert.isTrue(Object.hasOwn(config.secrets, key) || Object.hasOwn(config.settings, key), key);
		}
		assert.isTrue(Option.isNone(config.credentialFor("https://registry.npmjs.org/left-pad")));
	});

	it("loads the keys only npm 12 refuses, and applies none of them", () => {
		const config = load("email=me@example.com\ncertfile=/c.pem\nkeyfile=/k.pem");
		assert.strictEqual(config.settings.email, "me@example.com");
		assert.isTrue(Option.isNone(config.tlsFor("https://registry.npmjs.org/left-pad")));
		assert.isTrue(Option.isNone(config.tlsFor("https://registry.npmjs.org/left-pad", { packageManager: "pnpm" })));
	});
});
