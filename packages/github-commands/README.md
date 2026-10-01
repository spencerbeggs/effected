# @effected/github-commands

[![npm](https://img.shields.io/npm/v/@effected%2Fgithub-commands?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/github-commands)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

The GitHub Actions workflow-command grammar as pure functions: render a command with the runner's escaping, and neutralize text so the runner cannot read it as one. Strings in, strings out. No service, no layer, no platform, no `effect`, and no dependency at all.

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 prerelease. Packages graduate to
> `1.0.0` once Effect `4.0.0` ships.
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version. Full
> policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/github-commands

The runner reads every line a step writes, and a line it recognises as a command does what the command says: `::add-mask::` redacts, `::error::` raises an annotation, `::stop-commands::` turns processing off. Text a program did not write itself, an error message or a file name, can therefore carry a command. The runner has two parsers, so "starts with `::`" is half the rule: the legacy one finds `##[` anywhere in a line.

This package is the rule written once. `WorkflowCommand` builds the commands you mean to write, with the escaping the protocol needs. `CommandNeutralizer` defangs the text you did not mean to write as one.

## Install

```bash
pnpm add @effected/github-commands
```

## Usage

```ts
import { CommandNeutralizer, WorkflowCommand } from "@effected/github-commands";

WorkflowCommand.error("build failed", { file: "src/main.ts", startLine: 12 });
// "::error file=src/main.ts,line=12::build failed"

CommandNeutralizer.text("prefix ##[add-mask]secret\n::error::x");
// a zero-width space inside ##[ and before the ::, so neither parser reads a command
```

A bare `##` is left alone, so a markdown heading is unharmed. The neutralizer is idempotent, and splits at CR, LF and CRLF as the runner does.

## License

MIT
