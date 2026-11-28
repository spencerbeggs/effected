import { describe, it } from "@effect/vitest";
import { Depth } from "@effected/testing";
import { Schema } from "effect";
import type { UiKey } from "../../src/ui.js";
import { TextInput } from "../../src/ui.js";

const char = (c: string): UiKey => ({ _tag: "Char", char: c });
const named = (name: "left" | "right" | "home" | "end" | "backspace" | "delete"): UiKey => ({ _tag: "Named", name });
const run = (keys: ReadonlyArray<UiKey>, initial?: string) =>
	keys.reduce((state, key) => TextInput.step(state, key), TextInput.init(initial === undefined ? {} : { initial }));

describe("TextInput reducer properties", () => {
	it.prop(
		"any edit sequence over astral text leaves it well formed, with the cursor on a code-point boundary",
		{
			initial: Schema.Array(Schema.Literals(["a", "😀", "𝒳", "é", "中"])),
			edits: Schema.Array(Schema.Literals(["a", "😀", "𝒳", "left", "right", "home", "end", "backspace", "delete"])),
		},
		({ initial, edits }) => {
			const keys = edits.map(
				(edit): UiKey => (edit === "a" || edit === "😀" || edit === "𝒳" ? char(edit) : named(edit)),
			);
			const state = run(keys, initial.join(""));
			const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
			const high = state.value.charCodeAt(state.cursor - 1);
			const low = state.value.charCodeAt(state.cursor);
			const splitsPair = high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff;
			return !lone.test(state.value) && !splitsPair && state.cursor >= 0 && state.cursor <= state.value.length;
		},
		{ arbitrary: { runs: Depth.pick({ sample: 50, full: 500 }), size: 40 } },
	);
});
