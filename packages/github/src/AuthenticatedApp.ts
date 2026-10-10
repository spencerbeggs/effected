import { Context, Effect, Layer, Schema, Stream } from "effect";
import { GitHubClient } from "./GitHubClient.js";
import { GitHubError } from "./GitHubError.js";
import { numericId } from "./internal/ids.js";
import type { PageOptions } from "./Rest.js";

/**
 * The GitHub App itself, as `GET /app` reports it.
 *
 * @public
 */
export class AppInfo extends Schema.Class<AppInfo>("AppInfo")({
	/** The app's numeric id. */
	id: Schema.Int,
	/**
	 * The URL slug, e.g. `"my-app"`; the app's bot user is `<slug>[bot]`.
	 *
	 * @remarks
	 * Optional because GitHub's schema for an app declares it optional; the
	 * authenticated app's own read is where you would expect it.
	 */
	slug: Schema.optionalKey(Schema.String),
	/** The display name. */
	name: Schema.String,
	/** The app's GraphQL node id (wire `node_id`). */
	nodeId: Schema.String,
	/** The app's OAuth client id (wire `client_id`), when GitHub reports one. */
	clientId: Schema.optionalKey(Schema.String),
	/** The app's page on GitHub (wire `html_url`). */
	htmlUrl: Schema.String,
}) {}

/**
 * One delivery of the app's webhook, as `GET /app/hook/deliveries` lists it.
 *
 * @remarks
 * **Ids are numbers, and refuse to lose precision.** GitHub types a delivery
 * id (and an installation or repository id) as int64, and octokit as
 * `number | bigint`. A response body arrives through `JSON.parse`, which
 * never produces a bigint: an id beyond 2^53 would already have been rounded.
 * Every id here is decoded as a **safe** integer, so such an id fails the read
 * with a typed `decode` error instead of handing back a rounded id that names
 * a different delivery. Today's ids are many orders of magnitude below that
 * line.
 *
 * Encodable: every field is a JSON primitive, so a delivery can be stored as
 * it is.
 *
 * @public
 */
export class DeliveryAttempt extends Schema.Class<DeliveryAttempt>("DeliveryAttempt")({
	/** The delivery's id; pass it to {@link AuthenticatedAppShape.redeliver}. */
	id: Schema.Int,
	/**
	 * The event's GUID (the `X-GitHub-Delivery` header). Shared by a delivery
	 * and all its redeliveries, so it identifies the event; `id` identifies
	 * the attempt.
	 */
	guid: Schema.String,
	/** When it was delivered, as GitHub's ISO 8601 string (wire `delivered_at`). */
	deliveredAt: Schema.String,
	/** Whether this attempt was a redelivery. */
	redelivery: Schema.Boolean,
	/** How long the delivery took, in seconds. */
	duration: Schema.Number,
	/** GitHub's description of the outcome, e.g. `"OK"`. */
	status: Schema.String,
	/** The HTTP status your endpoint answered (wire `status_code`); `0` when it never answered. */
	statusCode: Schema.Int,
	/** The event, e.g. `"workflow_run"`. */
	event: Schema.String,
	/** The event's action, e.g. `"completed"`; `null` for an event without one. */
	action: Schema.NullOr(Schema.String),
	/** The installation the event concerns (wire `installation_id`); `null` for none. */
	installationId: Schema.NullOr(Schema.Int),
	/** The repository the event concerns (wire `repository_id`); `null` for none. */
	repositoryId: Schema.NullOr(Schema.Int),
	/** When the delivery was throttled (wire `throttled_at`), when GitHub reports it. */
	throttledAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
}) {}

/**
 * Options for {@link AuthenticatedAppShape.deliveries}.
 *
 * @public
 */
export interface DeliveriesOptions {
	/**
	 * Only deliveries that succeeded or failed, filtered by GitHub. A delivery
	 * is a failure when your endpoint did not answer with a 2xx.
	 */
	readonly status?: "success" | "failure" | undefined;
	/** How far to page. Unset, pages of 100 until GitHub stops. */
	readonly page?: PageOptions | undefined;
}

/**
 * The app-level REST surface: the app's own record, its webhook deliveries and
 * removing an installation.
 *
 * @remarks
 * Every member needs a `GitHubClient` authenticated **as the app** (an App
 * JWT), which is what {@link GitHubApp.appClientLayer} provides; an
 * installation token answers these routes with 401. No member needs a `Repo`.
 *
 * @public
 */
export interface AuthenticatedAppShape {
	/** The app itself (`GET /app`). */
	readonly get: () => Effect.Effect<AppInfo, GitHubError>;
	/**
	 * The app's webhook deliveries, newest first (`GET /app/hook/deliveries`).
	 *
	 * @remarks
	 * **Lazy in requests**: a page is fetched only when the stream is pulled
	 * past the previous one, so `Stream.takeWhile` on `deliveredAt` stops a
	 * sweep at the window's edge without reading the rest of the log. GitHub
	 * pages this route by cursor; the walk follows its `Link` header.
	 *
	 * Each delivery is decoded as it arrives; a malformed one fails the stream
	 * with a `decode` `GitHubError`.
	 */
	readonly deliveries: (options?: DeliveriesOptions) => Stream.Stream<DeliveryAttempt, GitHubError>;
	/**
	 * One delivery attempt (`GET /app/hook/deliveries/{delivery_id}`).
	 *
	 * @remarks
	 * Projected onto the same {@link DeliveryAttempt} the listing answers; the
	 * request and response payloads GitHub also returns are not kept. Read them
	 * through the typed request surface when you need them.
	 */
	readonly delivery: (deliveryId: number) => Effect.Effect<DeliveryAttempt, GitHubError>;
	/**
	 * Ask GitHub to deliver an attempt's event again
	 * (`POST /app/hook/deliveries/{delivery_id}/attempts`).
	 *
	 * @remarks
	 * GitHub answers 202: the redelivery is queued, not done, and appears in
	 * {@link AuthenticatedAppShape.deliveries} as a new attempt with the same
	 * `guid` and `redelivery: true`.
	 */
	readonly redeliver: (deliveryId: number) => Effect.Effect<void, GitHubError>;
	/**
	 * Uninstall the app from an account
	 * (`DELETE /app/installations/{installation_id}`).
	 *
	 * @remarks
	 * Irreversible from the app's side: only the account can install it again.
	 * An installation that does not exist (or is already gone) fails with
	 * `GitHubError { kind: "notFound" }`.
	 */
	readonly uninstall: (installationId: number) => Effect.Effect<void, GitHubError>;
}

/**
 * The app-level REST surface: the app's own record, its webhook delivery log
 * and redelivery, and uninstalling.
 *
 * @remarks
 * Provide {@link AuthenticatedApp.layer} over an App-JWT client from
 * {@link GitHubApp.appClientLayer}. This module imports no JWT signer: the
 * credential is the client's business, so a test drives it with any client.
 *
 * @example
 * ```ts
 * import { AuthenticatedApp, GitHubApp } from "@effected/github";
 * import { DateTime, Effect, Layer, Redacted, Stream } from "effect";
 *
 * // Redeliver every failed delivery from the last hour.
 * const sweep = Effect.gen(function* () {
 *   const app = yield* AuthenticatedApp;
 *   const since = DateTime.subtract(yield* DateTime.now, { hours: 1 });
 *   yield* app.deliveries({ status: "failure" }).pipe(
 *     Stream.takeWhile((delivery) => DateTime.isGreaterThan(DateTime.makeUnsafe(delivery.deliveredAt), since)),
 *     Stream.runForEach((delivery) => app.redeliver(delivery.id)),
 *   );
 * });
 *
 * const layer = AuthenticatedApp.layer.pipe(
 *   Layer.provide(
 *     GitHubApp.appClientLayer({
 *       appId: "12345",
 *       privateKey: Redacted.make("-----BEGIN RSA PRIVATE KEY-----\n..."),
 *     }),
 *   ),
 * );
 *
 * Effect.runPromise(Effect.provide(sweep, layer));
 * ```
 *
 * @public
 */
export class AuthenticatedApp extends Context.Service<AuthenticatedApp, AuthenticatedAppShape>()(
	"@effected/github/AuthenticatedApp",
) {
	/** The live service, built over an App-JWT `GitHubClient`. */
	static readonly layer: Layer.Layer<AuthenticatedApp, never, GitHubClient> = Layer.effect(
		this,
		Effect.map(GitHubClient, (client) => make(client)),
	);

	/** An in-memory double; unstubbed members die naming themselves. */
	static readonly makeTest = (overrides: Partial<AuthenticatedAppShape> = {}): AuthenticatedAppShape => ({
		get: overrides.get ?? (() => unstubbed("get")),
		deliveries: overrides.deliveries ?? (() => unstubbed("deliveries")),
		delivery: overrides.delivery ?? (() => unstubbed("delivery")),
		redeliver: overrides.redeliver ?? (() => unstubbed("redeliver")),
		uninstall: overrides.uninstall ?? (() => unstubbed("uninstall")),
	});

	/** {@link AuthenticatedApp.makeTest} behind a `Layer`. */
	static readonly layerTest = (overrides: Partial<AuthenticatedAppShape> = {}): Layer.Layer<AuthenticatedApp> =>
		Layer.succeed(AuthenticatedApp, AuthenticatedApp.makeTest(overrides));
}

const unstubbed = (member: string): never => {
	throw new Error(`AuthenticatedApp.makeTest: ${member}() was called but not stubbed — pass an override.`);
};

/** The fields of GitHub's delivery payload this package projects. */
interface RawDelivery {
	readonly id: number | bigint;
	readonly guid: string;
	readonly delivered_at: string;
	readonly redelivery: boolean;
	readonly duration: number;
	readonly status: string;
	readonly status_code: number;
	readonly event: string;
	readonly action: string | null;
	readonly installation_id: number | bigint | null;
	readonly repository_id: number | bigint | null;
	readonly throttled_at?: string | null;
}

const decodeDelivery = Schema.decodeUnknownEffect(DeliveryAttempt);
const decodeApp = Schema.decodeUnknownEffect(AppInfo);

/** A nullable int64 id, narrowed like every other id. */
const nullableId = (id: number | bigint | null): number | null => (id === null ? null : numericId(id));

const deliveryOf = (operation: string, raw: RawDelivery): Effect.Effect<DeliveryAttempt, GitHubError> =>
	// A delivery that is not an object goes to the decoder as it is, so it fails
	// typed rather than throwing while its fields are read.
	decodeDelivery(
		typeof raw !== "object" || raw === null
			? raw
			: {
					id: numericId(raw.id),
					guid: raw.guid,
					deliveredAt: raw.delivered_at,
					redelivery: raw.redelivery,
					duration: raw.duration,
					status: raw.status,
					statusCode: raw.status_code,
					event: raw.event,
					action: raw.action,
					installationId: nullableId(raw.installation_id),
					repositoryId: nullableId(raw.repository_id),
					...(raw.throttled_at !== undefined ? { throttledAt: raw.throttled_at } : {}),
				},
	).pipe(
		Effect.catchTag("SchemaError", (error) =>
			Effect.fail(GitHubError.decode(operation, "GitHub returned an unexpected webhook delivery", error)),
		),
	);

const make = (client: GitHubClient["Service"]): AuthenticatedAppShape => ({
	get: Effect.fn("AuthenticatedApp.get")(function* () {
		const app = yield* client.request("GET /app", {});
		if (app === null) {
			return yield* GitHubError.decode("AuthenticatedApp.get", "GET /app returned no app");
		}
		return yield* decodeApp({
			id: numericId(app.id),
			...(app.slug !== undefined ? { slug: app.slug } : {}),
			name: app.name,
			nodeId: app.node_id,
			...(app.client_id !== undefined ? { clientId: app.client_id } : {}),
			htmlUrl: app.html_url,
		}).pipe(
			Effect.catchTag("SchemaError", (error) =>
				Effect.fail(GitHubError.decode("AuthenticatedApp.get", "GitHub returned an unexpected app", error)),
			),
		);
	}),

	deliveries: (options) =>
		client
			.paginateStream(
				"GET /app/hook/deliveries",
				options?.status !== undefined ? { status: options.status } : {},
				options?.page,
			)
			.pipe(Stream.mapEffect((raw) => deliveryOf("AuthenticatedApp.deliveries", raw))),

	delivery: Effect.fn("AuthenticatedApp.delivery")(function* (deliveryId: number) {
		yield* Effect.annotateCurrentSpan({ deliveryId });
		const raw = yield* client.request("GET /app/hook/deliveries/{delivery_id}", { delivery_id: deliveryId });
		return yield* deliveryOf("AuthenticatedApp.delivery", raw);
	}),

	redeliver: Effect.fn("AuthenticatedApp.redeliver")(function* (deliveryId: number) {
		yield* Effect.annotateCurrentSpan({ deliveryId });
		yield* client.request("POST /app/hook/deliveries/{delivery_id}/attempts", { delivery_id: deliveryId });
	}),

	uninstall: Effect.fn("AuthenticatedApp.uninstall")(function* (installationId: number) {
		yield* Effect.annotateCurrentSpan({ installationId });
		yield* client.request("DELETE /app/installations/{installation_id}", { installation_id: installationId });
	}),
});
