import { Schema } from "effect";
import { Bool, Str, StringRecord, closed, entry } from "./schemas.js";

/** `tools`: per-tool download sources; only Node.js publishes release channels. */
const ToolSettings = closed({ mirror: Schema.optionalKey(Str), channels: Schema.optionalKey(StringRecord) });
const Tools = closed({
	node: Schema.optionalKey(ToolSettings),
	bun: Schema.optionalKey(closed({ mirror: Schema.optionalKey(Str) })),
	python: Schema.optionalKey(closed({ mirror: Schema.optionalKey(Str) })),
	rust: Schema.optionalKey(closed({ mirror: Schema.optionalKey(Str) })),
});

/** The command-line and Node.js settings (`docs/settings/cli.md`), and the recursive-run output switches. */
export const cli = {
	aggregateOutput: entry("aggregateOutput", {
		schema: Bool,
		kind: "boolean",
		description: "Hold each script's streamed output until the script exits, then print it as one block.",
		locations: ["workspace", "global", "env"],
	}),
	bail: entry("bail", {
		schema: Bool,
		kind: "boolean",
		description: "Whether recursive commands stop after the first failure.",
		locations: ["workspace", "global", "env"],
		default: true,
	}),
	color: entry("color", {
		schema: Schema.Union([Schema.Boolean, Schema.Literals(["always", "auto", "never"])]),
		kind: "union",
		description:
			"Controls colors in the output: `auto`, `always` or `never`; `true` is `always` and `false` is `never`.",
		locations: ["workspace", "global", "env"],
		default: "auto",
		anchor: "settings/cli#no-color",
	}),
	engineStrict: entry("engineStrict", {
		schema: Bool,
		kind: "boolean",
		description:
			"If this is enabled, installation fails when the project or a dependency declares an `engines.node` range that does not accept the current Node.js version.",
		locations: ["workspace", "global", "env"],
		default: false,
		anchor: "settings/cli#enginestrict",
	}),
	loglevel: entry("loglevel", {
		schema: Schema.Literals(["silent", "error", "warn", "info", "debug"]),
		kind: "enum",
		description:
			"Any logs at or higher than the given level will be shown. You can instead pass `--silent` to turn off all output logs.",
		locations: ["workspace", "global", "env"],
		default: "info",
		anchor: "settings/cli#loglevel",
	}),
	nodeDownloadMirrors: entry("nodeDownloadMirrors", {
		schema: StringRecord,
		kind: "stringRecord",
		description:
			"Custom Node.js download mirrors, keyed by release channel (`release`, `rc`, `nightly`, ...), each value the complete base URL for its channel.",
		locations: ["workspace", "global", "env"],
		anchor: "settings/cli#nodedownloadmirrors",
	}),
	nodeVersion: entry("nodeVersion", {
		schema: Str,
		kind: "string",
		description: "The Node.js version to use when checking a package's `engines` setting.",
		locations: ["workspace", "global", "env"],
		anchor: "settings/cli#nodeversion",
	}),
	npmPath: entry("npmPath", {
		schema: Str,
		kind: "string",
		description:
			"The location of the npm binary that pnpm uses for some actions, like publishing. Documented, but pnpm 12's config reader takes it from no source.",
		locations: [],
		anchor: "settings/cli#npmpath",
	}),
	pmOnFail: entry("pmOnFail", {
		schema: Schema.Literals(["download", "error", "warn", "ignore"]),
		kind: "enum",
		description:
			"Overrides the `onFail` behavior of both the `packageManager` field and `devEngines.packageManager` when the running pnpm version does not match the declared one.",
		locations: ["workspace", "global", "env"],
		default: "download",
		anchor: "settings/cli#pmonfail",
	}),
	progress: entry("progress", {
		schema: Bool,
		kind: "boolean",
		description: "Controls whether dependency and download progress lines are printed during installation.",
		locations: ["workspace", "global", "env"],
		default: true,
		anchor: "settings/cli#progress",
	}),
	recursiveInstall: entry("recursiveInstall", {
		schema: Bool,
		kind: "boolean",
		description:
			"If this is enabled, the primary behaviour of `pnpm install` becomes that of `pnpm install -r`, meaning the install is performed on all workspace or subdirectory packages.",
		locations: ["workspace", "env"],
		default: true,
		anchor: "settings/cli#recursiveinstall",
	}),
	reporter: entry("reporter", {
		schema: Schema.Literals(["default", "append-only", "ndjson", "silent"]),
		kind: "enum",
		description: "Selects the log reporter: `default`, `append-only`, `ndjson` or `silent`.",
		locations: ["workspace", "global", "env"],
		anchor: "settings/cli#reporter",
	}),
	reporterHidePrefix: entry("reporterHidePrefix", {
		schema: Bool,
		kind: "boolean",
		description: "Omit the project prefix from the streamed output lines of running scripts.",
		locations: ["workspace", "global", "env"],
	}),
	reverse: entry("reverse", {
		schema: Bool,
		kind: "boolean",
		description: "Reverse the project order of recursive commands.",
		locations: ["workspace", "env"],
	}),
	runtime: entry("runtime", {
		schema: Bool,
		kind: "boolean",
		description:
			"When `false`, installing commands such as `pnpm install`, `pnpm add`, and `pnpm dedupe` skip the runtimes declared in `devEngines.runtime` and `engines.runtime`.",
		locations: ["workspace", "env"],
		default: true,
		anchor: "settings/cli#runtime",
	}),
	runtimeOnFail: entry("runtimeOnFail", {
		schema: Schema.Literals(["download", "error", "warn", "ignore"]),
		kind: "enum",
		description:
			"Overrides the `onFail` field of `devEngines.runtime` (and `engines.runtime`) in the root project's `package.json`.",
		locations: ["workspace", "global", "env"],
		anchor: "settings/cli#runtimeonfail",
	}),
	sort: entry("sort", {
		schema: Bool,
		kind: "boolean",
		description: "Sort recursive workspace projects topologically.",
		locations: ["workspace", "env"],
		default: true,
	}),
	stream: entry("stream", {
		schema: Bool,
		kind: "boolean",
		description:
			"Stream a recursive command's script output as it arrives, one prefixed line at a time, instead of letting the child write to the terminal directly.",
		locations: ["workspace", "global", "env"],
	}),
	tools: entry("tools", {
		schema: Tools,
		kind: "object",
		description:
			"Download sources for the programs pnpm installs (`node`, `bun`, `python`, `rust`): a mirror per tool, and per-channel mirrors for Node.js.",
		locations: ["global", "env"],
		anchor: "settings/cli#tools",
	}),
	useBetaCli: entry("useBetaCli", {
		schema: Bool,
		kind: "boolean",
		description:
			"Experimental option that enables beta features of the CLI. This means that you may get some changes to the CLI functionality that are breaking changes, or potentially bugs.",
		locations: ["workspace", "global", "env"],
		default: false,
		anchor: "settings/cli#usebetacli",
	}),
} as const;
