import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";
import { DeploymentEnvironment } from "../src/DeploymentEnvironment.js";
import type { RecordedCall } from "../src/GitHubClient.js";
import { GitHubClient } from "../src/GitHubClient.js";
import { Repo, RepoRef } from "../src/Repo.js";
import { defectMessage, harness } from "./harness.js";

const run = <A, E>(
	effect: Effect.Effect<A, E, DeploymentEnvironment | GitHubClient | Repo>,
	request: Record<string, unknown>,
	paginate: Record<string, ReadonlyArray<unknown>> = {},
) =>
	Effect.gen(function* () {
		const requested: RecordedCall[] = [];
		const value = yield* effect.pipe(
			Effect.provide(DeploymentEnvironment.layer),
			Effect.provide(GitHubClient.layerFixture({ request, paginate, requested })),
			Effect.provide(Repo.layer(RepoRef.make({ owner: "acme", repo: "widget" }))),
		);
		return { value, requested };
	});

describe("DeploymentEnvironment.upsert", () => {
	it.effect("PUTs the environment with its config", () =>
		Effect.gen(function* () {
			const { requested } = yield* run(
				Effect.flatMap(DeploymentEnvironment, (e) => e.upsert("prod", { wait_timer: 15 })),
				{ "PUT /repos/{owner}/{repo}/environments/{environment_name}": {} },
			);

			assert.strictEqual(requested[0]?.route, "PUT /repos/{owner}/{repo}/environments/{environment_name}");
			// The config rides as octokit's `data` body, where no key is read as a
			// request option or a path parameter.
			assert.deepStrictEqual(requested[0]?.params, {
				owner: "acme",
				repo: "widget",
				environment_name: "prod",
				data: { wait_timer: 15 },
			});
		}),
	);

	it.effect("needs no config, and does not list first", () =>
		Effect.gen(function* () {
			const { requested } = yield* run(
				Effect.flatMap(DeploymentEnvironment, (e) => e.upsert("prod")),
				{ "PUT /repos/{owner}/{repo}/environments/{environment_name}": {} },
			);

			// The route is idempotent, so unlike variables there is no read-then-branch.
			assert.deepStrictEqual(
				requested.map((c) => c.route),
				["PUT /repos/{owner}/{repo}/environments/{environment_name}"],
			);
			assert.deepStrictEqual(requested[0]?.params, {
				owner: "acme",
				repo: "widget",
				environment_name: "prod",
				data: {},
			});
		}),
	);
});

/**
 * octokit reads these parameter names as the REQUEST, not as body fields
 * (`@octokit/endpoint`'s `parse`, `data` replacing the body, and the route's own
 * template parameters). Each value is the hostile one: the host an
 * authenticated PUT would be redirected to, a header that would replace the
 * token, a fetch that would receive the request, a body that would replace the
 * config, a path that would retarget the write.
 */
const attackerCalls: Array<string> = [];
const HOSTILE: ReadonlyArray<readonly [string, unknown]> = [
	["baseUrl", "https://attacker.example"],
	["url", "https://attacker.example/x"],
	["method", "DELETE"],
	["headers", { authorization: "token stolen", "x-evil": "1" }],
	[
		"request",
		{
			fetch: async (input: unknown) => {
				attackerCalls.push(String(input));
				return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
			},
		},
	],
	["mediaType", { format: "raw" }],
	["data", { wait_timer: 0 }],
	["owner", "evil-owner"],
	["repo", "evil-repo"],
	["environment_name", "evil-env"],
	["__proto__", { polluted: true }],
];

/** `{ wait_timer: 15 }` plus one own enumerable key, `__proto__` included. */
const withKey = (key: string, value: unknown): Record<string, unknown> => {
	const map: Record<string, unknown> = { wait_timer: 15 };
	Object.defineProperty(map, key, { value, enumerable: true, configurable: true, writable: true });
	return map;
};

/** The real client over scripted HTTP: the wire as octokit actually builds it. */
const wire = (config: Record<string, unknown>) =>
	Effect.gen(function* () {
		const { script, base } = harness([{ status: 200, body: { name: "prod" } }]);
		const exit = yield* Effect.exit(
			Effect.provide(
				Effect.flatMap(DeploymentEnvironment, (e) => e.upsert("prod", config)),
				DeploymentEnvironment.layer.pipe(Layer.provideMerge(base)),
			),
		);
		return { exit, script };
	});

describe("DeploymentEnvironment.upsert request-option confinement", () => {
	it.effect("control: a plain upsert PUTs to api.github.com with the token and exactly the config", () =>
		Effect.gen(function* () {
			const { exit, script } = yield* wire({ wait_timer: 15, reviewers: [{ type: "User", id: 1 }] });
			assert.isTrue(Exit.isSuccess(exit));
			assert.lengthOf(script.calls, 1);
			const call = script.calls[0];
			assert.strictEqual(call?.method, "PUT");
			assert.strictEqual(call?.url, "https://api.github.com/repos/acme/widget/environments/prod");
			assert.strictEqual(call?.headers.authorization, "token ghs_test");
			assert.deepStrictEqual(JSON.parse(call?.body ?? "null"), {
				wait_timer: 15,
				reviewers: [{ type: "User", id: 1 }],
			});
		}),
	);

	it.effect("a reserved name in the config dies before any request, and no attacker fetch runs", () =>
		Effect.gen(function* () {
			for (const [key, hostile] of HOSTILE) {
				attackerCalls.length = 0;
				const { exit, script } = yield* wire(withKey(key, hostile));
				assert.include(defectMessage(exit) ?? "", `DeploymentEnvironment.upsert: "${key}"`, key);
				assert.lengthOf(script.calls, 0, key);
				assert.lengthOf(attackerCalls, 0, key);
			}
		}),
	);

	it.effect("past the refusal, the config is confined to the body by construction", () =>
		Effect.gen(function* () {
			// The refusal is defence in depth, so this bypasses it: a map whose keys
			// enumerate WITHOUT the hostile key on the first read (the refusal) and
			// WITH it on every later one (the body copy). What reaches octokit is
			// then a body carrying the hostile key, and it must stay in the body.
			const control = yield* wire({ wait_timer: 15 });
			const controlHeaders = control.script.calls[0]?.headers;
			assert.isDefined(controlHeaders);
			for (const [key, hostile] of HOSTILE) {
				if (key === "__proto__") continue;
				attackerCalls.length = 0;
				let reads = 0;
				const target: Record<string, unknown> = { wait_timer: 15, [key]: hostile };
				const config = new Proxy(target, {
					ownKeys: (inner) => (reads++ === 0 ? ["wait_timer"] : Reflect.ownKeys(inner)),
				});
				const { exit, script } = yield* wire(config);
				assert.isTrue(Exit.isSuccess(exit), key);
				assert.lengthOf(attackerCalls, 0, key);
				assert.lengthOf(script.calls, 1, key);
				const call = script.calls[0];
				assert.strictEqual(call?.method, "PUT", key);
				assert.strictEqual(call?.url, "https://api.github.com/repos/acme/widget/environments/prod", key);
				assert.deepStrictEqual(call?.headers, controlHeaders, key);
				// Through JSON, as the wire carries it: a function value drops out.
				assert.deepStrictEqual(JSON.parse(call?.body ?? "null"), JSON.parse(JSON.stringify(target)), key);
			}
		}),
	);
});

describe("DeploymentEnvironment.list", () => {
	it.effect("maps the names", () =>
		Effect.gen(function* () {
			const { value, requested } = yield* run(
				Effect.flatMap(DeploymentEnvironment, (e) => e.list()),
				{},
				{ "GET /repos/{owner}/{repo}/environments": [{ name: "prod" }, { name: "staging" }] },
			);

			assert.deepStrictEqual(value, [{ name: "prod" }, { name: "staging" }]);
			assert.deepStrictEqual(requested[0]?.params, { owner: "acme", repo: "widget" });
		}),
	);

	it.effect("tolerates a response with no environments key at all", () =>
		Effect.gen(function* () {
			const { value } = yield* run(
				Effect.flatMap(DeploymentEnvironment, (e) => e.list()),
				// A repository with none. The read is paginated, so "no environments"
				// arrives as an empty page rather than as a response missing the key —
				// octokit's paginator normalises the envelope before this code sees
				// it. The property under test is unchanged: none is `[]`, not an error.
				{},
				{ "GET /repos/{owner}/{repo}/environments": [] },
			);

			assert.deepStrictEqual(value, []);
		}),
	);
});

describe("DeploymentEnvironment.delete", () => {
	it.effect("removes by name", () =>
		Effect.gen(function* () {
			const { requested } = yield* run(
				Effect.flatMap(DeploymentEnvironment, (e) => e.delete("prod")),
				{ "DELETE /repos/{owner}/{repo}/environments/{environment_name}": {} },
			);

			assert.deepStrictEqual(requested[0]?.params, { owner: "acme", repo: "widget", environment_name: "prod" });
		}),
	);
});
