import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Redacted } from "effect";
import type { GitHubClientOptions } from "../src/GitHubClient.js";
import { GitHubClient } from "../src/GitHubClient.js";
import { GitHubError } from "../src/GitHubError.js";
import { GitHubRelease, ReleaseInfo } from "../src/GitHubRelease.js";
import { uploadsBaseUrlFor } from "../src/internal/uploads.js";
import { Repo } from "../src/Repo.js";
import { RetryPolicy } from "../src/Resilience.js";
import type { ScriptedFetch } from "./fixtures.js";
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

const upload = (release: ReleaseInfo, client: Layer.Layer<GitHubClient>) =>
	Effect.flatMap(GitHubRelease, (releases) =>
		releases.uploadAsset(release, { name: "app.zip", data: "bytes", contentType: "application/zip" }),
	).pipe(Effect.provide(GitHubRelease.layer.pipe(Layer.provideMerge(Layer.mergeAll(client, Repo.layer(REPO))))));

describe("GitHubRelease.uploadAsset upload host", () => {
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
			assert.isFalse(script.calls.some((recorded) => recorded.url.includes("github.com")));
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

describe("uploadsBaseUrlFor", () => {
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
