---
type: Gotcha
title: React 19's development reconciler leaked user-timing entries on every render, until react-reconciler 0.34
description: "Deprecated: react-reconciler 0.34, which every Ink the kit's ink ^8 peer admits requires, clears each performance measure as it records it, so the per-render leak 0.33 had is unreachable and the kit clears nothing; a test pins it, installing the console.timeStamp a Vitest worker lacks so the check cannot pass vacuously."
status: deprecated
tags: [performance, compat, testing]
sources:
  - id: measures-test
    resource: ../../packages/cli/__test__/ui/reactMeasures.test.ts
    title: "React records a measure per rerender and none are left, with console.timeStamp installed before Ink loads"
  - id: live-test
    resource: ../../packages/cli/__test__/ui/CliUiTest.live.test.ts
    title: "Test 4: React's entries never pile up under a live view, and a program's own performance.measure survives it"
  - id: react-entry
    resource: "npm:react@19.3.0"
    title: "react/index.js:3 and react-reconciler/index.js:3 pick the development build when NODE_ENV !== production"
  - id: reconciler-clears
    resource: "npm:react-reconciler@0.34.0"
    title: "cjs/react-reconciler.development.js: each of its 8 performance.measure calls is followed by performance.clearMeasures; 0.33.0 has none"
  - id: ink-pins-reconciler
    resource: "npm:ink@8.0.0"
    title: "package.json: react-reconciler ^0.34.0 (Ink 7.1.1 had ^0.33.0)"
generated:
  by: "okfit/claude-code"
  at: 2026-10-08T02:48:10Z
  body_sha256: 192effed63b6b216c2f3068ed4e0ef84a50f9778ab6eb2292f23faa6d25ba47e
---

# React 19's development reconciler leaked user-timing entries on every render, until react-reconciler 0.34

## Status

Deprecated: the trap is fixed upstream and the kit carries no workaround.
react-reconciler 0.34 pairs every `performance.measure` it makes with a
`performance.clearMeasures` of the same name,[^reconciler-clears] and Ink 8
depends on `^0.34.0`,[^ink-pins-reconciler] so on any Ink the kit's `^8.0.0`
peer admits, React's development build leaves no measures behind. `@effected/cli`
clears nothing itself: a process-wide clear would also wipe a program's own
measures, and a live-view test asserts that a program's `performance.measure`
survives a run.[^live-test]

## What still holds

React picks its development build whenever `NODE_ENV` is not exactly
`production`,[^react-entry] an unset `NODE_ENV` included, and that build
records `measure` entries on every render. It records them only when
`console.timeStamp` is a function, checked once as the reconciler loads.
Node's console has it; a Vitest worker's does not, so inside a worker React
records nothing and any test about these entries passes vacuously unless it
installs `console.timeStamp` before Ink is imported. The measures test does
that, then spies on `performance.measure` to prove React recorded and asserts
none are left.[^measures-test]

## What to do

Nothing, on Ink 8. If that test goes red, a reconciler the peer admits leaks
again: measures, never marks, pile up at about 15 per rerender, and a
long-lived view's heap grows. Only then reintroduce a clear, and scope it so
it cannot take a program's own measures.

[^measures-test]: `packages/cli/__test__/ui/reactMeasures.test.ts`
[^live-test]: `packages/cli/__test__/ui/CliUiTest.live.test.ts`, test 4
[^react-entry]: `npm:react@19.3.0`, `index.js:3`, and `npm:react-reconciler`, `index.js:3`
[^reconciler-clears]: `npm:react-reconciler@0.34.0`, `cjs/react-reconciler.development.js`
[^ink-pins-reconciler]: `npm:ink@8.0.0`, `package.json`
