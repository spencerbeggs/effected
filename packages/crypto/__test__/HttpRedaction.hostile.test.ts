// How HttpRedaction.text grows on adversarial input. `HttpRedaction.test.ts` holds what it redacts.

import { describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { HttpRedaction } from "../src/index.js";

describe("HttpRedaction.text on adversarial input", () => {
	// Each shape is built to make a scan for a URL or a credential restart as often as it can.
	for (const [name, make] of [
		["one long run", (count: number) => "a".repeat(count)],
		["a run of scheme characters", (count: number) => "a1+.-".repeat(count / 4)],
		["a long run before :/", (count: number) => `${"a".repeat(count)}:/`],
		["a run of a:", (count: number) => "a:".repeat(count / 2)],
		["a run of a://", (count: number) => "a://".repeat(count / 4)],
		["a run of 1://", (count: number) => "1://".repeat(count / 4)],
		["a run of a:// and a space", (count: number) => "a:// ".repeat(count / 4)],
		["a scheme word before a long run of spaces", (count: number) => `token${" ".repeat(count)}`],
		["a run of scheme words", (count: number) => "token ".repeat(count / 4)],
		["a Bearer credential of one long run", (count: number) => `Bearer ${"a".repeat(count)}`],
	] as const) {
		it(`scans ${name} in time linear in its length`, () => {
			Growth.assertOrder(
				(count) => {
					const input = make(count);
					return () => HttpRedaction.text(input);
				},
				{ from: 32_768, order: 1 },
			);
		});
	}
});
