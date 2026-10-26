/**
 * The CI providers a `RuntimeEnv` names: std-env 4.3.0's provider set, less the runtime hosts and the rows std-env
 * itself does not call CI, plus `generic` for any other CI signal (`CI`, `CONTINUOUS_INTEGRATION`).
 *
 * @remarks
 * A literal union, so a consumer can match `RuntimeEnv.ci` exhaustively; widening it is a breaking change for such a
 * consumer. Each name is std-env's provider name lower-cased with `_` as `-`, except `github-actions` and `circleci`.
 *
 * @public
 */
export type CiName =
	| "github-actions"
	| "appveyor"
	| "aws-amplify"
	| "azure-pipelines"
	| "azure-static"
	| "appcircle"
	| "bamboo"
	| "bitbucket"
	| "bitrise"
	| "buddy"
	| "buildkite"
	| "circleci"
	| "cirrus"
	| "cloudflare-pages"
	| "cloudflare-workers"
	| "codebuild"
	| "codefresh"
	| "drone"
	| "dsari"
	| "gitlab"
	| "gocd"
	| "layerci"
	| "jenkins"
	| "hudson"
	| "magnum"
	| "netlify"
	| "nevercode"
	| "sail"
	| "semaphore"
	| "screwdriver"
	| "shippable"
	| "solano"
	| "strider"
	| "teamcity"
	| "travis"
	| "vercel"
	| "appcenter"
	| "cleavr"
	| "edgeone-pages"
	| "generic";
