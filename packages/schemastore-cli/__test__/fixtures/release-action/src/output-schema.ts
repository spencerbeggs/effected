import { Schema } from "effect";

export const ReleaseOutput = Schema.Struct({ version: Schema.String, tag: Schema.String }).annotate({
	description: "A release-action output fixture",
});
