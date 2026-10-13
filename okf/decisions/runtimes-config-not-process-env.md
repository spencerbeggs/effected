---
type: Decision
title: The config-driven GitHub auth layer reads Config, never process.env
description: Token resolution uses Config with a documented precedence between two conventional environment variables, warns on ambiguity, and holds the token Redacted.
status: draft
tags:
  - architecture
  - security
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: f27d0accda740fbb
---

# The config-driven GitHub auth layer reads `Config`, never `process.env`

## Context

`@effected/runtimes`' config-driven `GitHubAuth` layer needs to resolve a
GitHub token from one of two conventional environment variable names.
Reading `process.env` directly for this would make the resolution
untestable without mutating the real process environment and would leak
the token as a bare string.

## Decision

The config-driven auth layer resolves its token through `Config` with a
documented precedence between the two conventional environment
variables, warns on ambiguity when both are set, is testable by swapping
a `ConfigProvider`, and holds the token as a `Redacted` value end to end.

## Alternatives rejected

**Reading `process.env` directly.** Rejected because it makes the
resolution untestable without mutating the real process environment (or
monkey-patching it), and because a bare-string token has no structural
protection against ending up in a log line, a span annotation or a
serialized error.

## Consequences

A test of the auth precedence swaps a `ConfigProvider` rather than
setting real environment variables, which is what keeps the test suite
free of ambient environment mutation between test files.
