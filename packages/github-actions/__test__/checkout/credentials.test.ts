import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Exit, FileSystem, Layer, Option, Path, PlatformError, Schema } from "effect";
import { CredentialRecord, includeIfKeys, temporaryGlobalConfig } from "../../src/internal/checkout/credentials.js";

describe("includeIfKeys", () => {
	it("writes the host and container pairs for a POSIX checkout", () => {
		const entries = includeIfKeys({
			gitDir: "/home/runner/work/repo/repo/lib/.git",
			workspace: "/home/runner/work/repo/repo",
			credentialsFile: "/home/runner/work/_temp/git-credentials-1234.config",
		});
		assert.deepStrictEqual(entries, [
			{
				key: "includeIf.gitdir:/home/runner/work/repo/repo/lib/.git.path",
				value: "/home/runner/work/_temp/git-credentials-1234.config",
			},
			{
				key: "includeIf.gitdir:/home/runner/work/repo/repo/lib/.git/worktrees/*.path",
				value: "/home/runner/work/_temp/git-credentials-1234.config",
			},
			{
				key: "includeIf.gitdir:/github/workspace/lib/.git.path",
				value: "/github/runner_temp/git-credentials-1234.config",
			},
			{
				key: "includeIf.gitdir:/github/workspace/lib/.git/worktrees/*.path",
				value: "/github/runner_temp/git-credentials-1234.config",
			},
		]);
	});

	it("uses forward slashes in every key for a Windows checkout", () => {
		const entries = includeIfKeys({
			gitDir: "D:\\a\\repo\\repo\\sub dir\\.git",
			workspace: "D:\\a\\repo\\repo",
			credentialsFile: "D:\\a\\_temp\\git-credentials-abcd.config",
		});
		assert.deepStrictEqual(
			entries.map((entry) => entry.key),
			[
				"includeIf.gitdir:D:/a/repo/repo/sub dir/.git.path",
				"includeIf.gitdir:D:/a/repo/repo/sub dir/.git/worktrees/*.path",
				"includeIf.gitdir:/github/workspace/sub dir/.git.path",
				"includeIf.gitdir:/github/workspace/sub dir/.git/worktrees/*.path",
			],
		);
		assert.strictEqual(entries[0]?.value, "D:\\a\\_temp\\git-credentials-abcd.config");
		assert.strictEqual(entries[2]?.value, "/github/runner_temp/git-credentials-abcd.config");
	});

	it("maps a checkout at the workspace root to /github/workspace/.git", () => {
		const entries = includeIfKeys({
			gitDir: "/home/runner/work/repo/repo/.git",
			workspace: "/home/runner/work/repo/repo/",
			credentialsFile: "/tmp/git-credentials-1.config",
		});
		assert.strictEqual(entries[2]?.key, "includeIf.gitdir:/github/workspace/.git.path");
		assert.strictEqual(entries[3]?.key, "includeIf.gitdir:/github/workspace/.git/worktrees/*.path");
	});

	it("omits the worktree pair when asked, as a submodule's entries do", () => {
		const entries = includeIfKeys({
			gitDir: "/w/.git/modules/sub",
			workspace: "/w",
			credentialsFile: "/t/git-credentials-1.config",
			worktrees: false,
		});
		assert.deepStrictEqual(
			entries.map((entry) => entry.key),
			["includeIf.gitdir:/w/.git/modules/sub.path", "includeIf.gitdir:/github/workspace/.git/modules/sub.path"],
		);
	});
});

describe("CredentialRecord", () => {
	it("survives a plain JSON round trip through its encoded form", () => {
		const record = CredentialRecord.make({
			repositoryPath: "/w/repo",
			origin: "https://github.com",
			credentialsFile: Option.some("/t/git-credentials-1.config"),
			sshKeyPath: Option.none(),
			knownHostsPath: Option.none(),
			temporaryGlobalConfig: Option.some("/t/abc/.gitconfig"),
			safeDirectory: true,
			submodules: false,
		});
		const encoded = Schema.encodeSync(CredentialRecord)(record);
		const decoded = Schema.decodeUnknownSync(CredentialRecord)(JSON.parse(JSON.stringify(encoded)));
		assert.deepStrictEqual(decoded, record);
	});
});

describe("temporaryGlobalConfig", () => {
	const layer = (files: Record<string, string>) =>
		Layer.mergeAll(MemoryFileSystem.layerWith(files), Path.layer, NodeCrypto.layerSecureRandom);

	it.effect("seeds the file from the user's global config", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const file = yield* temporaryGlobalConfig(Option.some("/home/me"), "/runner/temp");
			assert.match(file, /^\/runner\/temp\/[0-9a-f-]{36}\/\.gitconfig$/);
			assert.strictEqual(yield* fs.readFileString(file), "[user]\n\tname = me\n");
		}).pipe(Effect.provide(layer({ "/home/me/.gitconfig": "[user]\n\tname = me\n", "/runner/temp/.keep": "" }))),
	);

	it.effect("writes an empty file when there is no global config", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const file = yield* temporaryGlobalConfig(Option.some("/home/me"), "/runner/temp");
			assert.strictEqual(yield* fs.readFileString(file), "");
			const none = yield* temporaryGlobalConfig(Option.none(), "/runner/temp");
			assert.notStrictEqual(none, file);
			assert.strictEqual(yield* fs.readFileString(none), "");
		}).pipe(Effect.provide(layer({ "/runner/temp/.keep": "" }))),
	);

	it.effect("removes its directory when seeding the file fails", () => {
		const denied = (path: string) =>
			Effect.fail(
				PlatformError.systemError({
					_tag: "PermissionDenied",
					module: "FileSystem",
					method: "copyFile",
					pathOrDescriptor: path,
				}),
			);
		return Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const exit = yield* Effect.exit(temporaryGlobalConfig(Option.some("/home/me"), "/runner/temp"));
			assert.isTrue(Exit.isFailure(exit));
			assert.deepStrictEqual(yield* fs.readDirectory("/runner/temp"), [".keep"]);
		}).pipe(
			Effect.provide(
				Layer.mergeAll(
					MemoryFileSystem.layerWith(
						{ "/home/me/.gitconfig": "[user]\n", "/runner/temp/.keep": "" },
						{ faults: { copyFile: (from) => denied(from) } },
					),
					Path.layer,
					NodeCrypto.layerSecureRandom,
				),
			),
		);
	});
});
