import { assert, describe, it } from "@effect/vitest";
import type { Scope } from "effect";
import { Cause, Effect, Exit, Fiber, Option, Schedule } from "effect";
import { Text, useApp } from "ink";
import type { ReactElement } from "react";
import { createElement, useEffect, useState } from "react";
import { vi } from "vitest";
import { Cancelled, CliInteractive, CliTheme, NotInteractive } from "../../src/index.js";
import { inkModules } from "../../src/ui/internal/ink.js";
import type { ChalkLevel, InkChalk } from "../../src/ui/internal/inkChalk.js";
import { inkChalk } from "../../src/ui/internal/inkChalk.js";
import { useScreenGuard } from "../../src/ui/internal/ScreenContext.js";
import type { FakeStreams } from "../../src/ui/testing/fakeStreams.js";
import { makeFakeStreams } from "../../src/ui/testing/fakeStreams.js";
import type { Screen } from "../../src/ui.js";
import { CliUi, KeyTable, Select, UiStreams, useKeys } from "../../src/ui.js";

// Count loads of the peers through the kit's one loader, without changing what it does.
const { loads } = vi.hoisted(() => ({ loads: { count: 0 } }));
vi.mock("../../src/ui/internal/ink.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/ui/internal/ink.js")>();
	const { Effect } = await import("effect");
	return {
		...actual,
		loadInk: Effect.suspend(() => {
			loads.count++;
			return actual.loadInk;
		}),
	};
});

const ESC = String.fromCharCode(0x1b);
const SHOW_CURSOR = `${ESC}[?25h`;

type ThemeOptions = Parameters<typeof CliTheme.layerTest>[0];

/** Run a screen on fake streams, interactive, under a test theme. */
const runOn = <A>(
	fake: FakeStreams,
	screen: Screen<A>,
	options: { readonly stream?: "stdout" | "stderr"; readonly theme?: ThemeOptions } = {},
): Effect.Effect<A, Cancelled | NotInteractive> =>
	CliUi.run(screen, options.stream === undefined ? undefined : { stream: options.stream }).pipe(
		Effect.provideService(UiStreams, fake.streams),
		Effect.provideService(CliInteractive, true),
		Effect.provide(CliTheme.layerTest(options.theme)),
	);

/** Wait, in real time, until `ready` holds; fails the test after two seconds. */
const until = (ready: () => boolean): Effect.Effect<void> =>
	Effect.suspend(() => (ready() ? Effect.void : Effect.fail("not yet"))).pipe(
		Effect.retry(Schedule.spaced("5 millis")),
		Effect.timeout("2 seconds"),
		Effect.orDie,
	);

/** A component that calls `onMount` once it has mounted. */
const OnMount = (props: { readonly onMount: () => void; readonly label?: string }): ReactElement => {
	useEffect(() => props.onMount(), [props.onMount]);
	return createElement(Text, null, props.label ?? "screen");
};

/** A screen that never ends on its own. */
const idle: Screen<never> = () => createElement(Text, null, "waiting");

const chalk: Effect.Effect<InkChalk> = Effect.flatMap(
	Effect.promise(() => inkChalk()),
	Option.match({
		onNone: () => Effect.die(new Error("Ink's chalk did not resolve")),
		onSome: Effect.succeed,
	}),
);

/** Hold Ink's chalk at `level` for the test, restoring whatever it was. */
const forceLevel = (level: ChalkLevel): Effect.Effect<InkChalk, never, Scope.Scope> =>
	Effect.flatMap(chalk, (instance) =>
		Effect.as(
			Effect.acquireRelease(
				Effect.sync(() => {
					const saved = instance.level;
					instance.level = level;
					return saved;
				}),
				(saved) =>
					Effect.sync(() => {
						instance.level = saved;
					}),
			),
			instance,
		),
	);

const defectOf = <A, E>(exit: Exit.Exit<A, E>): unknown => {
	if (Exit.isFailure(exit)) {
		assert.isFalse(Cause.hasFails(exit.cause), "a defect, not a typed failure");
		assert.isTrue(Cause.hasDies(exit.cause), "a defect");
		return Cause.squash(exit.cause);
	}
	return assert.fail("expected a defect, but the screen resolved");
};

describe("CliUi.run", () => {
	it.live("resolves with the value the screen gives", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const value = yield* runOn(fake, (control) => createElement(OnMount, { onMount: () => control.resolve(42) }));
			assert.strictEqual(value, 42);
		}),
	);

	it.live("resolving with an empty value is a result, not a cancel", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const value = yield* runOn(fake, (control) =>
				createElement(OnMount, { onMount: () => control.resolve([] as ReadonlyArray<string>) }),
			);
			assert.deepStrictEqual(value, []);
		}),
	);

	it.live("a screen on stderr draws its frames on stderr, and stdout receives nothing", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const value = yield* runOn(
				fake,
				(control) => createElement(OnMount, { onMount: () => control.resolve("drawn"), label: "on-stderr" }),
				{ stream: "stderr" },
			);
			assert.strictEqual(value, "drawn");
			assert.include(fake.stderr(), "on-stderr", "the frame reached stderr");
			assert.strictEqual(fake.stdout(), "", "stdout carries only what the program writes");
		}),
	);

	it.live("Ctrl-C cancels with interrupt", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const fiber = yield* Effect.forkChild(runOn(fake, idle));
			yield* until(() => fake.rawModes.includes(true));
			fake.input("\u0003");
			const error = yield* Effect.flip(Fiber.join(fiber));
			assert.instanceOf(error, Cancelled);
			assert.strictEqual(error instanceof Cancelled ? error.reason : undefined, "interrupt");
		}),
	);

	it.live("Esc cancels with escape, after Ink's real 20 ms flush", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const fiber = yield* Effect.forkChild(runOn(fake, idle));
			yield* until(() => fake.rawModes.includes(true));
			const pressed = Date.now();
			fake.input(ESC);
			const error = yield* Effect.flip(Fiber.join(fiber));
			assert.isAtLeast(Date.now() - pressed, 15, "Ink holds a lone ESC for its flush before reporting it");
			assert.instanceOf(error, Cancelled);
			assert.strictEqual(error instanceof Cancelled ? error.reason : undefined, "escape");
		}),
	);

	it.live("q is not a root key: it does not cancel", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const fiber = yield* Effect.forkChild(
				runOn(fake, (control) => {
					const Later = (): ReactElement => {
						useEffect(() => {
							const timer = setTimeout(() => control.resolve("still open"), 80);
							return () => clearTimeout(timer);
						}, []);
						return createElement(Text, null, "open");
					};
					return createElement(Later);
				}),
			);
			yield* until(() => fake.rawModes.includes(true));
			fake.input("q");
			assert.strictEqual(yield* Fiber.join(fiber), "still open");
		}),
	);

	it.live("not interactive: fails with NotInteractive, mounts nothing and never loads Ink", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const before = loads.count;
			let built = false;
			const error = yield* Effect.flip(
				CliUi.run(() => {
					built = true;
					return createElement(Text, null, "never");
				}).pipe(
					Effect.provideService(UiStreams, fake.streams),
					Effect.provideService(CliInteractive, false),
					Effect.provide(CliTheme.layerTest()),
				),
			);
			assert.instanceOf(error, NotInteractive);
			assert.isFalse(built, "the screen was never built");
			assert.strictEqual(loads.count, before, "Ink was never loaded");
			assert.deepStrictEqual(fake.rawModes, []);
			assert.strictEqual(fake.stdout(), "");
			// Positive control: the same counter does move when a screen mounts.
			yield* runOn(fake, (control) => createElement(OnMount, { onMount: () => control.resolve(1) }));
			assert.isAbove(loads.count, before);
		}),
	);

	it.live("a component that throws on its first render is a defect, with nothing of Ink's crash screen on stdout", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const Boom = (): ReactElement => {
				throw new Error("kaboom on render");
			};
			const exit = yield* Effect.exit(runOn(fake, () => createElement(Boom)).pipe(Effect.timeout("2 seconds")));
			const defect = defectOf(exit);
			assert.instanceOf(defect, Error);
			assert.strictEqual(defect instanceof Error ? defect.message : "", "kaboom on render");
			assert.notInclude(fake.stdout(), " ERROR ");
			assert.notInclude(fake.stdout(), "kaboom");
		}),
	);

	it.live("a component that throws after mounting is a defect, raw mode ends off and the cursor is shown", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const Later = (): ReactElement => {
				const [boom, setBoom] = useState(false);
				useEffect(() => {
					const timer = setTimeout(() => setBoom(true), 30);
					return () => clearTimeout(timer);
				}, []);
				if (boom) throw new Error("kaboom later");
				return createElement(Text, null, "alive");
			};
			const exit = yield* Effect.exit(runOn(fake, () => createElement(Later)).pipe(Effect.timeout("2 seconds")));
			const defect = defectOf(exit);
			assert.strictEqual(defect instanceof Error ? defect.message : "", "kaboom later");
			const stdout = fake.stdout();
			assert.include(stdout, "alive", "the screen had drawn before it crashed");
			assert.notInclude(stdout, " ERROR ");
			assert.notInclude(stdout, "kaboom");
			assert.notMatch(stdout, /\n\s+-\s*\S+\s*\(/, "no stack line");
			assert.notInclude(stdout, `${ESC}[3J`, "no scrollback wipe");
			assert.deepStrictEqual(fake.rawModes, [true, false]);
			assert.include(stdout.slice(-32), SHOW_CURSOR);
		}),
	);

	it.live("a screen that exits without resolving is a defect", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const Quit = (): ReactElement => {
				const { exit } = useApp();
				useEffect(() => exit(), [exit]);
				return createElement(Text, null, "quitting");
			};
			const defect = defectOf(yield* Effect.exit(runOn(fake, () => createElement(Quit))));
			assert.include(defect instanceof Error ? defect.message : "", "exited without resolving");
		}),
	);

	it.live(
		"interrupting the fiber mid-screen unmounts it, turns raw mode off, shows the cursor and restores the level",
		() =>
			Effect.gen(function* () {
				const instance = yield* forceLevel(1);
				const fake = makeFakeStreams();
				let unmounted = false;
				const Tracked = (): ReactElement => {
					useEffect(
						() => () => {
							unmounted = true;
						},
						[],
					);
					return createElement(Text, null, "tracked");
				};
				const fiber = yield* Effect.forkChild(
					runOn(fake, () => createElement(Tracked), { theme: { color: "truecolor" } }),
				);
				yield* until(() => fake.rawModes.includes(true));
				assert.strictEqual(instance.level, 3, "the screen holds the stream's level while mounted");
				yield* Fiber.interrupt(fiber);
				assert.isTrue(unmounted, "the tree was unmounted");
				assert.deepStrictEqual(fake.rawModes, [true, false]);
				assert.include(fake.stdout().slice(-32), SHOW_CURSOR);
				assert.strictEqual(instance.level, 1);
			}),
	);

	it.live("CliUi.lazy loads the screen's module only when it mounts", () =>
		Effect.gen(function* () {
			let loaded = 0;
			const screen = CliUi.lazy(async () => {
				loaded++;
				return {
					default: (control: Parameters<Screen<string>>[0]) =>
						createElement(OnMount, { onMount: () => control.resolve("lazy") }),
				};
			});
			assert.strictEqual(loaded, 0, "building the screen loads nothing");
			const fake = makeFakeStreams();
			yield* Effect.exit(
				CliUi.run(screen).pipe(
					Effect.provideService(UiStreams, fake.streams),
					Effect.provideService(CliInteractive, false),
					Effect.provide(CliTheme.layerTest()),
				),
			);
			assert.strictEqual(loaded, 0, "a non-interactive run loads nothing");
			assert.strictEqual(yield* runOn(fake, screen), "lazy");
			assert.strictEqual(loaded, 1);
		}),
	);

	it.live("two concurrent screens mount one after the other, and Ink's colour level ends where it began", () =>
		Effect.gen(function* () {
			const instance = yield* forceLevel(2);
			const fake = makeFakeStreams();
			const events: Array<string> = [];
			const screen =
				(name: string): Screen<string> =>
				(control) => {
					events.push(`${name} mounts`);
					const Timed = (): ReactElement => {
						useEffect(() => {
							const timer = setTimeout(() => {
								events.push(`${name} resolves`);
								control.resolve(name);
							}, 40);
							return () => clearTimeout(timer);
						}, []);
						return createElement(Text, null, name);
					};
					return createElement(Timed);
				};
			const theme = { color: "none", stderrColor: "truecolor" } as const;
			const results = yield* Effect.all(
				[runOn(fake, screen("a"), { stream: "stdout", theme }), runOn(fake, screen("b"), { stream: "stderr", theme })],
				{ concurrency: "unbounded" },
			);
			assert.deepStrictEqual([...results].sort(), ["a", "b"]);
			const [first, second] = [events[0]?.split(" ")[0], events[2]?.split(" ")[0]];
			assert.deepStrictEqual(events, [
				`${first} mounts`,
				`${first} resolves`,
				`${second} mounts`,
				`${second} resolves`,
			]);
			assert.deepStrictEqual(fake.rawModes, [true, false, true, false]);
			assert.strictEqual(instance.level, 2);
		}),
	);
});

describe("bracketed paste is switched off however a screen ends (production path)", () => {
	const PASTE_MODE = new RegExp(`${ESC}\\[\\?2004([hl])`, "g");
	const lastPasteMode = (written: string): string | undefined => [...written.matchAll(PASTE_MODE)].at(-1)?.[1];

	it.live("after Esc: it was on while mounted, and the last switch written turns it off", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const fiber = yield* Effect.forkChild(runOn(fake, idle));
			yield* until(() => fake.rawModes.includes(true));
			yield* until(() => fake.stdout().includes(`${ESC}[?2004h`));
			fake.input(ESC);
			const exit = yield* Effect.exit(Fiber.join(fiber));
			assert.isTrue(Exit.isFailure(exit), "Esc cancels");
			assert.strictEqual(lastPasteMode(fake.stdout()), "l");
		}),
	);

	it.live("after a render throws: it was on while mounted, and the last switch written turns it off", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			let explode: (() => void) | undefined;
			const Fuse = (): ReactElement => {
				const [boom, setBoom] = useState(false);
				useEffect(() => {
					explode = () => setBoom(true);
				}, []);
				if (boom) throw new Error("kaboom");
				return createElement(Text, null, "armed");
			};
			const fiber = yield* Effect.forkChild(runOn(fake, () => createElement(Fuse)));
			yield* until(() => explode !== undefined && fake.stdout().includes(`${ESC}[?2004h`));
			explode?.();
			const exit = yield* Effect.exit(Fiber.join(fiber));
			const defect = defectOf(exit);
			assert.strictEqual(defect instanceof Error ? defect.message : "", "kaboom");
			assert.strictEqual(lastPasteMode(fake.stdout()), "l");
		}),
	);

	it.live("after the fiber is interrupted: it was on while mounted, and the last switch turns it off", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const fiber = yield* Effect.forkChild(runOn(fake, idle));
			yield* until(() => fake.stdout().includes(`${ESC}[?2004h`));
			yield* Fiber.interrupt(fiber);
			assert.strictEqual(lastPasteMode(fake.stdout()), "l");
		}),
	);
});

describe("a throwing input handler is a defect, never an uncaught exception or a hang", () => {
	const restored = (fake: FakeStreams): void => {
		assert.deepStrictEqual(fake.rawModes, [true, false], "raw mode ends off");
		assert.include(fake.stdout().slice(-64), SHOW_CURSOR, "the cursor is shown");
		const switches = [...fake.stdout().matchAll(new RegExp(`${ESC}\\[\\?2004([hl])`, "g"))];
		assert.strictEqual(switches.at(-1)?.[1], "l", "bracketed paste ends off");
	};

	it.live("a useKeys dispatch that throws dies with the error, and the terminal is restored", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const table = KeyTable.make([{ keys: [{ char: "x" }], action: "x", help: "boom" }]);
			const Thrower = (): ReactElement => {
				useKeys(table, () => {
					throw new Error("key handler threw");
				});
				return createElement(Text, null, "press x");
			};
			const fiber = yield* Effect.forkChild(
				runOn(fake, () => createElement(Thrower)).pipe(Effect.timeout("2 seconds")),
			);
			yield* until(() => fake.stdout().includes(`${ESC}[?2004h`));
			fake.input("x");
			const exit = yield* Effect.exit(Fiber.join(fiber));
			const defect = defectOf(exit);
			assert.strictEqual(defect instanceof Error ? defect.message : String(defect), "key handler threw");
			restored(fake);
		}),
	);

	it.live("a guarded paste handler that throws dies with the error, and the terminal is restored", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const Thrower = (): ReactElement => {
				const guard = useScreenGuard();
				inkModules().ink.usePaste(
					guard(() => {
						throw new Error("paste handler threw");
					}),
				);
				return createElement(Text, null, "paste here");
			};
			const fiber = yield* Effect.forkChild(
				runOn(fake, () => createElement(Thrower)).pipe(Effect.timeout("2 seconds")),
			);
			yield* until(() => fake.stdout().includes(`${ESC}[?2004h`));
			fake.input(`${ESC}[200~pasted${ESC}[201~`);
			const exit = yield* Effect.exit(Fiber.join(fiber));
			const defect = defectOf(exit);
			assert.strictEqual(defect instanceof Error ? defect.message : String(defect), "paste handler threw");
			restored(fake);
		}),
	);
});

describe("a widget's text from data cannot push the frame past the terminal (production path)", () => {
	const WIPE = new RegExp(`${ESC}\\[[23]J`);
	const pick = (detail: string) =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 10 });
			const choices = Array.from({ length: 30 }, (_, index) => ({ label: `choice ${index}`, value: index, detail }));
			const fiber = yield* Effect.forkChild(runOn(fake, Select.screen({ message: "Pick one", choices })));
			yield* until(() => fake.stdout().includes("choice 0"));
			fake.input(`${ESC}[B`);
			yield* until(() => fake.stdout().includes("choice 1"));
			fake.input("\r");
			assert.strictEqual(yield* Fiber.join(fiber), 1);
			return fake.stdout();
		});

	it.live("a one-line detail draws without wiping the screen (the control)", () =>
		Effect.gen(function* () {
			const written = yield* pick("the detail");
			assert.notMatch(written, WIPE);
		}),
	);

	it.live("a two-line detail is folded onto one line, so the screen is not wiped either", () =>
		Effect.gen(function* () {
			const written = yield* pick("first\nsecond");
			assert.notMatch(written, WIPE);
			assert.include(written, "first second");
		}),
	);
});
