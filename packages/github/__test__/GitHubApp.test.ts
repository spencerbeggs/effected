import { generateKeyPairSync, verify } from "node:crypto";
import { assert, describe, it } from "@effect/vitest";
import { JwtError } from "@effected/jwt";
import { DateTime, Duration, Effect, Option, Redacted, Schema } from "effect";
import { TestClock } from "effect/testing";
import { AppIdentity, BotIdentity, GitHubApp, Installation, InstallationToken } from "../src/GitHubApp.js";
import { GitHubClient } from "../src/GitHubClient.js";
import { RetryPolicy } from "../src/Resilience.js";
import type { Reply } from "./fixtures.js";
import { scriptedFetch } from "./fixtures.js";

/**
 * A real PKCS#8 RSA key, generated once. The JWT signer performs genuine RS256
 * signing, so there is nothing to stub — and this is what proves the signer
 * works at all, which a stubbed one could not.
 */
const { privateKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
	publicKeyEncoding: { type: "spki", format: "pem" },
});

const CREDENTIALS = { appId: "Iv1.test", privateKey: Redacted.make(privateKey) };

const NO_RETRY = RetryPolicy.none;

/** An installation-token payload as GitHub sends it. */
const tokenReply = (options: { expiresAt?: string; token?: string } = {}): Reply => ({
	status: 201,
	body: {
		token: options.token ?? "ghs_installation",
		expires_at: options.expiresAt ?? "2099-01-01T00:00:00Z",
		permissions: { contents: "write", metadata: "read" },
	},
});

const withApp = <A, E>(
	replies: ReadonlyArray<Reply>,
	use: (app: GitHubApp["Service"], script: ReturnType<typeof scriptedFetch>) => Effect.Effect<A, E>,
): Effect.Effect<A, E> =>
	Effect.gen(function* () {
		const script = scriptedFetch(replies);
		return yield* Effect.provide(
			Effect.flatMap(GitHubApp, (app) => use(app, script)),
			GitHubApp.layerWith({ fetch: script.fetch, retry: NO_RETRY }),
		);
	});

describe("GitHubApp.token", () => {
	it.effect("mints an installation token against a known installation", () =>
		withApp([tokenReply()], (app, script) =>
			Effect.gen(function* () {
				const token = yield* app.token({ ...CREDENTIALS, installationId: 42 });
				assert.strictEqual(Redacted.value(token.token), "ghs_installation");
				assert.strictEqual(token.installationId, 42);
				assert.deepStrictEqual({ ...token.permissions }, { contents: "write", metadata: "read" });
				// One call: a known installation id needs no discovery.
				assert.strictEqual(script.count(), 1);
				assert.include(script.calls[0]?.url ?? "", "/app/installations/42/access_tokens");
			}),
		),
	);

	it.effect("authenticates the mint with a JWT bearer, not a token", () =>
		withApp([tokenReply()], (app, script) =>
			Effect.gen(function* () {
				yield* app.token({ ...CREDENTIALS, installationId: 42 });
				const authorization = script.calls[0]?.headers.authorization ?? "";
				// octokit's auth-token emits `bearer` for a three-segment JWT and
				// `token` otherwise, which is exactly the distinction the app and
				// installation credentials need — so no separate auth strategy exists.
				assert.isTrue(authorization.startsWith("bearer "), authorization);
				assert.lengthOf(authorization.slice("bearer ".length).split("."), 3);
			}),
		),
	);

	it.effect("discovers the installation for an owner", () =>
		withApp(
			[
				{
					status: 200,
					body: [
						{ id: 7, account: { login: "Acme" } },
						{ id: 9, account: { login: "other" } },
					],
				},
				tokenReply(),
			],
			(app, script) =>
				Effect.gen(function* () {
					// Case-insensitive: GitHub's login casing is display casing.
					const token = yield* app.token({ ...CREDENTIALS, owner: "acme" });
					assert.strictEqual(token.installationId, 7);
					assert.include(script.calls[1]?.url ?? "", "/app/installations/7/access_tokens");
				}),
		),
	);

	it.effect("names the available installations when the owner has none", () =>
		withApp([{ status: 200, body: [{ id: 7, account: { login: "acme" } }] }], (app) =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(app.token({ ...CREDENTIALS, owner: "nobody" }));
				assert.strictEqual(error.kind, "installation");
				assert.include(error.reason, "nobody");
				assert.include(error.reason, "acme");
			}),
		),
	);

	it.effect("uses the sole installation when neither id nor owner is given", () =>
		withApp([{ status: 200, body: [{ id: 5, account: { login: "solo" } }] }, tokenReply()], (app) =>
			Effect.gen(function* () {
				const token = yield* app.token(CREDENTIALS);
				assert.strictEqual(token.installationId, 5);
			}),
		),
	);

	it.effect("refuses to guess between several installations", () =>
		withApp(
			[
				{
					status: 200,
					body: [
						{ id: 1, account: { login: "a" } },
						{ id: 2, account: { login: "b" } },
					],
				},
			],
			(app) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(app.token(CREDENTIALS));
					assert.strictEqual(error.kind, "installation");
					assert.include(error.reason, "2 installations");
				}),
		),
	);

	it.effect("reports no installations honestly", () =>
		withApp([{ status: 200, body: [] }], (app) =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(app.token(CREDENTIALS));
				assert.include(error.reason, "no installations");
			}),
		),
	);

	it.effect("surfaces a mint rejection as a token failure", () =>
		withApp([{ status: 404, body: { message: "Not Found" } }], (app) =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(app.token({ ...CREDENTIALS, installationId: 42 }));
				assert.strictEqual(error.kind, "token");
				assert.strictEqual(error._tag, "GitHubAppError");
			}),
		),
	);

	it.effect("fails as a jwt error on an unusable private key", () =>
		withApp([tokenReply()], (app) =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					app.token({ appId: "x", privateKey: Redacted.make("not a key"), installationId: 1 }),
				);
				assert.strictEqual(error.kind, "jwt");
			}),
		),
	);

	it.effect("signs with a PKCS#1 key, the format github.com hands out, and the JWT verifies", () =>
		Effect.gen(function* () {
			const pkcs1 = generateKeyPairSync("rsa", {
				modulusLength: 2048,
				privateKeyEncoding: { type: "pkcs1", format: "pem" },
				publicKeyEncoding: { type: "spki", format: "pem" },
			});
			// The control: this really is the PKCS#1 armour, not PKCS#8 under another name.
			assert.isTrue(pkcs1.privateKey.startsWith("-----BEGIN RSA PRIVATE KEY-----"));
			const nowMillis = 1_800_000_000_000;
			yield* TestClock.setTime(nowMillis);
			yield* withApp([tokenReply()], (app, script) =>
				Effect.gen(function* () {
					yield* app.token({ appId: "Iv1.pkcs1", privateKey: Redacted.make(pkcs1.privateKey), installationId: 42 });
					const authorization = script.calls[0]?.headers.authorization ?? "";
					assert.isTrue(authorization.startsWith("bearer "), authorization);
					const [header = "", payload = "", signature = ""] = authorization.slice("bearer ".length).split(".");
					const signed = verify(
						"RSA-SHA256",
						Buffer.from(`${header}.${payload}`),
						pkcs1.publicKey,
						Buffer.from(signature, "base64url"),
					);
					assert.isTrue(signed, "the JWT signature verifies against the public key");
					assert.strictEqual(JSON.parse(Buffer.from(header, "base64url").toString("utf8")).alg, "RS256");
					const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
						iss: string;
						iat: number;
						exp: number;
					};
					assert.strictEqual(claims.iss, "Iv1.pkcs1");
					assert.strictEqual(claims.exp - claims.iat, 600);
					// Time comes from Clock, so TestClock drives it: iat is backdated 60 s.
					assert.strictEqual(claims.iat, nowMillis / 1000 - 60);
				}),
			);
		}),
	);

	it.effect("signs with a key whose newlines arrive escaped, as from an environment variable", () =>
		Effect.gen(function* () {
			const pkcs1 = generateKeyPairSync("rsa", {
				modulusLength: 2048,
				privateKeyEncoding: { type: "pkcs1", format: "pem" },
				publicKeyEncoding: { type: "spki", format: "pem" },
			});
			const escaped = pkcs1.privateKey.replace(/\n/g, "\\n");
			// The control: one line, every newline spelled as backslash-n.
			assert.notInclude(escaped, "\n");
			yield* withApp([tokenReply()], (app, script) =>
				Effect.gen(function* () {
					yield* app.token({ appId: "Iv1.escaped", privateKey: Redacted.make(escaped), installationId: 42 });
					const authorization = script.calls[0]?.headers.authorization ?? "";
					const [header = "", payload = "", signature = ""] = authorization.slice("bearer ".length).split(".");
					const signed = verify(
						"RSA-SHA256",
						Buffer.from(`${header}.${payload}`),
						pkcs1.publicKey,
						Buffer.from(signature, "base64url"),
					);
					assert.isTrue(signed, "the JWT signature verifies against the public key");
				}),
			);
		}),
	);

	it.effect("refuses an RSA key under 2048 bits and a P-256 key as a jwt failure caused by a key error", () =>
		Effect.gen(function* () {
			const weak = generateKeyPairSync("rsa", {
				modulusLength: 1024,
				privateKeyEncoding: { type: "pkcs1", format: "pem" },
				publicKeyEncoding: { type: "spki", format: "pem" },
			}).privateKey;
			const ec = generateKeyPairSync("ec", {
				namedCurve: "P-256",
				privateKeyEncoding: { type: "pkcs8", format: "pem" },
				publicKeyEncoding: { type: "spki", format: "pem" },
			}).privateKey;
			for (const [name, pem] of [
				["1024-bit PKCS#1", weak],
				["P-256 PKCS#8", ec],
			] as const) {
				const error = yield* withApp([tokenReply()], (app) =>
					Effect.flip(app.token({ appId: "x", privateKey: Redacted.make(pem), installationId: 1 })),
				);
				assert.strictEqual(error.kind, "jwt", name);
				const cause = error.cause;
				assert.instanceOf(cause, JwtError, name);
				if (cause instanceof JwtError) {
					assert.strictEqual(cause.reason, "key", name);
					// The reason carries the detail alone, with no "JWT key:" prefix stuttered into it.
					assert.strictEqual(error.reason, cause.detail, name);
				}
			}
		}),
	);
});

describe("GitHubApp.revoke and scopedToken", () => {
	it.effect("revokes with a token credential, not a bearer", () =>
		withApp([{ status: 204 }], (app, script) =>
			Effect.gen(function* () {
				yield* app.revoke(Redacted.make("ghs_installation"));
				assert.strictEqual(script.calls[0]?.method, "DELETE");
				assert.include(script.calls[0]?.url ?? "", "/installation/token");
				assert.strictEqual(script.calls[0]?.headers.authorization, "token ghs_installation");
			}),
		),
	);

	it.effect("scopedToken revokes when the scope closes", () =>
		withApp([tokenReply(), { status: 204 }], (app, script) =>
			Effect.gen(function* () {
				yield* Effect.scoped(
					Effect.gen(function* () {
						const token = yield* app.scopedToken({ ...CREDENTIALS, installationId: 42 });
						assert.strictEqual(Redacted.value(token.token), "ghs_installation");
						assert.strictEqual(script.count(), 1, "not revoked while the scope is open");
					}),
				);
				assert.strictEqual(script.count(), 2);
				assert.strictEqual(script.calls[1]?.method, "DELETE");
			}),
		),
	);

	it.effect("a failed revoke does not fail the scope", () =>
		withApp([tokenReply(), { status: 500, body: { message: "boom" } }], (app) =>
			Effect.gen(function* () {
				// Best-effort by design: a token GitHub would not revoke expires on its
				// own within the hour, and failing the caller's program over it is worse.
				yield* Effect.scoped(app.scopedToken({ ...CREDENTIALS, installationId: 42 }));
			}),
		),
	);
});

describe("GitHubApp.identity", () => {
	it.effect("resolves slug, name and bot user id", () =>
		withApp(
			[
				{ status: 200, body: { slug: "my-app", name: "My App", id: 1 } },
				{ status: 200, body: { id: 987654, login: "my-app[bot]" } },
			],
			(app, script) =>
				Effect.gen(function* () {
					const identity = yield* app.identity({ ...CREDENTIALS, installationToken: Redacted.make("ghs_x") });
					assert.deepStrictEqual(identity, AppIdentity.make({ slug: "my-app", name: "My App", userId: 987654 }));
					// The bot-user lookup rejects an app JWT, so it bears the
					// installation token when one is supplied.
					assert.strictEqual(script.calls[1]?.headers.authorization, "token ghs_x");
				}),
		),
	);

	it.effect("degrades to slug and name when the bot user cannot be read", () =>
		withApp(
			[
				{ status: 200, body: { slug: "my-app", name: "My App", id: 1 } },
				{ status: 403, body: { message: "rate limited" } },
			],
			(app) =>
				Effect.gen(function* () {
					const identity = yield* app.identity(CREDENTIALS);
					assert.strictEqual(identity.slug, "my-app");
					assert.strictEqual(identity.userId, undefined);
				}),
		),
	);

	it.effect("surfaces a failure to read the app itself", () =>
		withApp([{ status: 401, body: { message: "Bad credentials" } }], (app) =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(app.identity(CREDENTIALS));
				assert.strictEqual(error.kind, "identity");
			}),
		),
	);
});

describe("GitHubApp.clientLayer", () => {
	const withClientLayer = <A, E>(
		replies: ReadonlyArray<Reply>,
		use: (client: GitHubClient["Service"], script: ReturnType<typeof scriptedFetch>) => Effect.Effect<A, E>,
	): Effect.Effect<A, E | import("../src/GitHubApp.js").GitHubAppError> =>
		Effect.gen(function* () {
			const script = scriptedFetch(replies);
			return yield* Effect.provide(
				Effect.flatMap(GitHubClient, (client) => use(client, script)),
				GitHubApp.clientLayer({ ...CREDENTIALS, installationId: 42 }, { fetch: script.fetch, retry: NO_RETRY }),
			);
		});

	it.effect("mints on build and authenticates requests with the installation token", () =>
		withClientLayer(
			[tokenReply(), { status: 200, body: { default_branch: "main" } }, { status: 204 }],
			(client, script) =>
				Effect.gen(function* () {
					const repo = yield* client.request("GET /repos/{owner}/{repo}", { owner: "o", repo: "r" });
					assert.strictEqual(repo.default_branch, "main");
					assert.strictEqual(script.calls[1]?.headers.authorization, "token ghs_installation");
				}),
		),
	);

	it.effect("revokes the token when the layer's scope closes", () =>
		Effect.gen(function* () {
			const script = scriptedFetch([tokenReply(), { status: 200, body: {} }, { status: 204 }]);
			yield* Effect.provide(
				Effect.flatMap(GitHubClient, (client) =>
					client.request("GET /repos/{owner}/{repo}", { owner: "o", repo: "r" }),
				),
				GitHubApp.clientLayer({ ...CREDENTIALS, installationId: 42 }, { fetch: script.fetch, retry: NO_RETRY }),
			);
			const last = script.calls[script.count() - 1];
			assert.strictEqual(last?.method, "DELETE", "the layer must not leave live credentials behind");
			assert.include(last?.url ?? "", "/installation/token");
		}),
	);

	it.effect("re-mints a token that has expired, revoking the old one", () =>
		Effect.gen(function* () {
			const expiresAt = DateTime.toDateUtc(DateTime.makeUnsafe(0)).toISOString();
			const script = scriptedFetch([
				tokenReply({ expiresAt, token: "ghs_first" }),
				{ status: 204 }, // revoke of the first
				tokenReply({ expiresAt: "2099-01-01T00:00:00Z", token: "ghs_second" }),
				{ status: 200, body: { default_branch: "main" } },
				{ status: 204 }, // revoke on scope close
			]);
			yield* Effect.provide(
				Effect.gen(function* () {
					const client = yield* GitHubClient;
					// The first token expired at the epoch, which is where the TestClock
					// starts, so the very next request must rotate.
					yield* TestClock.adjust(Duration.seconds(1));
					yield* client.request("GET /repos/{owner}/{repo}", { owner: "o", repo: "r" });
				}),
				GitHubApp.clientLayer({ ...CREDENTIALS, installationId: 42 }, { fetch: script.fetch, retry: NO_RETRY }),
			);
			assert.strictEqual(
				script.calls[1]?.method,
				"DELETE",
				"the spent token is revoked before the replacement is minted",
			);
			assert.strictEqual(script.calls[3]?.headers.authorization, "token ghs_second");
		}),
	);

	it.effect("rotates once when concurrent requests find the token spent, revoking only the old one", () =>
		Effect.gen(function* () {
			const mints: Array<string> = [];
			const revoked: Array<string> = [];
			const used: Array<string> = [];
			const json = (status: number, body: unknown) =>
				new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
			const fetch: typeof globalThis.fetch = async (input, init) => {
				const request = new Request(input as string, init);
				const authorization = request.headers.get("authorization") ?? "";
				if (request.url.includes("/access_tokens")) {
					const token = `ghs_${mints.length + 1}`;
					mints.push(token);
					// A real delay, so every waiting fiber is parked while the mint is in flight.
					await new Promise((resolve) => setTimeout(resolve, 5));
					const expires_at = mints.length === 1 ? "1970-01-01T00:00:00Z" : "2099-01-01T00:00:00Z";
					return json(201, { token, expires_at, permissions: {} });
				}
				if (request.method === "DELETE") {
					revoked.push(authorization.replace(/^token /, ""));
					return new Response(null, { status: 204 });
				}
				used.push(authorization.replace(/^token /, ""));
				return json(200, { default_branch: "main" });
			};
			yield* Effect.provide(
				Effect.gen(function* () {
					const client = yield* GitHubClient;
					// The eager token expired at the epoch, where the TestClock starts.
					yield* TestClock.adjust(Duration.seconds(1));
					yield* Effect.all(
						Array.from({ length: 3 }, () => client.request("GET /repos/{owner}/{repo}", { owner: "o", repo: "r" })),
						{ concurrency: "unbounded" },
					);
					assert.deepStrictEqual(mints, ["ghs_1", "ghs_2"], "the eager mint plus exactly one rotation");
					assert.deepStrictEqual(revoked, ["ghs_1"], "only the spent token is revoked while the layer is open");
					assert.deepStrictEqual(used, ["ghs_2", "ghs_2", "ghs_2"], "no request uses a revoked token");
				}),
				GitHubApp.clientLayer({ ...CREDENTIALS, installationId: 42 }, { fetch, retry: NO_RETRY }),
			);
			assert.deepStrictEqual(revoked, ["ghs_1", "ghs_2"], "release revokes the last token");
		}),
	);

	it.effect("fails layer construction with a GitHubAppError when credentials are bad", () =>
		Effect.gen(function* () {
			const script = scriptedFetch([{ status: 401, body: { message: "Bad credentials" } }]);
			const error = yield* Effect.flip(
				Effect.provide(
					Effect.flatMap(GitHubClient, (client) =>
						client.request("GET /repos/{owner}/{repo}", { owner: "o", repo: "r" }),
					),
					GitHubApp.clientLayer({ ...CREDENTIALS, installationId: 42 }, { fetch: script.fetch, retry: NO_RETRY }),
				),
			);
			// At construction the caller gets the App error, which says what is
			// actually wrong — not an opaque authorization failure on first use.
			assert.strictEqual(error._tag, "GitHubAppError");
			assert.strictEqual(error.kind, "token");
		}),
	);
});

describe("InstallationToken", () => {
	const token = InstallationToken.make({
		token: Redacted.make("ghs_x"),
		expiresAt: DateTime.makeUnsafe("2026-01-01T00:00:00Z"),
		installationId: 1,
		permissions: { contents: "write" },
	});

	it("is expired once the clock passes its expiry, minus the skew", () => {
		const expiry = DateTime.toEpochMillis(token.expiresAt);
		assert.isFalse(token.isExpired(expiry - 120_000));
		assert.isTrue(token.isExpired(expiry - 30_000), "the skew re-mints before GitHub starts refusing");
		assert.isTrue(token.isExpired(expiry + 1));
	});

	it("honors a caller-supplied skew", () => {
		const expiry = DateTime.toEpochMillis(token.expiresAt);
		assert.isTrue(token.isExpired(expiry - 120_000, Duration.minutes(5)));
	});

	it.effect("encodes to JSON a process boundary can carry", () =>
		Effect.gen(function* () {
			// @effected/github-actions persists this through GITHUB_STATE, which is
			// plaintext by GitHub's protocol — hence the raw string on the wire.
			const encoded = yield* Schema.encodeUnknownEffect(InstallationToken)(token);
			assert.deepStrictEqual(encoded, {
				token: "ghs_x",
				expiresAt: "2026-01-01T00:00:00.000Z",
				installationId: 1,
				permissions: { contents: "write" },
			});
			const decoded = yield* Schema.decodeUnknownEffect(InstallationToken)(encoded);
			assert.strictEqual(Redacted.value(decoded.token), "ghs_x");
			assert.isTrue(DateTime.toEpochMillis(decoded.expiresAt) === DateTime.toEpochMillis(token.expiresAt));
		}),
	);

	it("derives the github-actions identity when the app is unidentified", () => {
		assert.deepStrictEqual(token.botIdentity(), BotIdentity.githubActions);
	});

	it("derives the app's identity when it is known", () => {
		const identified = InstallationToken.make({ ...token, appSlug: "my-app", appUserId: 42 });
		assert.deepStrictEqual(
			identified.botIdentity(),
			BotIdentity.make({ name: "my-app[bot]", email: "42+my-app[bot]@users.noreply.github.com" }),
		);
	});
});

describe("BotIdentity", () => {
	it("builds the full identity from slug and user id", () => {
		const identity = BotIdentity.forApp({ appSlug: "my-app", appUserId: 42 });
		assert.strictEqual(identity.name, "my-app[bot]");
		assert.strictEqual(identity.email, "42+my-app[bot]@users.noreply.github.com");
	});

	it("omits the numeric prefix when the user id is unknown", () => {
		assert.strictEqual(BotIdentity.forApp({ appSlug: "my-app" }).email, "my-app[bot]@users.noreply.github.com");
	});

	it("knows the well-known github-actions identity", () => {
		assert.strictEqual(BotIdentity.githubActions.email, "41898282+github-actions[bot]@users.noreply.github.com");
	});

	it("is reachable with no layer, no client and no credentials", () => {
		// The point of moving it off the service shape: a consumer rendering a
		// committer line needs none of the machinery.
		assert.instanceOf(BotIdentity.forApp({ appSlug: "x" }), BotIdentity);
	});

	it("renders its own DCO sign-off trailer", () => {
		// Git Data API commits bypass `git commit -s`, so the trailer has no
		// porcelain to come from — and a hand-built one that is subtly wrong
		// surfaces as a red DCO check on someone else's PR. DCO 1.1's exact
		// casing, spacing and angle brackets, from the type that owns the data.
		assert.strictEqual(
			BotIdentity.githubActions.signoff,
			"Signed-off-by: github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>",
		);
		assert.strictEqual(
			BotIdentity.forApp({ appSlug: "my-app", appUserId: 42 }).signoff,
			"Signed-off-by: my-app[bot] <42+my-app[bot]@users.noreply.github.com>",
		);
	});
});

describe("AppIdentity", () => {
	it("derives a bot identity", () => {
		const identity = AppIdentity.make({ slug: "my-app", name: "My App", userId: 7 });
		assert.strictEqual(identity.botIdentity().email, "7+my-app[bot]@users.noreply.github.com");
	});
});

describe("GitHubApp.makeTest", () => {
	it.effect("answers a stubbed member", () =>
		Effect.gen(function* () {
			const double = GitHubApp.makeTest({
				identity: () => Effect.succeed(AppIdentity.make({ slug: "s", name: "n" })),
			});
			const identity = yield* double.identity(CREDENTIALS);
			assert.strictEqual(identity.slug, "s");
		}),
	);

	it("dies loudly on an unstubbed member", () => {
		assert.throws(() => GitHubApp.makeTest({}).token(CREDENTIALS), /was called but not stubbed/);
	});

	it.effect("layerTest provides the double", () =>
		Effect.gen(function* () {
			const observed = yield* Effect.provide(
				Effect.flatMap(GitHubApp, (app) => app.installations(CREDENTIALS)),
				GitHubApp.layerTest({ installations: () => Effect.succeed([]) }),
			);
			assert.deepStrictEqual(observed, []);
		}),
	);
});

describe("Option is not needed to read a missing installation account", () => {
	it.effect("keeps an installation with no account", () =>
		withApp([{ status: 200, body: [{ id: 3, account: null }] }, tokenReply()], (app) =>
			Effect.gen(function* () {
				const all = yield* app.installations(CREDENTIALS);
				assert.strictEqual(all[0]?.id, 3);
				assert.strictEqual(all[0]?.account, undefined);
				assert.isTrue(Option.isNone(Option.fromUndefinedOr(all[0]?.account)));
			}),
		),
	);
});

/** Two installations, the first with an unreadable date, timestamp and account id. */
const LENIENT_PAGE = [
	{
		id: 4,
		suspended_at: "garbage",
		updated_at: 12,
		account: { login: "acme", type: "Organization", id: "not-a-number" },
	},
	{ id: 5, suspended_at: null, account: { login: "other", type: "User", id: 7 } },
];

describe("Installation suspension, account type and id", () => {
	it.effect("decodes suspended_at, updated_at and the account's type and id", () =>
		withApp(
			[
				{
					status: 200,
					body: [
						{
							id: 1,
							suspended_at: "2026-10-01T00:00:00Z",
							updated_at: "2026-10-02T12:30:00Z",
							account: { login: "acme", type: "Organization", id: 42 },
						},
						{ id: 2, suspended_at: null, updated_at: "2026-09-01T00:00:00Z", account: null },
					],
				},
			],
			(app) =>
				Effect.gen(function* () {
					const [suspended, active] = yield* app.installations(CREDENTIALS);
					assert.isDefined(suspended);
					assert.isDefined(active);
					if (suspended === undefined || active === undefined) return;

					assert.strictEqual(suspended.account, "acme", "account stays the login string");
					assert.strictEqual(suspended.accountType, "Organization");
					assert.strictEqual(suspended.accountId, 42);
					assert.isTrue(suspended.suspendedAt !== undefined && Option.isSome(suspended.suspendedAt));
					if (suspended.suspendedAt !== undefined && Option.isSome(suspended.suspendedAt)) {
						assert.isTrue(DateTime.isDateTime(suspended.suspendedAt.value));
						assert.strictEqual(DateTime.formatIso(suspended.suspendedAt.value), "2026-10-01T00:00:00.000Z");
					}
					assert.isDefined(suspended.updatedAt);
					if (suspended.updatedAt !== undefined) {
						assert.strictEqual(DateTime.formatIso(suspended.updatedAt), "2026-10-02T12:30:00.000Z");
					}

					// suspended_at: null is an active installation, not an absent field.
					assert.isTrue(active.suspendedAt !== undefined && Option.isNone(active.suspendedAt));
					assert.strictEqual(active.account, undefined);
					assert.strictEqual(active.accountType, undefined);
					assert.strictEqual(active.accountId, undefined);
				}),
		),
	);

	it.effect("leaves suspendedAt and updatedAt absent when the response carries neither key", () =>
		withApp([{ status: 200, body: [{ id: 3, account: null }] }], (app) =>
			Effect.gen(function* () {
				const [only] = yield* app.installations(CREDENTIALS);
				assert.isDefined(only);
				assert.isFalse(only !== undefined && "suspendedAt" in only);
				assert.isFalse(only !== undefined && "updatedAt" in only);
			}),
		),
	);

	it.effect("omits an unreadable field from its installation and still returns every installation", () =>
		withApp([{ status: 200, body: LENIENT_PAGE }], (app) =>
			Effect.gen(function* () {
				const all = yield* app.installations(CREDENTIALS);
				assert.deepStrictEqual(
					all.map((entry) => entry.id),
					[4, 5],
				);
				const [garbled, healthy] = all;
				assert.isFalse(garbled !== undefined && "suspendedAt" in garbled, "the garbage date is omitted");
				assert.isFalse(garbled !== undefined && "updatedAt" in garbled);
				assert.isFalse(garbled !== undefined && "accountId" in garbled, "a non-integer account id is omitted");
				// The fields that did read survive on the same entry.
				assert.strictEqual(garbled?.account, "acme");
				assert.strictEqual(garbled?.accountType, "Organization");
				assert.isTrue(healthy?.suspendedAt !== undefined && Option.isNone(healthy.suspendedAt));
			}),
		),
	);

	it.effect("still mints for an owner when an installation carries an unreadable field", () =>
		withApp([{ status: 200, body: LENIENT_PAGE }, tokenReply()], (app, script) =>
			Effect.gen(function* () {
				const token = yield* app.token({ ...CREDENTIALS, owner: "acme" });
				assert.strictEqual(token.installationId, 4);
				assert.include(script.calls[1]?.url ?? "", "/app/installations/4/access_tokens");
			}),
		),
	);

	it("still builds a test double from an id alone", () => {
		const double = Installation.make({ id: 7 });
		assert.strictEqual(double.id, 7);
		assert.strictEqual(double.suspendedAt, undefined);
	});

	it.effect("round-trips through JSON with suspendedAt encoded as an ISO string or null", () =>
		Effect.gen(function* () {
			const decoded = yield* Schema.decodeUnknownEffect(Installation)({
				id: 1,
				suspendedAt: "2026-10-01T00:00:00.000Z",
				updatedAt: "2026-10-02T00:00:00.000Z",
			});
			const encoded = yield* Schema.encodeUnknownEffect(Installation)(decoded);
			assert.deepStrictEqual(encoded, {
				id: 1,
				suspendedAt: "2026-10-01T00:00:00.000Z",
				updatedAt: "2026-10-02T00:00:00.000Z",
			});
			const active = yield* Schema.decodeUnknownEffect(Installation)({ id: 2, suspendedAt: null });
			assert.deepStrictEqual(yield* Schema.encodeUnknownEffect(Installation)(active), { id: 2, suspendedAt: null });
		}),
	);
});
