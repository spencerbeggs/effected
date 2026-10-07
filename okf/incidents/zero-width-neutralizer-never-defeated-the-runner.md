---
type: Incident
title: A zero-width space never stopped the Actions runner reading a workflow command
description: "CommandNeutralizer shipped putting U+200B before a :: line and inside ##[, but the runner matches with culture-sensitive .NET comparisons under ICU, which skip zero-width characters, so every neutralized line was still a command; it now matches through what ICU skips and marks with U+2800."
status: draft
occurred: "2026-10-01T00:00:00Z"
guard: ../../packages/github-commands/__test__/CommandNeutralizer.test.ts
tags:
  - security
  - github
sources:
  - id: runner-parser
    resource: "https://github.com/actions/runner/blob/ecb5f298fad8b116679389f6df064c1a0229d148/src/Runner.Common/ActionCommand.cs"
    title: "actions/runner ActionCommand.cs: TryParseV2 L62-63 (TrimStart, then StartsWith(\"::\")) and TryParse L132 (IndexOf(\"##[\")), neither with a StringComparison"
  - id: runner-icu
    resource: "https://github.com/actions/runner/blob/ecb5f298fad8b116679389f6df064c1a0229d148/src/Misc/layoutbin/installdependencies.sh"
    title: "The runner installs libicu, and Runner.Worker.csproj targets net8.0 with PredefinedCulturesOnly false and no invariant globalization"
  - id: icu-probe
    resource: "Probe on .NET 8 (mcr.microsoft.com/dotnet/sdk:8.0), 2026-10-07: the runner's exact calls over candidate markers, every code point, and 20,000 random lines with and without neutralizing"
    title: "ICU skips 958 code points in every position; 0 of 641 commands survive the new neutralizer"
  - id: oracle
    resource: ../../packages/github-commands/__test__/helpers/runnerCommands.ts
    title: "The independent oracle, which models ICU with the measured skip set (ICU_IGNORED)"
  - id: ink-filter
    resource: "npm:ink@8.0.0"
    title: "Ink 8.0.0, build/output.js:38: drops every Default_Ignorable_Code_Point from a frame"
  - id: docview-test
    resource: ../../packages/cli/__test__/ui/DocView.test.ts
    title: "A CliUi.run screen's DocView under Actions carries no command, and Ink draws the marker"
generated:
  by: "okfit/claude-code"
  at: 2026-10-07T21:32:23Z
  body_sha256: 001e3ff40387a2590352d1eec3154c3cb0ebcf68fcbca0b7bc9b6b18eb2887f3
---

# A zero-width space never stopped the Actions runner reading a workflow command

## What shipped broken

`@effected/github-commands` shipped `CommandNeutralizer` in its first release.
It put a zero-width space (U+200B) in front of a line that would start with
`::` and between the `##` and `[` of every `##[`. `@effected/cli` and
`@effected/github-actions` route every line of untrusted text they write under
GitHub Actions through it: error messages, file names, document text and log
lines.

## What it looked like to the consumer

Nothing looked wrong. The text came out with the invisible character in place,
and the kit's own tests passed. But the runner still read each neutralized line
as a command, so data such as an error message carrying `::add-mask::` or
`##[stop-commands]` could still act on the job.

## Root cause

The runner tests every line with two parsers: `TrimStart()` then
`StartsWith("::")`, and `IndexOf("##[")` anywhere in the line. Neither call
passes a `StringComparison`, so both compare culture-sensitively.[^runner-parser]
The runner runs on ICU: it installs libicu and does not turn on invariant
globalization.[^runner-icu] ICU's collation treats 958 code points as if absent,
the same set in every position: controls other than whitespace, format
characters (U+200B, U+FEFF), most combining marks, variation selectors, tag
characters and five others.[^icu-probe] So `"​::error::x"` starts with `::`
and `"##​[x"` contains `##[`.

The test oracle shared the blind spot. It modelled an ordinal comparison, so it
judged the neutralized lines safe; the tests pinned the code's output against
the same wrong model of the runner.

Ink 8 exposed it: it drops every default-ignorable code point from a frame,[^ink-filter]
so the marker vanished from a screen and a DocView test failed. Text Ink never
touched had the same hole all along.

## The guard

- **The marker is U+2800 BRAILLE PATTERN BLANK.** It is not .NET whitespace,
  ICU gives it a weight, it is not default-ignorable (so Ink keeps it), and it
  draws as one blank cell. A middle dot also works but is visible; a no-break
  space and an ideographic space are .NET whitespace, which `TrimStart`
  removes; a word joiner is skipped exactly as U+200B is.
- **Matching looks through what ICU skips.** The neutralizer treats a superset
  of the skip set as transparent, so `":​:x"` and text that already carries
  a U+200B in front of a command are neutralized, not taken as safe.
- **The oracle models ICU** with the measured skip set, independent of `src/`.[^oracle]
  Against .NET 8 on 20,000 random lines it never missed a command, and 0 of the
  641 commands among them survived neutralizing.[^icu-probe]
- **The tests:** `CommandNeutralizer.test.ts` holds the oracle seeing through
  each kind of skipped character, an exhaustive run over them, idempotency,
  and a U+200B-prefixed command being neutralized again. `DocView.test.ts`
  holds a screen under Actions carrying no command and Ink drawing the marker.[^docview-test]

[^runner-parser]: <https://github.com/actions/runner/blob/ecb5f298fad8b116679389f6df064c1a0229d148/src/Runner.Common/ActionCommand.cs>
[^runner-icu]: <https://github.com/actions/runner/blob/ecb5f298fad8b116679389f6df064c1a0229d148/src/Misc/layoutbin/installdependencies.sh>
[^icu-probe]: Probe on .NET 8 (`mcr.microsoft.com/dotnet/sdk:8.0`), 2026-10-07, run once and not kept.
[^oracle]: `packages/github-commands/__test__/helpers/runnerCommands.ts`
[^ink-filter]: `npm:ink@8.0.0`, `build/output.js:38`
[^docview-test]: `packages/cli/__test__/ui/DocView.test.ts`
