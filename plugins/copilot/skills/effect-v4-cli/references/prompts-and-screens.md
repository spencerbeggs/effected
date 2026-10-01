# Prompts and screens: `CliPrompt` and `@effected/cli/ui`

Loaded from `effect-v4-cli`. Covers asking a person for input: core's `Prompt` gated by `CliPrompt`, the Ink screens behind `@effected/cli/ui`, the ready-made widgets, writing a screen of your own, and the rules that keep a screen from tearing the terminal.

## Two engines, one contract

| Engine | Import | Reach for it when |
| --- | --- | --- |
| core `Prompt` + `CliPrompt.fallback` | `effect/cli`, `@effected/cli` | a line-based question (text, number, confirm, select) with no extra dependencies |
| Ink screens: `CliUi` + widgets | `@effected/cli/ui` | a richer screen: a scrolling list, sections of checkboxes, a confirm with toggles, tabs, your own layout |

Both obey the same contract: they prompt **only** when `CliInteractive` is true (a human audience, terminals on stdin and stdout, `TERM` not `dumb`), a quit is **one `Cancelled`** (`reason: "escape" | "interrupt"`, exit `130`), and a prompt reached in a run that cannot prompt either answers a default you supply or fails (`NotInteractive`, exit `64`, or core's missing-parameter error, exit `64`). Every one of these needs `CliRuntime.main(..., { env })` (or `CliEnv.layer`) to have decided `CliInteractive`; without it nothing ever prompts.

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
| `lazy(() => import("./screen.js"))` | defers a screen's module to its mount; the module's default export is the `Screen` |
| `context` | `Effect<UiContextValue, never, CliTheme>`: the theme and glyphs for an Ink tree the kit did not mount (see the live-view reference) |

```tsx
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

Each widget is a pure `init`/`step` reducer, a `keys` table, a `View`, and (except `Toggle` and `Tabs`) a ready-made `screen(options)`:

| Widget | `screen(options)` resolves | Options |
| --- | --- | --- |
| `Select` | the chosen `value` | `{ message, choices: [{ label, value, detail?, disabled? }], initial?, height? }`; disabled choices are skipped |
| `TextInput` | `string` | `{ message, initial?, placeholder?, validate? }`; `validate` returns an error message or `undefined`, checked on submit |
| `MultiSelect` | `ReadonlyArray<A>`, in section order | `{ message, sections: [{ title, items: [{ key, label, value, detail?, selected? }] }], height? }`; keys unique across sections |
| `Confirm` | `{ confirmed, toggles }` | `{ message, initial?, toggles?: [{ key, label, value }] }`; `toggles` is partial by key |
| `Toggle`, `Tabs` | — | components for your own screen; `Tabs` cycles with Tab and Shift-Tab and jumps with digits |
| `Viewport` | — | a pure reducer over a window of rows that never draws more lines than fit |

Every string a widget draws from data is sanitised and its line breaks folded to spaces before it is measured, so data cannot paint colour, plant a hyperlink, or add a row the layout did not count.

## Writing a screen

A `Screen<A>` is `(control: ScreenControl<A>) => ReactElement | Promise<ReactElement>`, with `control.resolve(value)` and `control.cancel(reason)`; the first call wins.

```tsx
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

export const counter: Screen<number> = ({ resolve }) => {
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
```

- **Keys are data.** `KeyTable.make(bindings)` is the one source for dispatch and for the help line (`KeyHelp`, merged with `KeyTable.root`'s Esc and Ctrl-C); the first binding for a key wins. `useKeys(table, dispatch, { isActive? })` is one Ink `useInput`. `UiKey` is the kit's key model: `Named` keys (`up`, `enter`, `escape`, `space`, `tab`, `shift+tab`, `pageup`, `ctrl+c`, …) or a `Char`.
- **Step from current state.** Ink hands every key of one stdin read to the handler **before React re-renders**, so a handler reading render-closure state processes a pasted or fast-typed burst against a stale value. Use a functional update, a reducer or a ref, and test it with `CliUiTest`'s `chunk`, which sends several keys in one read.
- **Theme through the bridge.** `Styled` paints a `TokenName` through the mounted screen's theme; `useTheme()`, `useGlyphs()` and `useTerminalSize()` read the same context; `inkProps(style, color?)` maps a `Style` to Ink `Text` props. Never hard-code a colour: the theme is what turns it off at colour `none` and for an agent.
- **Sanitise your own data.** Text from data in your own components (`Text`, `Styled`) is yours to pass through `Fmt.sanitize`; the widgets do it for theirs.

## Rules that keep the terminal intact

- **Nothing may log while a screen is mounted.** Ink runs with `patchConsole` off, so a line written to the terminal from anywhere else tears the frame. Log before or after, or use a live view's `logConsole`.
- **React error boundaries do not catch an error thrown in an Ink `useInput` or `usePaste` handler** — Ink calls input handlers outside React's render. Inside a screen, a throwing `useKeys` dispatch (and the kit's own paste handling) is caught and ends the screen as a defect. A raw `useInput` or `usePaste` of your own is **not** guarded: catch inside it.
- **`ink` and `react` are optional peers** (`ink` ^7.1.1, `react` ^19.2.0), loaded only when a screen first mounts: importing `@effected/cli/ui`, or running a non-interactive program, loads neither. An interactive run without them is a defect naming both, never a silent fallback. A TypeScript consumer also installs `@types/react` (an optional peer, since React ships no types; without it a `skipLibCheck` build silently types every screen as `any`) and `@types/node`.
- **The root entrypoint never reaches `./ui`**, so a program that only imports `@effected/cli` cannot load Ink by accident.
