// The parity harness's comparator, over real git: two checkouts of one `file://` remote into
// differently named directories, each with a credentials file of its own UUID, must snapshot
// equal; one changed `.git/config` key must be named by `diff`.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { diff, snapshot } from "./harness/src/compare.js";

const ENV = { ...process.env, LC_ALL: "C", GIT_ALLOW_PROTOCOL: "file" };
const git = (cwd: string, args: ReadonlyArray<string>): string =>
	execFileSync(
		"git",
		[
			"-c",
			"user.name=t",
			"-c",
			"user.email=t@t",
			"-c",
			"init.defaultBranch=main",
			"-c",
			"protocol.file.allow=always",
			...args,
		],
		{ cwd, env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	).trim();

let root: string;
let remote: string;

beforeAll(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "parity-compare-")));
	const work = join(root, "work");
	await mkdir(work, { recursive: true });
	git(work, ["init", "-q"]);
	await writeFile(join(work, "README.md"), "readme\n");
	git(work, ["add", "."]);
	git(work, ["commit", "-q", "-m", "first"]);
	git(work, ["tag", "-a", "v1", "-m", "v1"]);
	remote = join(root, "remote.git");
	git(root, ["clone", "-q", "--bare", work, remote]);
});

afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

/** A checkout in `name/` with a credentials file `git-credentials-<id>.config` wired by `includeIf`. */
const checkout = async (name: string, id: string, token: string): Promise<string> => {
	const dir = join(root, name);
	git(root, ["clone", "-q", `file://${remote}`, dir]);
	const creds = join(root, `git-credentials-${id}.config`);
	const header = Buffer.from(`x-access-token:${token}`).toString("base64");
	await writeFile(creds, `[http "https://github.com/"]\n\textraheader = AUTHORIZATION: basic ${header}\n`);
	git(dir, ["config", "--local", `includeIf.gitdir:${join(dir, ".git")}/.path`, creds]);
	git(dir, ["config", "--local", "core.sshCommand", `ssh -i "${join(root, `git-credentials-${id}`)}"`]);
	return dir;
};

describe("parity comparator", () => {
	it.effect("snapshots two checkouts of one remote equal despite directory names, UUIDs and tokens", () =>
		Effect.gen(function* () {
			const a = yield* Effect.promise(() =>
				checkout("official", "11111111-1111-1111-1111-111111111111", "ghs_aaaaaaaaaaaa"),
			);
			const b = yield* Effect.promise(() =>
				checkout("kit", "22222222-2222-2222-2222-222222222222", "ghs_bbbbbbbbbbbb"),
			);
			const [sa, sb] = [yield* snapshot(a), yield* snapshot(b)];
			assert.deepStrictEqual(diff(sa, sb), []);
			assert.isTrue(sa.credentials.includes("<token>"));
			assert.isFalse(sa.credentials.includes("ghs_"));
			assert.isTrue(sa.files.includes("README.md"));
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("names a changed config key", () =>
		Effect.gen(function* () {
			const a = yield* Effect.promise(() => checkout("a2", "33333333-3333-3333-3333-333333333333", "ghs_x"));
			const b = yield* Effect.promise(() => checkout("b2", "44444444-4444-4444-4444-444444444444", "ghs_x"));
			git(b, ["config", "--local", "core.autocrlf", "true"]);
			const lines = diff(yield* snapshot(a), yield* snapshot(b));
			assert.isTrue(lines.some((line) => line.includes("core.autocrlf")));
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("redacts an extraheader token left in the local config", () =>
		Effect.gen(function* () {
			const dir = yield* Effect.promise(() => checkout("leak", "55555555-5555-5555-5555-555555555555", "ghs_y"));
			const header = Buffer.from("x-access-token:ghs_leaked").toString("base64");
			git(dir, ["config", "--local", "http.https://github.com/.extraheader", `AUTHORIZATION: basic ${header}`]);
			const snap = yield* snapshot(dir);
			const text = snap.config.join("\n");
			assert.isTrue(text.includes("basic <token>"));
			assert.isFalse(text.includes(header));
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});
