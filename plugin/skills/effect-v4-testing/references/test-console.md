# `it.effect` also intercepts CONSOLE output — including `Effect.log*`

Loaded from `effect-v4-testing`.

`TestEnv` installs `TestConsole` alongside the clock, so a test spying on the
real `console.log` to capture Effect's output silently captures **nothing** —
and **auditing for `Console.*` call sites is insufficient**, because Effect's
default logger writes through the same ref. The identity is source-visible, not
folklore: `Console.Console` **is** `effect.ConsoleRef` (`Console.ts:86`),
`TestConsole.layer` is `Layer.effect(Console.Console)(make)`
(`testing/TestConsole.ts:300`), and `Logger.ts:277`, `:318`, `:373` all read
`options.fiber.getRef(effect.ConsoleRef)`. One repo's audit cleared a
package by grepping `Console.*` and missed three live `Effect.logWarning`
sites. Only direct `console.*`, direct `process.stdout.write` / `stderr.write`,
and a **replaced** logger set (`Logger.layer([...])` without
`mergeWithExisting`) writing to one of those are immune.

It fails silently, and it produced two vacuous passes — "no output in quiet
mode" tests that pass unconditionally because the drained sink is always empty.
**A test whose only assertions are negative is the vacuous-pass shape**; a
positive sibling is the cheap proof the sink is live. `TestConsole.logLines` is
cumulative and never drained by reading it, so a test invoking a CLI twice
asserts against a growing buffer →
[false-greens.md](./false-greens.md).
