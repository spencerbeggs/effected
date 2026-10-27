import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { normalizeEnv } from "../src/internal/envRecord.js";
import {
	detectSession as detectSessionRaw,
	detectTermProgram as detectTermProgramRaw,
	sessionKeys,
} from "../src/internal/session.js";

// The detectors take a normalized record (an empty value is absent): `readEnv` and `RuntimeEnv.fromRecord` guarantee it.
const detectSession = (env: Record<string, string | undefined>) => detectSessionRaw(normalizeEnv(env));
const detectTermProgram = (env: Record<string, string | undefined>) => detectTermProgramRaw(normalizeEnv(env));

// The variables each terminal and multiplexer documents for its pane, window or session, in the priority order the
// package promises: a multiplexer before the terminal it is attached to.
const SOURCES = [
	["tmux", "TMUX_PANE", "%3"],
	["screen", "STY", "12345.pts-0.host"],
	["windows-terminal", "WT_SESSION", "0f1e2d3c-aaaa-bbbb-cccc-000000000000"],
	["wezterm", "WEZTERM_PANE", "7"],
	["kitty", "KITTY_WINDOW_ID", "1"],
	["term-session", "TERM_SESSION_ID", "w0t0p0:ABCDEF"],
] as const;

describe("detectSession", () => {
	for (const [source, variable, id] of SOURCES) {
		it(`${variable} alone → ${source}, with the variable name and raw value`, () => {
			const found = detectSession({ [variable]: id });
			assert.isTrue(Option.isSome(found));
			if (Option.isNone(found)) return;
			assert.strictEqual(found.value.source, source);
			assert.strictEqual(found.value.variable, variable);
			assert.strictEqual(found.value.id, id);
		});
	}

	it("every source beats each one after it (the full precedence matrix)", () => {
		for (let a = 0; a < SOURCES.length; a++) {
			for (let b = a + 1; b < SOURCES.length; b++) {
				const [winner, wVar, wId] = SOURCES[a] as (typeof SOURCES)[number];
				const [, lVar, lId] = SOURCES[b] as (typeof SOURCES)[number];
				const found = detectSession({ [lVar]: lId, [wVar]: wId });
				assert.strictEqual(Option.getOrUndefined(Option.map(found, (s) => s.source)), winner, `${wVar} vs ${lVar}`);
			}
		}
	});

	it("tmux inside iTerm2: TMUX_PANE wins, multiplexer carries the raw TMUX value", () => {
		const tmux = "/private/tmp/tmux-501/default,1234,0";
		assert.deepStrictEqual(
			detectSession({ TMUX_PANE: "%3", TMUX: tmux, TERM_SESSION_ID: "w0t0p0:X" }),
			Option.some({
				source: "tmux",
				variable: "TMUX_PANE",
				id: "%3",
				multiplexer: Option.some({ name: "tmux", value: tmux }),
			}),
		);
	});

	it("screen: STY is both the session and the multiplexer", () =>
		assert.deepStrictEqual(
			detectSession({ STY: "1.pts-0.h" }),
			Option.some({
				source: "screen",
				variable: "STY",
				id: "1.pts-0.h",
				multiplexer: Option.some({ name: "screen", value: "1.pts-0.h" }),
			}),
		));

	it("no multiplexer variable → multiplexer None", () =>
		assert.deepStrictEqual(
			Option.map(detectSession({ KITTY_WINDOW_ID: "1" }), (s) => s.multiplexer),
			Option.some(Option.none()),
		));

	it("an empty variable is unset and falls through", () =>
		assert.deepStrictEqual(
			Option.map(detectSession({ TMUX_PANE: "", WT_SESSION: "x" }), (s) => s.source),
			Option.some("windows-terminal"),
		));

	it("TMUX without TMUX_PANE is not a session", () =>
		assert.deepStrictEqual(detectSession({ TMUX: "/s,1,0" }), Option.none()));
	it("nothing set → None", () => assert.deepStrictEqual(detectSession({}), Option.none()));
});

describe("detectTermProgram", () => {
	it("an unknown program (tmux) is kept verbatim", () =>
		assert.deepStrictEqual(detectTermProgram({ TERM_PROGRAM: "tmux", TERM_PROGRAM_VERSION: "3.4" }), {
			name: Option.some("tmux"),
			version: Option.some("3.4"),
		}));
	it("a known program is not normalized (ghostty stays lower-case)", () =>
		assert.deepStrictEqual(detectTermProgram({ TERM_PROGRAM: "ghostty" }).name, Option.some("ghostty")));
	it("the version is kept without a program", () =>
		assert.deepStrictEqual(detectTermProgram({ TERM_PROGRAM_VERSION: "1.2" }), {
			name: Option.none(),
			version: Option.some("1.2"),
		}));
	it("empty values are None", () =>
		assert.deepStrictEqual(detectTermProgram({ TERM_PROGRAM: "", TERM_PROGRAM_VERSION: "" }), {
			name: Option.none(),
			version: Option.none(),
		}));
});

describe("sessionKeys", () => {
	it("names every session variable, TMUX and the TERM_PROGRAM pair", () => {
		for (const [, variable] of SOURCES) assert.include(sessionKeys, variable);
		for (const key of ["TMUX", "TERM_PROGRAM", "TERM_PROGRAM_VERSION"]) assert.include(sessionKeys, key);
	});
});
