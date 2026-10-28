// The parameter names octokit reads as REQUEST OPTIONS rather than as body
// fields, for the open-map write paths: `GitHubRepository`'s settings and
// `DeploymentEnvironment.upsert`'s config.
//
// octokit takes a route's path parameters, its body fields and its transport
// options in ONE flat object. `@octokit/endpoint` then splits it:
//
// - `parse` (dist-src/parse.js, @octokit/endpoint 11) removes `method`,
//   `baseUrl`, `url`, `headers`, `request` and `mediaType` from the parameters
//   before anything else, and reads them as the request itself: `url` and
//   `baseUrl` pick the host, `method` the verb, `headers` the headers (the
//   auth hook's `authorization` among them), `mediaType` the accept header.
// - It then expands the URL template with the remaining parameters and drops
//   every key the template names (`extractUrlVariableNames`), so a body key
//   called `owner` or `repo` is consumed as the path coordinate and never sent.
// - Of what remains, a key called `data` REPLACES the whole body.
// - `@octokit/request` (dist-src/fetch-wrapper.js, @octokit/request 10) reads
//   `request.fetch`, `request.hook`, `request.signal` and `request.redirect`
//   off the merged `request` option, so a `request` key can swap the fetch
//   implementation that receives the authenticated request.
//
// So an untrusted map spread into the parameters can redirect the
// authenticated request to another host (the token travels with it), replace
// its body, or rewrite its path. The write paths send settings as the `data`
// body, where no key is ever read as an option; refusing these names as well
// is defence in depth, and keeps a refused key out of what is reported sent.

/**
 * The options `@octokit/endpoint`'s `parse` reads off the flat parameter
 * object, plus `data`, which replaces the body.
 *
 * @internal
 */
export const OCTOKIT_REQUEST_OPTION_KEYS: ReadonlySet<string> = new Set([
	"method",
	"baseUrl",
	"url",
	"headers",
	"request",
	"mediaType",
	"data",
]);

/**
 * The template parameters of `PATCH /repos/{owner}/{repo}`, which octokit
 * consumes as the path and never sends.
 *
 * @internal
 */
export const REPOSITORY_PATCH_ROUTE_PARAMS: ReadonlySet<string> = new Set(["owner", "repo"]);

/**
 * The template parameters of
 * `PUT /repos/{owner}/{repo}/environments/{environment_name}`, which octokit
 * consumes as the path and never sends.
 *
 * @internal
 */
export const ENVIRONMENT_PUT_ROUTE_PARAMS: ReadonlySet<string> = new Set(["owner", "repo", "environment_name"]);

/**
 * Why a key of an open body map may not be sent on a route whose template
 * names `routeParams`, or `undefined` when it may.
 *
 * @remarks
 * `noun` names what the map holds, with its article ("a repository setting",
 * "an environment setting"), in the reason. `__proto__` is refused for a different reason:
 * assigning it to a body object sets the object's prototype instead of a
 * field, so the key would vanish from the wire while being reported sent.
 *
 * @internal
 */
export const reservedBodyKey = (key: string, routeParams: ReadonlySet<string>, noun: string): string | undefined =>
	OCTOKIT_REQUEST_OPTION_KEYS.has(key)
		? `is an octokit request option, not ${noun}`
		: routeParams.has(key)
			? `is the route's own path parameter, not ${noun}`
			: key === "__proto__"
				? "would set the body's prototype instead of a field"
				: undefined;

/**
 * Why a repository-settings key may not be sent, or `undefined` when it may.
 *
 * @internal
 */
export const reservedSettingKey = (key: string): string | undefined =>
	reservedBodyKey(key, REPOSITORY_PATCH_ROUTE_PARAMS, "a repository setting");
