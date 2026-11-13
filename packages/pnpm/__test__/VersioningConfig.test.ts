// The `versioning` block of pnpm-workspace.yaml and PnpmSettings' typed read.
//
// Field shapes, read off pnpm 12's source (.repos/pnpm/pnpm):
// - crates/versioning/src/settings.rs:68-94 VersioningSettings: fixed
//   (Vec<Vec<String>>), epics, ignore (Vec<String>), maxBump, lanes
//   (IndexMap<String, String>), changelog.
// - settings.rs:5-15 ReleaseBumpType is patch | minor | major, so `none` is
//   not a bump; settings.rs:17-24 ChangelogStorage is registry | repository;
//   settings.rs:40-46 ChangelogSettings has format and storage.
// - settings.rs:54-63 EpicSettings is { lead, packages }.
// - crates/cli/src/cli_args/lane.rs:203-215 check_lane_name: `main` is
//   reserved (compared ignoring ASCII case), a name must be ASCII
//   alphanumerics and hyphens only, and not purely numeric.
// - docs/versioning.md:70 and docs/settings/versioning.md:9 allow `./dir`
//   selectors in fixed, ignore and the lane keys.
// - crates/config/src/workspace_yaml/workspace_scope.rs:60 clears `versioning`
//   from the global config: it is workspace-only.

import { assert, describe, it } from "@effect/vitest";
import { Option, Result, Schema } from "effect";
import { PnpmSettings, VersioningConfig } from "../src/index.js";

const decode = Schema.decodeUnknownResult(VersioningConfig);

const FULL = {
	fixed: [["@example/cli", "@example/napi"]],
	ignore: ["@example/internal"],
	maxBump: "minor",
	lanes: { "@example/cli": "alpha" },
	epics: [{ lead: "@example/app", packages: ["./packages/**", "!./packages/private-*"] }],
	changelog: { format: "keep-a-changelog", storage: "repository" },
};

describe("VersioningConfig", () => {
	it("decodes the full example block", () => {
		const result = decode(FULL);
		assert.isTrue(Result.isSuccess(result));
		if (Result.isSuccess(result)) {
			assert.strictEqual(result.success.maxBump, "minor");
			assert.deepStrictEqual(result.success.lanes, { "@example/cli": "alpha" });
			assert.strictEqual(result.success.epics?.[0]?.lead, "@example/app");
			assert.strictEqual(result.success.changelog?.storage, "repository");
		}
	});

	it("an empty block decodes with every key absent", () => {
		const result = decode({});
		assert.isTrue(Result.isSuccess(result));
		if (Result.isSuccess(result)) assert.strictEqual(result.success.lanes, undefined);
	});

	it("rejects a lane named main, in any case", () => {
		assert.isTrue(Result.isFailure(decode({ lanes: { "@a/b": "main" } })));
		assert.isTrue(Result.isFailure(decode({ lanes: { "@a/b": "Main" } })));
	});

	it("rejects a purely numeric lane", () => {
		assert.isTrue(Result.isFailure(decode({ lanes: { "@a/b": "123" } })));
		assert.isTrue(Result.isSuccess(decode({ lanes: { "@a/b": "1-rc" } })));
	});

	it("rejects a lane with a character other than alphanumerics and hyphens", () => {
		assert.isTrue(Result.isFailure(decode({ lanes: { "@a/b": "al.pha" } })));
		assert.isTrue(Result.isFailure(decode({ lanes: { "@a/b": "" } })));
		assert.isTrue(Result.isSuccess(decode({ lanes: { "@a/b": "next-2" } })));
	});

	it("rejects maxBump: none", () => {
		assert.isTrue(Result.isFailure(decode({ maxBump: "none" })));
		assert.isTrue(Result.isSuccess(decode({ maxBump: "patch" })));
		assert.isTrue(Result.isSuccess(decode({ maxBump: "major" })));
	});

	it("rejects an unknown changelog storage", () => {
		assert.isTrue(Result.isFailure(decode({ changelog: { storage: "git" } })));
	});

	it("accepts ./dir selectors in fixed, ignore and the lane keys", () => {
		const result = decode({
			fixed: [["./packages/cli", "./packages/napi"]],
			ignore: ["./packages/internal"],
			lanes: { "./packages/cli": "beta" },
		});
		assert.isTrue(Result.isSuccess(result));
	});

	it("an epic needs a lead and packages", () => {
		assert.isTrue(Result.isFailure(decode({ epics: [{ lead: "a" }] })));
		assert.isTrue(Result.isFailure(decode({ epics: [{ packages: ["x"] }] })));
	});
});

describe("PnpmSettings.versioning", () => {
	const settingsOf = (workspace: string, global = "") => {
		const result = PnpmSettings.fromSourcesResult({
			workspace: { text: workspace, path: "/r/pnpm-workspace.yaml" },
			global: { text: global, path: "/h/config.yaml" },
		});
		if (Result.isFailure(result)) throw new Error("unexpected");
		return result.success;
	};

	it("is None when the key is absent", () => {
		assert.deepStrictEqual(settingsOf("minimumReleaseAge: 5\n").versioning(), Result.succeed(Option.none()));
	});

	it("decodes the workspace block", () => {
		const read = settingsOf("versioning:\n  maxBump: minor\n  lanes:\n    '@a/b': alpha\n").versioning();
		assert.isTrue(Result.isSuccess(read));
		if (Result.isSuccess(read) && Option.isSome(read.success)) {
			assert.strictEqual(read.success.value.maxBump, "minor");
		} else assert.fail("expected Some");
	});

	it("never reads the global file: versioning is workspace-only", () => {
		const read = settingsOf("", "versioning:\n  maxBump: minor\n").versioning();
		assert.deepStrictEqual(read, Result.succeed(Option.none()));
	});

	it("fails with reason shape when the block does not decode", () => {
		const read = settingsOf("versioning:\n  maxBump: none\n").versioning();
		assert.isTrue(Result.isFailure(read));
		if (Result.isFailure(read)) {
			assert.strictEqual(read.failure.reason, "shape");
			assert.strictEqual(read.failure.path, undefined);
		}
	});

	it("a non-mapping versioning value fails with reason shape", () => {
		const read = settingsOf("versioning: 3\n").versioning();
		assert.isTrue(Result.isFailure(read) && read.failure.reason === "shape");
	});
});
