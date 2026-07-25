import { assert, describe, it } from "@effect/vitest";
import { LocalExec } from "@effected/commands";
import { Effect, Exit, Layer, Option, Redacted } from "effect";
import { NpmExecutor } from "../src/NpmExecutor.js";
import { PackagePublish, PackedTarball } from "../src/PackagePublish.js";
import { PublishError } from "../src/PublishError.js";
import type { ScriptResult } from "./publish-fixtures.js";
import { fakeCrypto, recordingFs, scripted } from "./publish-fixtures.js";

const NPMRC = "/home/runner/.npmrc";
const TOKEN = Redacted.make("s3cr3t-token");

/** `npm pack --json` output, as npm emits it (an array of one entry). */
const packJson = JSON.stringify([
	{
		id: "pkg@1.1.0",
		name: "pkg",
		version: "1.1.0",
		filename: "pkg-1.1.0.tgz",
		integrity: "sha512-abc123==",
		size: 2048,
		unpackedSize: 8192,
		entryCount: 12,
	},
]);

interface Harness {
	readonly run: <A, E>(program: Effect.Effect<A, E, PackagePublish>) => Effect.Effect<A, E>;
	readonly spawner: ReturnType<typeof scripted>;
	readonly fs: ReturnType<typeof recordingFs>;
}

const harness = (options?: {
	readonly script?: (command: string, args: ReadonlyArray<string>) => ScriptResult;
	readonly local?: Layer.Layer<LocalExec>;
	readonly files?: Record<string, string>;
}): Harness => {
	const spawner = scripted(options?.script ?? (() => ({ stdout: packJson, exit: 0 })));
	const fs = recordingFs(options?.files ?? {});
	const layer = PackagePublish.layer.pipe(
		Layer.provide(Layer.mergeAll(spawner.layer, fs.layer, fakeCrypto, options?.local ?? LocalExec.layerNone)),
	);
	return { run: (program) => Effect.provide(program, layer), spawner, fs };
};

const publisher = Effect.gen(function* () {
	return yield* PackagePublish;
});

describe("NpmExecutor", () => {
	it.effect("ambient runs the runner's own npm", () =>
		Effect.gen(function* () {
			const command = yield* NpmExecutor.ambient.command(["publish"]);
			assert.strictEqual(command.command, "npm");
			assert.deepStrictEqual([...command.args], ["publish"]);
		}).pipe(Effect.provide(LocalExec.layerNone)),
	);

	it.effect("dlx runs a PINNED npm through the launcher — the OIDC path", () =>
		// `pnpm dlx npm@11 publish` fetches a fresh npm rather than the runner's
		// bundled one, which is what trusted publishing needs (npm >= 11.5.1;
		// GitHub runners ship 10.x).
		Effect.gen(function* () {
			const command = yield* NpmExecutor.dlx("npm@11").command(["publish"]);
			assert.deepStrictEqual([command.command, ...command.args], ["pnpm", "dlx", "npm@11", "publish"]);
		}).pipe(Effect.provide(LocalExec.layerFor("pnpm"))),
	);

	it.effect("dlx without a local launcher fails typed rather than silently running ambient npm", () =>
		// Degrading to the bundled npm here would reintroduce the exact bug the
		// dlx dispatch exists to work around, and it would do it invisibly.
		Effect.gen(function* () {
			const error = yield* Effect.flip(NpmExecutor.dlx("npm@11").command(["publish"]));
			assert.instanceOf(error, PublishError);
			assert.strictEqual(error.kind, "executor");
		}).pipe(Effect.provide(LocalExec.layerNone)),
	);
});

describe("PackagePublish.setupAuth", () => {
	it.effect("writes the auth token to the npmrc, never to argv", () =>
		Effect.gen(function* () {
			const h = harness();
			yield* h.run(
				Effect.flatMap(publisher, (p) =>
					p.setupAuth({ registry: "https://registry.npmjs.org", token: TOKEN, npmrcPath: NPMRC }),
				),
			);
			const written = h.fs.files.get(NPMRC) ?? "";
			assert.include(written, "s3cr3t-token");
			assert.lengthOf(h.spawner.spawns, 0, "setupAuth must not spawn anything — the token stays off the process table");
		}),
	);

	it.effect("nerf-darts the registry key WITH a trailing slash", () =>
		// npm matches `//host/path/:_authToken`. Without the trailing slash the
		// key is never matched and the publish goes out unauthenticated — a v3
		// bug fix that must not regress.
		Effect.gen(function* () {
			const h = harness();
			yield* h.run(
				Effect.flatMap(publisher, (p) =>
					p.setupAuth({ registry: "https://npm.pkg.github.com", token: TOKEN, npmrcPath: NPMRC }),
				),
			);
			assert.include(h.fs.files.get(NPMRC) ?? "", "//npm.pkg.github.com/:_authToken=");
		}),
	);

	it.effect("strips a scheme and preserves a registry path", () =>
		Effect.gen(function* () {
			const h = harness();
			yield* h.run(
				Effect.flatMap(publisher, (p) =>
					p.setupAuth({ registry: "https://example.com/artifactory/api/npm/repo", token: TOKEN, npmrcPath: NPMRC }),
				),
			);
			assert.include(h.fs.files.get(NPMRC) ?? "", "//example.com/artifactory/api/npm/repo/:_authToken=");
		}),
	);

	it.effect("appends to an existing npmrc rather than clobbering it", () =>
		Effect.gen(function* () {
			const h = harness({ files: { [NPMRC]: "registry=https://registry.npmjs.org\n" } });
			yield* h.run(
				Effect.flatMap(publisher, (p) =>
					p.setupAuth({ registry: "https://registry.npmjs.org", token: TOKEN, npmrcPath: NPMRC }),
				),
			);
			const written = h.fs.files.get(NPMRC) ?? "";
			assert.include(written, "registry=https://registry.npmjs.org");
			assert.include(written, "_authToken=");
		}),
	);
});

describe("PackagePublish.pack", () => {
	it.effect("parses npm pack --json into a PackedTarball", () =>
		Effect.gen(function* () {
			const h = harness({ files: { "/repo/pkg/pkg-1.1.0.tgz": "bytes" } });
			const packed = yield* h.run(Effect.flatMap(publisher, (p) => p.pack("/repo/pkg")));
			assert.instanceOf(packed, PackedTarball);
			assert.strictEqual(packed.name, "pkg");
			assert.strictEqual(packed.version, "1.1.0");
			assert.strictEqual(packed.integrity, "sha512-abc123==");
			assert.strictEqual(packed.packedSize, 2048);
			assert.strictEqual(packed.unpackedSize, 8192);
			assert.strictEqual(packed.fileCount, 12);
			assert.include(packed.tarballPath, "pkg-1.1.0.tgz");
		}),
	);

	it.effect("runs npm pack in the package directory", () =>
		Effect.gen(function* () {
			const h = harness({ files: { "/repo/pkg/pkg-1.1.0.tgz": "bytes" } });
			yield* h.run(Effect.flatMap(publisher, (p) => p.pack("/repo/pkg")));
			assert.strictEqual(h.spawner.spawns[0]?.cwd, "/repo/pkg");
			assert.deepStrictEqual([...(h.spawner.spawns[0]?.args ?? [])], ["pack", "--json"]);
		}),
	);

	it.effect("computes a sha256 over the tarball BYTES, distinct from the integrity", () =>
		// The registry's `integrity` (sha512 SRI, base64) and the attestation
		// subject digest (sha256, hex) are different algorithms in different
		// encodings; conflating them is a silent attestation failure.
		Effect.gen(function* () {
			const h = harness({ files: { "/repo/pkg/pkg-1.1.0.tgz": "tarball-bytes" } });
			const packed = yield* h.run(Effect.flatMap(publisher, (p) => p.pack("/repo/pkg")));
			assert.strictEqual(packed.sha256Hex, "0dab", "the fake digest of a 13-byte body, hex-encoded");
			assert.notStrictEqual(packed.sha256Hex, packed.integrity);
		}),
	);

	it.effect("a non-zero npm pack fails typed with kind 'pack'", () =>
		Effect.gen(function* () {
			const h = harness({ script: () => ({ stderr: "npm error code EJSONPARSE", exit: 1 }) });
			const error = yield* Effect.flip(h.run(Effect.flatMap(publisher, (p) => p.pack("/repo/pkg"))));
			assert.instanceOf(error, PublishError);
			assert.strictEqual(error.kind, "pack");
		}),
	);

	it.effect("unreadable pack output fails with kind 'output', not 'pack'", () =>
		Effect.gen(function* () {
			const h = harness({ script: () => ({ stdout: "not json", exit: 0 }) });
			const error = yield* Effect.flip(h.run(Effect.flatMap(publisher, (p) => p.pack("/repo/pkg"))));
			assert.strictEqual(error.kind, "output");
		}),
	);

	it.effect("an unreadable tarball fails with kind 'digest' — npm SUCCEEDED", () =>
		// Reporting this as "npm pack failed" would send a reader to npm's output
		// looking for an error npm never produced. The tarball is deliberately
		// not seeded here.
		Effect.gen(function* () {
			const h = harness();
			const error = yield* Effect.flip(h.run(Effect.flatMap(publisher, (p) => p.pack("/repo/pkg"))));
			assert.strictEqual(error.kind, "digest");
			assert.include(error.message, "could not be read for hashing");
		}),
	);
});

describe("PackagePublish.publishTarball", () => {
	const publishArgs = (h: Harness) => [...(h.spawner.spawns[0]?.args ?? [])];

	it.effect("uploads the named tarball to the named registry", () =>
		Effect.gen(function* () {
			const h = harness({ script: () => ({ stdout: "+ pkg@1.1.0", exit: 0 }) });
			yield* h.run(
				Effect.flatMap(publisher, (p) =>
					p.publishTarball("/tmp/pkg-1.1.0.tgz", { registry: "https://registry.npmjs.org" }),
				),
			);
			const args = publishArgs(h);
			assert.include(args, "publish");
			assert.include(args, "/tmp/pkg-1.1.0.tgz");
			assert.include(args, "--registry");
			assert.include(args, "https://registry.npmjs.org");
		}),
	);

	it.effect("passes tag, access and provenance only when asked", () =>
		Effect.gen(function* () {
			const plain = harness({ script: () => ({ stdout: "ok", exit: 0 }) });
			yield* plain.run(
				Effect.flatMap(publisher, (p) => p.publishTarball("/tmp/t.tgz", { registry: "https://r.example" })),
			);
			assert.notInclude(publishArgs(plain), "--provenance");
			assert.notInclude(publishArgs(plain), "--tag");

			const full = harness({ script: () => ({ stdout: "ok", exit: 0 }) });
			yield* full.run(
				Effect.flatMap(publisher, (p) =>
					p.publishTarball("/tmp/t.tgz", {
						// The public registry, because `--provenance` is npm-only —
						// see the pair of provenance tests below.
						registry: "https://registry.npmjs.org",
						tag: "next",
						access: "public",
						provenance: true,
					}),
				),
			);
			const args = publishArgs(full);
			assert.include(args, "--provenance");
			assert.deepStrictEqual(args.slice(args.indexOf("--tag"), args.indexOf("--tag") + 2), ["--tag", "next"]);
			assert.deepStrictEqual(args.slice(args.indexOf("--access"), args.indexOf("--access") + 2), [
				"--access",
				"public",
			]);
		}),
	);

	it.effect("drops --provenance for a NON-npm registry rather than failing the publish", () =>
		// npm rejects `--provenance` against GitHub Packages. A release publishing
		// to three registries should not lose two of them to one flag.
		Effect.gen(function* () {
			const h = harness({ script: () => ({ stdout: "ok", exit: 0 }) });
			yield* h.run(
				Effect.flatMap(publisher, (p) =>
					p.publishTarball("/tmp/t.tgz", { registry: "https://npm.pkg.github.com", provenance: true }),
				),
			);
			assert.notInclude(publishArgs(h), "--provenance");
		}),
	);

	it.effect("keeps --provenance for the public npm registry", () =>
		Effect.gen(function* () {
			const h = harness({ script: () => ({ stdout: "ok", exit: 0 }) });
			yield* h.run(
				Effect.flatMap(publisher, (p) =>
					p.publishTarball("/tmp/t.tgz", { registry: "https://registry.npmjs.org", provenance: true }),
				),
			);
			assert.include(publishArgs(h), "--provenance");
		}),
	);

	it.effect("captures npm's provenance URL when it prints one", () =>
		Effect.gen(function* () {
			const h = harness({
				script: () => ({
					stdout:
						"npm notice Provenance statement published to transparency log: https://search.sigstore.dev/?logIndex=42\n",
					exit: 0,
				}),
			});
			const outcome = yield* h.run(
				Effect.flatMap(publisher, (p) =>
					p.publishTarball("/tmp/t.tgz", { registry: "https://r.example", provenance: true }),
				),
			);
			assert.deepStrictEqual(outcome.provenanceUrl, Option.some("https://search.sigstore.dev/?logIndex=42"));
		}),
	);

	it.effect("reports no provenance URL when npm printed none", () =>
		Effect.gen(function* () {
			const h = harness({ script: () => ({ stdout: "+ pkg@1.1.0", exit: 0 }) });
			const outcome = yield* h.run(
				Effect.flatMap(publisher, (p) => p.publishTarball("/tmp/t.tgz", { registry: "https://r.example" })),
			);
			assert.isTrue(Option.isNone(outcome.provenanceUrl));
		}),
	);

	it.effect("tokenAuth strips the OIDC environment so npm uses the configured _authToken", () =>
		Effect.gen(function* () {
			const h = harness({ script: () => ({ stdout: "ok", exit: 0 }) });
			yield* h.run(
				Effect.flatMap(publisher, (p) =>
					p.publishTarball("/tmp/t.tgz", { registry: "https://r.example", tokenAuth: true }),
				),
			);
			const env = h.spawner.spawns[0]?.env ?? {};
			assert.strictEqual(env.ACTIONS_ID_TOKEN_REQUEST_URL, "");
			assert.strictEqual(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, "");
		}),
	);

	it.effect("a failed publish fails typed with kind 'publish' and the exit code", () =>
		Effect.gen(function* () {
			const h = harness({ script: () => ({ stderr: "npm error 403 Forbidden", exit: 1 }) });
			const error = yield* Effect.flip(
				h.run(Effect.flatMap(publisher, (p) => p.publishTarball("/tmp/t.tgz", { registry: "https://r.example" }))),
			);
			assert.strictEqual(error.kind, "publish");
			assert.strictEqual(error.exitCode, 1);
			assert.include(error.message, "403");
		}),
	);
});

describe("PackagePublish.dryRun", () => {
	it.effect("a clean dry run reports ok with the sizing", () =>
		Effect.gen(function* () {
			const h = harness();
			const outcome = yield* h.run(Effect.flatMap(publisher, (p) => p.dryRun("/repo/pkg")));
			assert.isTrue(outcome.ok);
			assert.strictEqual(outcome.packedSize, 2048);
			assert.strictEqual(outcome.fileCount, 12);
		}),
	);

	it.effect("a FAILED dry run is a result, not an error", () =>
		// A package that cannot pack is a valid answer to "would this publish?".
		// The error channel is reserved for a structural failure.
		Effect.gen(function* () {
			const h = harness({ script: () => ({ stderr: "npm error Invalid files glob", exit: 1 }) });
			const outcome = yield* h.run(Effect.flatMap(publisher, (p) => p.dryRun("/repo/pkg")));
			assert.isFalse(outcome.ok);
			assert.include(outcome.output, "Invalid files glob");
		}),
	);

	it.effect("passes --dry-run", () =>
		Effect.gen(function* () {
			const h = harness();
			yield* h.run(Effect.flatMap(publisher, (p) => p.dryRun("/repo/pkg")));
			assert.include([...(h.spawner.spawns[0]?.args ?? [])], "--dry-run");
		}),
	);
});

describe("PackagePublish test double", () => {
	it.effect("layerTest answers a stubbed member", () =>
		Effect.gen(function* () {
			const p = yield* PackagePublish;
			const outcome = yield* p.dryRun("/repo/pkg");
			assert.isTrue(outcome.ok);
		}).pipe(
			Effect.provide(
				PackagePublish.layerTest({
					dryRun: () => Effect.succeed({ ok: true, output: "stubbed" }),
				}),
			),
		),
	);

	it.effect("an unstubbed member dies loudly", () =>
		Effect.gen(function* () {
			const p = yield* PackagePublish;
			const exit = yield* Effect.exit(p.pack("/repo/pkg"));
			if (!Exit.isFailure(exit)) assert.fail("expected a defect from an unstubbed member");
			assert.isTrue(exit.cause.reasons.some((reason) => reason._tag === "Die"));
		}).pipe(Effect.provide(PackagePublish.layerTest())),
	);
});
