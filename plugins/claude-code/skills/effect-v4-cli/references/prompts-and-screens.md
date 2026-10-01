# Prompts and screens: `CliPrompt` and `@effected/cli/ui`

Loaded from `effect-v4-cli`. Covers asking a person for input: setting a project up for Ink screens, keeping React off the runs that never prompt, core's `Prompt` gated by `CliPrompt`, the Ink screens behind `@effected/cli/ui`, the ready-made widgets (with a `Confirm` worked through), writing a screen of your own, and the rules that keep a screen from tearing the terminal.

## Two engines, one contract

| Engine | Import | Reach for it when |
| --- | --- | --- |
| core `Prompt` + `CliPrompt.fallback` | `effect/cli`, `@effected/cli` | a line-based question (text, number, confirm, select) with no extra dependencies |
| Ink screens: `CliUi` + widgets | `@effected/cli/ui` | a richer screen: a scrolling list, sections of checkboxes, a confirm with toggles, tabs, your own layout |

Both obey the same contract: they prompt **only** when `CliInteractive` is true (a human audience, terminals on stdin and stdout, `TERM` not `dumb`), a quit is **one `Cancelled`** (`reason: "escape" | "interrupt"`, exit `130`), and a prompt reached in a run that cannot prompt either answers a default you supply or fails (`NotInteractive`, exit `64`, or core's missing-parameter error, exit `64`). Every one of these needs `CliRuntime.main(..., { env })` (or `CliEnv.layer`) to have decided `CliInteractive`; without it nothing ever prompts.

## Setup

```sh
pnpm add @effected/cli @effected/env @effected/walker @effected/glob effect
pnpm add ink react                  # only for @effected/cli/ui
pnpm add -D @types/react @types/node
```

`@effected/env`, `@effected/walker` and `@effected/glob` are required peers of the root; `ink`, `react` and `@types/react` are optional peers that only `@effected/cli/ui` uses, and `@effected/config-file` is an optional peer of one root module. A program that only prompts through core's `Prompt` installs none of the Ink ones.

A screen of your own written as JSX needs the automatic JSX transform, in the tsconfig that compiles it:

```json
{ "compilerOptions": { "jsx": "react-jsx" } }
```

The kit ships no JSX, so this is a consumer-only setting. With `"jsx": "react"` the compiler rewrites every element to `React.createElement` and reports `TS2686: 'React' refers to a UMD global` at each one; a build that transpiles without type-checking ignores that, and the screen crashes the moment it mounts with `React is not defined`. Name JSX files `.tsx`, and import them with a `.js` extension under NodeNext.

`./ui` binds Node's process streams (the `UiStreams` reference, which a test replaces with in-memory streams) because Ink needs Node stream objects. It runs on Bun, which provides the same objects. The root entrypoint stays free of `node:` imports and runs anywhere Effect does.

## Keeping React off the runs that never prompt

Importing `@effected/cli/ui` loads nothing: `ink` and `react` are imported only when a screen first mounts. **A module of yours that contains JSX does not get that benefit.** Compiled with `react-jsx` it begins with `import { jsx } from "react/jsx-runtime"`, and a module that imports `ink` or `react` loads them when the module loads. If the command module that declares your flags holds that JSX, every run of the program loads React, including `--agent` and CI runs and `--help`.

Keep every screen of your own in a module of its own, with the screen as its default export, and mount it with `CliUi.lazy`, which defers the module's import to the moment the screen mounts:

```tsx
// screens/counter.tsx: the only module that imports ink, react and the JSX runtime
import { KeyHelp, KeyTable, Styled, useKeys } from "@effected/cli/ui"
import type { Screen } from "@effected/cli/ui"
import { Box, Text } from "ink"
import { useState } from "react"

type Action = "up" | "down" | "submit"

const keys = KeyTable.make<Action>([
  { keys: ["up", { char: "k" }], action: "up", help: "previous" },
  { keys: ["down", { char: "j" }], action: "down", help: "next" },
  { keys: ["enter"], action: "submit", help: "choose" },
])

const counter: Screen<number> = ({ resolve }) => {
  const Counter = () => {
    const [n, setN] = useState(0)
    useKeys(keys, (action) => {
      if (action === "up") setN((current) => current + 1)
      else if (action === "down") setN((current) => current - 1)
      else setN((current) => {
        resolve(current)
        return current
      })
    })
    return (
      <Box flexDirection="column">
        <Text>
          <Styled token="accent">count</Styled> {n}
        </Text>
        <KeyHelp tables={[keys]} />
      </Box>
    )
  }
  return <Counter />
}

export default counter
```

```ts
// pick.ts: the command module, no JSX and no ink or react import, so a non-interactive run loads neither
import { CliUi } from "@effected/cli/ui"
import { Console, Effect } from "effect"
import { Command } from "effect/cli"

export const pick = Command.make("pick", {}, () =>
  Effect.gen(function* () {
    const n = yield* CliUi.prompt(
      CliUi.lazy(() => import("./screens/counter.js")),
      { otherwise: 0 },
    )
    yield* Console.log(`count ${n}`)
  }),
)
```

`CliUi.lazy(load)` types the screen from the module's default export, so `otherwise: "x"` against this screen is a compile error. A non-interactive run returns `otherwise` and never evaluates the import. The kit's own widgets (`Select.screen`, `Confirm.screen`, `TextInput.screen`, `MultiSelect.screen`) need no `lazy`: calling one in your command module loads no React, because the kit's modules never import it statically. Only JSX and direct `ink`/`react` imports of your own do.

A live view's `render` is synchronous, so it cannot be lazy. Put the view in its own module and `import()` it before calling `CliUi.live`, on the path that draws:

```ts
const { renderView } = yield* Effect.promise(() => import("./view.js"))
const view = yield* CliUi.live<Event, State>({ events, initial, reduce, render: renderView, isStart, isTerminal })
```

An **owned** live view that is not interactive still loads Ink to print its final frame as a string, so an `--agent` or CI run that draws a view loads React whichever way you import it. The dynamic import saves the load only on runs that draw nothing (`--help`, `--version`, an early usage error) and for a `hosted` view.

## A flag or argument that prompts when missing

```ts
import { CliPrompt } from "@effected/cli"
import { CliUi, Select } from "@effected/cli/ui"
import { Flag, Prompt } from "effect/cli"

const name = Flag.String("name").pipe(
  Flag.withFallbackPrompt(
    CliPrompt.fallback(Prompt.String({ message: "Project name" }), { flag: "name", otherwise: "demo" }),
  ),
)

const template = Flag.String("template").pipe(
  Flag.withFallbackPrompt(
    CliUi.fallback(
      Select.screen({ message: "Template", choices: [{ label: "Library", value: "lib" }, { label: "CLI", value: "cli" }] }),
      { flag: "template", otherwise: "lib" },
    ),
  ),
)
```

Name the parameter with `flag` (its name without dashes) or `argument`, so the missing-parameter error can be built. Not interactive, `otherwise` answers (`undefined` counts as not given); without one the parameter fails as missing. The fallback runs while core parses, which is why the audience flag must be resolved by `CliAudience.run`/`runWith` and not by `CliAudience.provide` alone.

**A cancel raised in a fallback travels as a defect**, because core's parse step turns every typed failure into a usage error. A handler's `Effect.catchTag("Cancelled", ...)` cannot see it; only `CliRuntime.main` (or `reportFailures`) renders it as one line with exit `130`. Under a bare `runMain` it prints a stack.

## A screen from a handler: `CliUi`

| `CliUi` | Signature and use |
| --- | --- |
| `run(screen, { clear? })` | `Effect<A, Cancelled \| NotInteractive, CliTheme>`; mounts the screen. Not interactive, fails `NotInteractive` and loads nothing |
| `prompt(screen, { otherwise?, clear? })` | `run` with a non-interactive default: the form for a handler. A cancel is the typed `Cancelled` a handler **can** catch |
| `fallback(screen, { flag \| argument, otherwise?, clear? })` | a `Param.FallbackPrompt`, as `CliPrompt.fallback` above |
| `lazy(() => import("./screen.js"))` | defers a screen's module to its mount, so its JSX and its `ink`/`react` imports load only then; the module's default export is the `Screen` (see "Keeping React off the runs that never prompt") |
| `context` | `Effect<UiContextValue, never, CliTheme>`: the theme and glyphs for an Ink tree the kit did not mount (see the live-view reference) |

```ts
import { CliUi, Select, TextInput } from "@effected/cli/ui"
import { Effect } from "effect"

const answers = Effect.gen(function* () {
  const template = yield* CliUi.prompt(
    Select.screen({
      message: "Template",
      choices: [
        { label: "Library", value: "lib" },
        { label: "CLI", value: "cli", detail: "a bin package" },
      ],
    }),
    { otherwise: "lib" },
  )
  const name = yield* CliUi.prompt(
    TextInput.screen({
      message: "Name",
      placeholder: "my-tool",
      validate: (value) => (value.length === 0 ? "a name is required" : undefined),
    }),
    { otherwise: "my-tool" },
  )
  return { template, name }
})
```

Screens in sequence make a wizard: discover the defaults first and pass each one as `otherwise`, so a non-interactive run returns exactly the defaults. Esc cancels with `"escape"`, Ctrl-C with `"interrupt"`. A screen draws on stdout at stdout's colour level, unmounts cleanly however it ends (raw mode off, cursor shown, bracketed paste off), and screens run **one at a time, process-wide**. `clear: true` erases the last frame on unmount; the default leaves it as a record of the answer.

## The widgets

Most widgets are a pure `init`/`step` reducer, a `keys` table, a `View` and a ready-made `screen(options)`. The exceptions: `TextInput` steps on a `UiKey` and has no `keys` table, `Toggle` is a `View` only, `Tabs` has `step`, `keys` and a `View` but no `init`, and `Viewport` has `init`, `step`, `keys` and a `View` but no `screen`.

| Widget | `screen(options)` resolves | Options |
| --- | --- | --- |
| `Select` | the chosen `value` | `{ message, choices: [{ label, value, detail?, disabled? }], initial?, height? }`; `initial` is an **index** into `choices` (the first enabled choice at or after it), not a value; disabled choices are skipped |
| `TextInput` | `string` | `{ message, initial?, placeholder?, validate? }`; `validate` returns an error message or `undefined`, checked on submit: an invalid submit redraws the message and does not resolve |
| `MultiSelect` | `ReadonlyArray<A>`, in section order | `{ message, sections: [{ title, items: [{ key, label, value, detail?, selected? }] }], height? }`; keys unique across sections; submitting with nothing selected resolves `[]`, not a cancel |
| `Confirm` | `{ confirmed, toggles }` | `{ message, initial?, toggles?: [{ key, label, value }] }`; the answer starts at **no**; `toggles` is partial by key |
| `Toggle`, `Tabs` | — | components for your own screen; `Tabs` cycles with Tab and Shift-Tab and jumps with digits |
| `Viewport` | — | a pure reducer over a window of rows that never draws more lines than fit |

Behaviour that surprises a first screen:

- **`q` cancels `Select`, `MultiSelect` and `Confirm`** with `"escape"`, as Esc does; Ctrl-C cancels with `"interrupt"`. `TextInput` has no `q` binding, since `q` is text.
- **A screen with nothing to choose dies as a defect**, not a typed failure: `Select.screen` with no enabled choice, a `Confirm` toggle key or a `MultiSelect` item key that repeats, and a `Viewport` item key that repeats.
- **`CliUi.prompt` takes one screen's answer**, so a wizard is several `prompt` calls in a handler (or several `fallback`s on flags), each with its own `otherwise`.

### `Confirm`: the default, the toggles, and a boolean flag

`Confirm.screen` resolves a `ConfirmResult`: `{ confirmed: boolean, toggles }`. `y` and `n` set the answer, `←` and `→` flip it, `↑` and `↓` move to the toggle rows, space flips the highlighted toggle, enter submits. **Enter alone answers no**, unless `initial: true` says otherwise.

```ts
import { CliUi, Confirm } from "@effected/cli/ui"
import { Effect } from "effect"

const create = Effect.gen(function* () {
  const { confirmed, toggles } = yield* CliUi.prompt(
    Confirm.screen({
      message: "Create the project?",
      initial: true,
      toggles: [{ key: "git", label: "git init", value: true }],
    }),
    { otherwise: { confirmed: true, toggles: { git: true } } },
  )
  const git = toggles.git ?? false // toggles is partial by key: read one with a fallback
  return { confirmed, git }
})
```

`otherwise` is the **whole** `ConfirmResult`, never a bare `boolean`: `otherwise: true` does not compile. A non-interactive run returns it as written, so write the toggles the default run should have.

A `Confirm` behind a boolean flag ("confirm, or `--yes`") needs a `Screen<boolean>`, because `Flag.Boolean`'s fallback takes the flag's own type and the kit has no screen mapper. Adapt it by hand:

```ts
import { CliUi, Confirm } from "@effected/cli/ui"
import type { Screen } from "@effected/cli/ui"
import { Flag } from "effect/cli"

const yesNo =
  (message: string): Screen<boolean> =>
  (control) =>
    Confirm.screen({ message })({ resolve: (result) => control.resolve(result.confirmed), cancel: control.cancel })

const yes = Flag.Boolean("yes").pipe(
  Flag.withFallbackPrompt(CliUi.fallback(yesNo("Overwrite existing files?"), { flag: "yes", otherwise: false })),
)
```

`--yes` skips the prompt; omitted, an interactive run asks and a non-interactive run answers `otherwise`. The adapter forwards `cancel` untouched, so Esc is still the one `Cancelled`.

Every string a widget draws from data is sanitised and its line breaks folded to spaces before it is measured, so data cannot paint colour, plant a hyperlink, or add a row the layout did not count.

## Writing a screen

A `Screen<A>` is `(control: ScreenControl<A>) => ReactElement | Promise<ReactElement>`, with `control.resolve(value)` and `control.cancel(reason)`; the first call wins. Write it as the default export of its own `.tsx` module and mount it with `CliUi.lazy` (the `counter` above is a complete one): see "Keeping React off the runs that never prompt".

A scrolling picker with tabs composes `Viewport` and `Tabs`. `Viewport.init(count, height)` is the state, `Viewport.step` moves it from a functional update inside `useKeys(Viewport.keys, ...)`, and `<Viewport.View rows state renderRow reserved />` draws only the rows that fit, with `reserved` the lines the rest of the screen uses. Take the height from `useTerminalSize().rows`; reinitialise the state when the rows change:

```tsx
import { KeyHelp, KeyTable, Styled, Tabs, useKeys, useTerminalSize, Viewport } from "@effected/cli/ui"
import type { Screen, ViewportRow } from "@effected/cli/ui"
import { Box, Text } from "ink"
import { useState } from "react"

type Tab = "all" | "changed"

const files = [
  { name: "a.ts", changed: false },
  { name: "b.ts", changed: true },
  { name: "c.ts", changed: false },
]

const rowsOf = (tab: Tab): ReadonlyArray<ViewportRow> =>
  files.filter((file) => tab === "all" || file.changed).map((file) => ({ _tag: "Item", key: file.name }))

const submit = KeyTable.make<"submit">([{ keys: ["enter"], action: "submit", help: "choose" }])

const RESERVED = 3 // the tab row, the title and the help line

const filePicker: Screen<string> = ({ resolve }) => {
  const Picker = () => {
    const height = Math.max(1, useTerminalSize().rows - RESERVED)
    const [tab, setTab] = useState<Tab>("all")
    const [state, setState] = useState(() => Viewport.init(rowsOf("all").length, height))
    const rows = rowsOf(tab)
    useKeys(Viewport.keys, (move) => setState((current) => Viewport.step(current, move)))
    useKeys(submit, () =>
      setState((current) => {
        const row = rows[current.cursor]
        if (row?._tag === "Item") resolve(row.key)
        return current
      }),
    )
    return (
      <Box flexDirection="column">
        <Tabs.View
          tabs={[
            { name: "all", label: "All" },
            { name: "changed", label: "Changed" },
          ]}
          value={tab}
          onChange={(name) => {
            setTab(name)
            setState(Viewport.init(rowsOf(name).length, height))
          }}
        />
        <Viewport.View
          rows={rows}
          state={state}
          reserved={RESERVED}
          renderRow={(row, highlighted) => (
            <Text>
              {highlighted ? <Styled token="accent">› </Styled> : "  "}
              {row._tag === "Item" ? row.key : row.label}
            </Text>
          )}
        />
        <KeyHelp tables={[Viewport.keys, Tabs.keys, submit]} />
      </Box>
    )
  }
  return <Picker />
}

export default filePicker
```

A row is `{ _tag: "Item", key }` (selectable, its `key` unique) or `{ _tag: "Header", label }` (drawn, never selected, and kept at the top of the window while its items scroll). `Tabs` reads Tab, Shift-Tab, the left and right arrows (up and down for a column) and digits, so give it `isFocused: false` while a `TextInput` beside it is being typed into.

- **Keys are data.** `KeyTable.make(bindings)` is the one source for dispatch and for the help line (`KeyHelp`, merged with `KeyTable.root`'s Esc and Ctrl-C); the first binding for a key wins. `useKeys(table, dispatch, { isActive? })` is one Ink `useInput`. `UiKey` is the kit's key model: `Named` keys (`up`, `enter`, `escape`, `space`, `tab`, `shift+tab`, `pageup`, `ctrl+c`, …) or a `Char`. A binding with `hidden: true` stays bound but leaves the help line.
- **Step from current state.** Ink hands every key of one stdin read to the handler **before React re-renders**, so a handler reading render-closure state processes a pasted or fast-typed burst against a stale value. Use a functional update, a reducer or a ref, and test it with `CliUiTest`'s `chunk`, which sends several keys in one read.
- **Theme through the bridge.** `Styled` paints a `TokenName` or an explicit `Style` through the mounted screen's theme; `useTheme()` (the stream's `StreamTheme`), `useGlyphs()` (the `GlyphSet`) and `useTerminalSize()` (`{ columns, rows }`, each one less than the terminal's) read the same context; never feed `columns` into a `Box`'s `width`, because on a resize Ink repaints before React re-renders and the stale width strands a copy of the frame (use `marginRight: 1` for a margin and `wrap: "truncate-end"` for a long row); `inkProps(style, color?)` maps a `Style` to Ink `Text` props. Never hard-code a colour: the theme is what turns it off at colour `none` and for an agent.
- **Sanitise your own data.** Text from data in your own components (`Text`, `Styled`) is yours to pass through `Fmt.sanitize`; the widgets do it for theirs.

## Rules that keep the terminal intact

- **Nothing may log while a screen is mounted.** Ink runs with `patchConsole` off, so a line written to the terminal from anywhere else tears the frame. Log before or after, or use a live view's `logConsole`.
- **React error boundaries do not catch an error thrown in an Ink `useInput` or `usePaste` handler** — Ink calls input handlers outside React's render. Inside a screen, a throwing `useKeys` dispatch (and the kit's own paste handling) is caught and ends the screen as a defect. A raw `useInput` or `usePaste` of your own is **not** guarded: catch inside it.
- **`ink` and `react` are optional peers** (`ink` ^7.1.1, `react` ^19.2.0), loaded by the kit only when a screen first mounts: importing `@effected/cli/ui`, or running a non-interactive program, loads neither (JSX and `ink` imports of your own load them when their module loads: see above). An interactive run without them is a defect naming both, never a silent fallback. A TypeScript consumer also installs `@types/react` (an optional peer, since React ships no types; without it a `skipLibCheck` build silently types every screen as `any`) and `@types/node`.
- **The root entrypoint never reaches `./ui`**, so a program that only imports `@effected/cli` cannot load Ink by accident.
- **A screen that awaits another `CliUi.run` deadlocks.** Screens run one at a time, process-wide, so the inner `run` waits for the outer to release, which waits for the inner. Nothing guards against it: ask the second question after the first screen resolves, in the handler.
- **A `CliUi.run` while a live view has a run drawn waits for that run to end**, so do not prompt in the middle of drawn progress. A drawn run's tick timer also keeps the process alive until the run's terminal event or the scope's close.
