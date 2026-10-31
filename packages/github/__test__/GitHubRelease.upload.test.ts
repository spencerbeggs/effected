import { generateKeyPairSync } from "node:crypto";
import { assert, layer } from "@effect/vitest";
import { DateTime, Duration, Effect, Layer, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { GitHubApp } from "../src/GitHubApp.js";
import type { GitHubClientOptions } from "../src/GitHubClient.js";
import { GitHubClient } from "../src/GitHubClient.js";
import { GitHubError } from "../src/GitHubError.js";
import { GitHubRelease, ReleaseInfo } from "../src/GitHubRelease.js";
import { uploadsBaseUrlFor } from "../src/internal/uploads.js";
import { Repo } from "../src/Repo.js";
import { RetryPolicy } from "../src/Resilience.js";
import { CryptoLive } from "./crypto.js";
import type { Reply, ScriptedFetch } from "./fixtures.js";
import { scriptedFetch } from "./fixtures.js";
import { REPO } from "./harness.js";

// The token's destination is the whole point of these tests, so every one of
// them drives the REAL octokit client over a scripted fetch and reads the URL
// and authorization header the wire actually carried.

const ASSET = { id: 9, name: "app.zip", browser_download_url: "https://d/9", size: 12 };

const releaseWith = (uploadUrl: string): ReleaseInfo =>
	ReleaseInfo.make({
		id: 5,
		tag: "v1.0.0",
		name: "",
		body: "",
		draft: false,
		prerelease: false,
		url: "https://x/5",
		uploadUrl,
	});

const DOTCOM_UPLOAD_URL = "https://uploads.github.com/repos/acme/widget/releases/5/assets{?name,label}";
const GHES_UPLOAD_URL = "https://ghe.example/api/uploads/repos/acme/widget/releases/5/assets{?name,label}";

const clientLayer = (script: ScriptedFetch, options: Partial<GitHubClientOptions> = {}) =>
	GitHubClient.layerFromToken({
		token: Redacted.make("ghs_secret"),
		fetch: script.fetch,
		retry: RetryPolicy.none,
		...options,
	});

const upload = <E, R>(release: ReleaseInfo, client: Layer.Layer<GitHubClient, E, R>) =>
	Effect.flatMap(GitHubRelease, (releases) =>
		releases.uploadAsset(release, { name: "app.zip", data: "bytes", contentType: "application/zip" }),
	).pipe(Effect.provide(GitHubRelease.layer.pipe(Layer.provideMerge(Layer.mergeAll(client, Repo.layer(REPO))))));

layer(CryptoLive, { buildPerTest: true })("GitHubRelease.uploadAsset upload host", (it) => {
	it.effect("a GitHub Enterprise Server client uploads to its own /api/uploads, token attached", () =>
		Effect.gen(function* () {
			const script = scriptedFetch([{ status: 201, body: ASSET }]);
			const asset = yield* upload(
				releaseWith(GHES_UPLOAD_URL),
				clientLayer(script, { baseUrl: "https://ghe.example/api/v3" }),
			);
			assert.strictEqual(asset.id, 9);
			assert.strictEqual(script.count(), 1);
			const call = script.calls[0];
			assert.strictEqual(call?.method, "POST");
			assert.strictEqual(new URL(call?.url ?? "").origin, "https://ghe.example");
			assert.strictEqual(call?.path, "/api/uploads/repos/acme/widget/releases/5/assets");
			assert.strictEqual(script.queryOf(0).get("name"), "app.zip");
			assert.strictEqual(call?.headers.authorization, "token ghs_secret");
			// Hosts compared parsed and exact: a substring match on "github.com"
			// would also accept "github.com.attacker.example".
			assert.deepStrictEqual(
				script.calls.map((recorded) => new URL(recorded.url).host),
				["ghe.example"],
			);
		}),
	);

	it.effect("a github.com client still uploads to uploads.github.com", () =>
		Effect.gen(function* () {
			for (const options of [{}, { baseUrl: "https://api.github.com" }, { baseUrl: "https://api.github.com//" }]) {
				const script = scriptedFetch([{ status: 201, body: ASSET }]);
				yield* upload(releaseWith(DOTCOM_UPLOAD_URL), clientLayer(script, options));
				const label = JSON.stringify(options);
				assert.strictEqual(script.count(), 1, label);
				assert.strictEqual(new URL(script.calls[0]?.url ?? "").origin, "https://uploads.github.com", label);
				assert.strictEqual(script.calls[0]?.path, "/repos/acme/widget/releases/5/assets", label);
				assert.strictEqual(script.calls[0]?.headers.authorization, "token ghs_secret", label);
			}
		}),
	);

	it.effect("a release whose upload URL names a foreign host is refused before anything is sent", () =>
		Effect.gen(function* () {
			const cases: ReadonlyArray<readonly [string, Partial<GitHubClientOptions>, string]> = [
				["dotcom client, attacker host", {}, "https://attacker.example/repos/acme/widget/releases/5/assets{?name}"],
				["GHES client, attacker host", { baseUrl: "https://ghe.example/api/v3" }, "https://attacker.example/x"],
				// The incident: a GHES token offered github.com's upload host.
				["GHES client, github.com host", { baseUrl: "https://ghe.example/api/v3" }, DOTCOM_UPLOAD_URL],
				["dotcom client, GHES host", {}, GHES_UPLOAD_URL],
				["dotcom client, no absolute URL", {}, "/repos/acme/widget/releases/5/assets"],
			];
			for (const [label, options, uploadUrl] of cases) {
				const script = scriptedFetch([{ status: 201, body: ASSET }]);
				const error = yield* Effect.flip(upload(releaseWith(uploadUrl), clientLayer(script, options)));
				assert.instanceOf(error, GitHubError, label);
				assert.strictEqual(error.kind, "rejected", label);
				assert.strictEqual(error.operation, "GitHubRelease.uploadAsset", label);
				assert.isUndefined(error.status, label);
				assert.strictEqual(script.count(), 0, `${label}: nothing may reach the wire`);
			}
		}),
	);

	it.effect("a client spread from a built one keeps its configured base", () =>
		Effect.gen(function* () {
			const script = scriptedFetch([{ status: 201, body: ASSET }]);
			const wrapped = Layer.effect(
				GitHubClient,
				Effect.map(GitHubClient, (client) => ({ ...client })),
			).pipe(Layer.provide(clientLayer(script, { baseUrl: "https://ghe.example/api/v3" })));
			yield* upload(releaseWith(GHES_UPLOAD_URL), wrapped);
			assert.strictEqual(new URL(script.calls[0]?.url ?? "").origin, "https://ghe.example");
			assert.strictEqual(script.calls[0]?.path, "/api/uploads/repos/acme/widget/releases/5/assets");
		}),
	);

	it.effect("a client shape built elsewhere is read as github.com, so a GHES release is refused", () =>
		Effect.gen(function* () {
			let called = 0;
			const handBuilt = GitHubClient.layerTest({
				requestDecoded: () =>
					Effect.sync(() => {
						called += 1;
					}).pipe(Effect.as(ASSET as never)),
			});
			const error = yield* Effect.flip(upload(releaseWith(GHES_UPLOAD_URL), handBuilt));
			assert.strictEqual(error.kind, "rejected");
			assert.strictEqual(called, 0);
			// Control: the same double accepts a github.com release.
			yield* upload(releaseWith(DOTCOM_UPLOAD_URL), handBuilt);
			assert.strictEqual(called, 1);
		}),
	);
});

layer(CryptoLive, { buildPerTest: true })("GitHubRelease.uploadAsset under GitHub App auth", (it) => {
	// The App layers build their client through a rotating facade over a live
	// inner client; these drive the real octokit client underneath it.
	const { privateKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
		privateKeyEncoding: { type: "pkcs8", format: "pem" },
		publicKeyEncoding: { type: "spki", format: "pem" },
	});
	const CREDENTIALS = { appId: "Iv1.upload", privateKey: Redacted.make(privateKey) };
	const GHES_BASE = "https://ghe.example/api/v3";
	/** A realistic wall clock for the JWT; TestClock otherwise starts at the epoch. */
	const NOW_MILLIS = 1_800_000_000_000;

	const tokenReply = (token: string, expiresAt = "2099-01-01T00:00:00Z"): Reply => ({
		status: 201,
		body: { token, expires_at: expiresAt, permissions: { contents: "write" } },
	});

	const installationLayer = (script: ScriptedFetch, baseUrl?: string) =>
		GitHubApp.clientLayer(
			{ ...CREDENTIALS, installationId: 42 },
			{ fetch: script.fetch, retry: RetryPolicy.none, ...(baseUrl === undefined ? {} : { baseUrl }) },
		);

	const appLayer = (script: ScriptedFetch, baseUrl?: string) =>
		GitHubApp.appClientLayer(CREDENTIALS, {
			fetch: script.fetch,
			retry: RetryPolicy.none,
			...(baseUrl === undefined ? {} : { baseUrl }),
		});

	/** The recorded call that POSTed the asset; exactly one must exist. */
	const uploadCall = (script: ScriptedFetch) => {
		const posts = script.calls.filter((call) => call.method === "POST" && call.path.endsWith("/assets"));
		assert.lengthOf(posts, 1, "exactly one asset upload reached the wire");
		const call = posts[0];
		if (call === undefined) return assert.fail("no upload call");
		return call;
	};

	it.effect("a github.com installation uploads to uploads.github.com with the installation token", () =>
		Effect.gen(function* () {
			const script = scriptedFetch([tokenReply("ghs_installation"), { status: 201, body: ASSET }, { status: 204 }]);
			const asset = yield* upload(releaseWith(DOTCOM_UPLOAD_URL), installationLayer(script));
			assert.strictEqual(asset.id, 9);
			const call = uploadCall(script);
			assert.strictEqual(new URL(call.url).origin, "https://uploads.github.com");
			assert.strictEqual(call.path, "/repos/acme/widget/releases/5/assets");
			assert.strictEqual(call.headers.authorization, "token ghs_installation");
		}),
	);

	it.effect("a GHES installation uploads to <ghes>/api/uploads", () =>
		Effect.gen(function* () {
			const script = scriptedFetch([tokenReply("ghs_installation"), { status: 201, body: ASSET }, { status: 204 }]);
			yield* upload(releaseWith(GHES_UPLOAD_URL), installationLayer(script, GHES_BASE));
			const call = uploadCall(script);
			assert.strictEqual(new URL(call.url).origin, "https://ghe.example");
			assert.strictEqual(call.path, "/api/uploads/repos/acme/widget/releases/5/assets");
			assert.strictEqual(call.headers.authorization, "token ghs_installation");
			assert.deepStrictEqual(
				[...new Set(script.calls.map((recorded) => new URL(recorded.url).host))],
				["ghe.example"],
				"nothing goes to github.com",
			);
		}),
	);

	it.effect("an upload after a token rotation carries the new token", () =>
		Effect.gen(function* () {
			const epoch = DateTime.toDateUtc(DateTime.makeUnsafe(0)).toISOString();
			const script = scriptedFetch([
				tokenReply("ghs_first", epoch),
				{ status: 204 }, // revoke of the first
				tokenReply("ghs_second"),
				{ status: 201, body: ASSET },
				{ status: 204 }, // revoke on scope close
			]);
			yield* Effect.provide(
				Effect.gen(function* () {
					// The first token expired at the epoch, where the TestClock starts,
					// so the upload must rotate first.
					yield* TestClock.adjust(Duration.seconds(1));
					const releases = yield* GitHubRelease;
					yield* releases.uploadAsset(releaseWith(DOTCOM_UPLOAD_URL), {
						name: "app.zip",
						data: "bytes",
						contentType: "application/zip",
					});
				}),
				GitHubRelease.layer.pipe(Layer.provideMerge(Layer.mergeAll(installationLayer(script), Repo.layer(REPO)))),
			);
			const call = uploadCall(script);
			assert.strictEqual(new URL(call.url).origin, "https://uploads.github.com");
			assert.strictEqual(call.headers.authorization, "token ghs_second");
		}),
	);

	it.effect("an App-JWT client uploads to the derived host on github.com and GHES", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(NOW_MILLIS);
			const cases: ReadonlyArray<readonly [string | undefined, string, string, string]> = [
				[undefined, DOTCOM_UPLOAD_URL, "https://uploads.github.com", "/repos/acme/widget/releases/5/assets"],
				[GHES_BASE, GHES_UPLOAD_URL, "https://ghe.example", "/api/uploads/repos/acme/widget/releases/5/assets"],
			];
			for (const [baseUrl, uploadUrl, origin, path] of cases) {
				const label = String(baseUrl);
				const script = scriptedFetch([{ status: 201, body: ASSET }]);
				yield* upload(releaseWith(uploadUrl), appLayer(script, baseUrl));
				const call = uploadCall(script);
				assert.strictEqual(new URL(call.url).origin, origin, label);
				assert.strictEqual(call.path, path, label);
				assert.isTrue((call.headers.authorization ?? "").startsWith("bearer "), label);
			}
		}),
	);
});

layer(CryptoLive, { buildPerTest: true })("uploadsBaseUrlFor", (it) => {
	it("derives the upload host from the configured REST base alone", () => {
		const table: ReadonlyArray<readonly [string | undefined, string]> = [
			[undefined, "https://uploads.github.com"],
			["https://api.github.com", "https://uploads.github.com"],
			["https://api.github.com/", "https://uploads.github.com"],
			["https://ghe.example/api/v3", "https://ghe.example/api/uploads"],
			["https://ghe.example/api/v3/", "https://ghe.example/api/uploads"],
			["https://ghe.example:8443/api/v3", "https://ghe.example:8443/api/uploads"],
			// Not a recognised shape: stay on the configured host, never invent one.
			["https://proxy.internal/github", "https://proxy.internal/github"],
		];
		for (const [base, expected] of table) assert.strictEqual(uploadsBaseUrlFor(base), expected, String(base));
	});
});
