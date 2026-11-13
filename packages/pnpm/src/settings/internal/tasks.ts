import { Schema } from "effect";
import { Bool, Str, StringArray, UnknownRecord, Unsigned, closed, entry } from "./schemas.js";

const BootConfig = closed({
	minimumReleaseAge: Schema.optionalKey(Unsigned),
	minimumReleaseAgeExclude: Schema.optionalKey(StringArray),
	minimumReleaseAgeStrict: Schema.optionalKey(Bool),
	minimumReleaseAgeIgnoreMissingTime: Schema.optionalKey(Bool),
	trustPolicy: Schema.optionalKey(Schema.Literals(["no-downgrade", "off"])),
	trustPolicyExclude: Schema.optionalKey(StringArray),
	trustPolicyIgnoreAfter: Schema.optionalKey(Unsigned),
});

/** The task, pipeline and boot settings `pnpm run` and `pnpm pipeline` read. */
export const tasks = {
	bootConfig: entry("bootConfig", {
		schema: BootConfig,
		kind: "object",
		description:
			"The release-age and trust settings that apply while pnpm installs its own config dependencies, before the rest of the configuration is read.",
		locations: ["workspace"],
	}),
	concurrencyGroups: entry("concurrencyGroups", {
		schema: Schema.Record(Schema.String, Unsigned),
		kind: "unknownRecord",
		description:
			"How many tasks of each named concurrency group may run at once on this machine, counted across every pnpm process.",
		locations: ["workspace", "global", "env"],
		envFormat: "json",
	}),
	pipelineBase: entry("pipelineBase", {
		schema: Str,
		kind: "string",
		description: "The git ref `pnpm pipeline` resolves its affected-selection merge base against.",
		locations: ["workspace"],
	}),
	pipelines: entry("pipelines", {
		schema: Schema.Record(Schema.String, StringArray),
		kind: "stringArrayRecord",
		description: "Named sets of task requests for `pnpm pipeline`, keyed by pipeline name.",
		locations: ["workspace"],
	}),
	tasks: entry("tasks", {
		schema: Schema.Record(Schema.String, UnknownRecord),
		kind: "unknownRecord",
		description:
			"The workspace's task declarations, keyed by task (script) name: dependencies, inputs, outputs, cache and concurrency for the recursive `run` scheduler.",
		locations: ["workspace"],
	}),
} as const;
