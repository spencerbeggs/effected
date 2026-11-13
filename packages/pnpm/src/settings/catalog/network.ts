import { Schema } from "effect";
import { Bool, Str, StringArray, Unsigned, entry } from "./schemas.js";

/** The network, proxy and request settings (`docs/settings/network.md`), and the registry keys an `.npmrc` also carries. */
export const network = {
	_auth: entry("_auth", {
		schema: Schema.Unknown,
		kind: "unknownRecord",
		description:
			"Structured registry credentials, honoured only from the global `config.yaml` so a repository cannot supply them. Its shape is validated by pnpm's credential reader, not here.",
		locations: ["global"],
	}),
	fetchMinSpeedKiBps: entry("fetchMinSpeedKiBps", {
		schema: Unsigned,
		kind: "number",
		description:
			"A warning message is displayed if the download speed of a tarball from the registry falls below the specified threshold (in KiB/s).",
		locations: ["workspace", "global", "env"],
		anchor: "settings/network#fetchminspeedkibps",
	}),
	fetchRetries: entry("fetchRetries", {
		schema: Unsigned,
		kind: "number",
		description: "How many times to retry if pnpm fails to fetch from the registry.",
		locations: ["workspace", "global", "env"],
		default: 2,
		anchor: "settings/network#fetchretries",
	}),
	fetchRetryFactor: entry("fetchRetryFactor", {
		schema: Unsigned,
		kind: "number",
		description: "The exponential factor for retry backoff.",
		locations: ["workspace", "global", "env"],
		default: 10,
		anchor: "settings/network#fetchretryfactor",
	}),
	fetchRetryMaxtimeout: entry("fetchRetryMaxtimeout", {
		schema: Unsigned,
		kind: "number",
		description: "The upper bound (in milliseconds) of the retry exponential backoff.",
		locations: ["workspace", "global", "env"],
		anchor: "settings/network#fetchretrymaxtimeout",
	}),
	fetchRetryMintimeout: entry("fetchRetryMintimeout", {
		schema: Unsigned,
		kind: "number",
		description: "The lower bound (in milliseconds) of the retry exponential backoff.",
		locations: ["workspace", "global", "env"],
		anchor: "settings/network#fetchretrymintimeout",
	}),
	fetchTimeout: entry("fetchTimeout", {
		schema: Unsigned,
		kind: "number",
		description:
			"How long an HTTP request may go without making progress. The clock is reset on every chunk pnpm receives, so a large tarball on a slow connection is not cut off while data is still arriving; a stalled request is.",
		locations: ["workspace", "global", "env"],
		anchor: "settings/network#fetchtimeout",
	}),
	fetchWarnTimeoutMs: entry("fetchWarnTimeoutMs", {
		schema: Unsigned,
		kind: "number",
		description:
			"A warning message is displayed if a metadata request to the registry takes longer than the specified threshold (in milliseconds).",
		locations: ["workspace", "global", "env"],
		anchor: "settings/network#fetchwarntimeoutms",
	}),
	gitShallowHosts: entry("gitShallowHosts", {
		schema: StringArray,
		kind: "stringArray",
		description:
			"When fetching dependencies that are Git repositories, if the host is listed in this setting, pnpm will use shallow cloning to fetch only the needed commit, not all the history.",
		locations: ["workspace", "global", "env"],
		anchor: "settings/network#gitshallowhosts",
	}),
	httpProxy: entry("httpProxy", {
		schema: Str,
		kind: "string",
		description:
			"A proxy to use for outgoing HTTP requests. If `httpProxy` is unset, pnpm uses the proxy resolved for `httpsProxy`, then the `HTTP_PROXY` or `http_proxy` environment variable, then `PROXY` or `proxy`.",
		locations: ["workspace", "npmrc", "global", "env"],
		anchor: "settings/network#httpproxy",
	}),
	httpsProxy: entry("httpsProxy", {
		schema: Str,
		kind: "string",
		description:
			"A proxy to use for outgoing HTTPS requests. If `httpsProxy` is unset, pnpm uses the legacy `proxy` setting, then the `HTTPS_PROXY` or `https_proxy` environment variable.",
		locations: ["workspace", "npmrc", "global", "env"],
		anchor: "settings/network#httpsproxy",
	}),
	localAddress: entry("localAddress", {
		schema: Str,
		kind: "string",
		description: "The IP address of the local interface to use when making connections to the npm registry.",
		locations: ["workspace", "npmrc", "global", "env"],
		anchor: "settings/network#localaddress",
	}),
	maxsockets: entry("maxsockets", {
		schema: Unsigned,
		kind: "number",
		description: "The maximum number of connections to use per origin (protocol/host/port combination).",
		locations: ["workspace", "global", "env"],
		anchor: "settings/network#maxsockets",
	}),
	maxSockets: entry("maxSockets", {
		schema: Unsigned,
		kind: "number",
		description:
			"Maximum number of concurrent connections (sockets) to a single registry origin — the `maxSockets` setting, mirroring undici's per-origin `connections` cap that pnpm applies.",
		locations: ["workspace", "global", "env"],
	}),
	maxTarballUnpackedSize: entry("maxTarballUnpackedSize", {
		schema: Unsigned,
		kind: "number",
		description:
			"The most bytes the files of one package may unpack to. A package whose files total more fails to install.",
		locations: ["workspace", "global", "env"],
		anchor: "settings/network#maxtarballunpackedsize",
	}),
	networkConcurrency: entry("networkConcurrency", {
		schema: Unsigned,
		kind: "number",
		description: "Controls the maximum number of HTTP(S) requests to process simultaneously.",
		locations: ["workspace", "global", "env"],
		anchor: "settings/network#networkconcurrency",
	}),
	noproxy: entry("noproxy", {
		schema: Schema.Union([Str, Schema.Boolean]),
		kind: "union",
		description:
			"npm's spelling of `noProxy`: domain extensions a proxy is not used for. `noProxy` wins when both are set.",
		locations: ["workspace", "npmrc", "global", "env"],
	}),
	noProxy: entry("noProxy", {
		schema: Schema.Union([Str, Schema.Boolean]),
		kind: "union",
		description: "A comma-separated string of domain extensions that a proxy should not be used for.",
		locations: ["workspace", "npmrc", "global", "env"],
		anchor: "settings/network#noproxy",
	}),
	proxy: entry("proxy", {
		schema: Str,
		kind: "string",
		description:
			"Resolved proxy configuration — `https-proxy`, `http-proxy`, and `no-proxy` (plus the legacy `proxy` key and env-var fallbacks), all from `.npmrc` and the process environment.",
		locations: ["workspace", "npmrc", "global", "env"],
	}),
	registry: entry("registry", {
		schema: Str,
		kind: "string",
		description: "The base URL of the npm package registry.",
		locations: ["workspace", "npmrc", "global", "env"],
	}),
	strictSsl: entry("strictSsl", {
		schema: Bool,
		kind: "boolean",
		description: "Whether or not to do SSL key validation when making requests to the registry via HTTPS.",
		locations: ["workspace", "npmrc", "global", "env"],
		default: true,
		anchor: "settings/network#strictssl",
	}),
	userAgent: entry("userAgent", {
		schema: Str,
		kind: "string",
		description: "The value of the `User-Agent` header that pnpm sends with every request to the registry.",
		locations: ["workspace", "global", "env"],
		anchor: "settings/network#useragent",
	}),
} as const;
