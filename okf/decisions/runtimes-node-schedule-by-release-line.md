---
type: Decision
title: The Node schedule is keyed by release line, not by major
description: NodeScheduleEntry carries a line string ("20", "0.10") rather than a numeric major, because early Node majors collapse under Number.parseInt.
status: draft
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: dc43de583223b579
---

# The Node schedule is keyed by release line, not by major

## Context

Node's release-schedule repository publishes `v0.8`, `v0.10` and `v0.12`
as three distinct lines with their own start and end dates. `@effected/runtimes`
needs to look up a version's release-lifecycle phase (current, active LTS,
maintenance, end-of-life) against that schedule.

## Decision

`NodeScheduleEntry` carries a **line** string (`"20"`, or `"0.10"`), and
phase lookups take a version rather than a bare major; asking for the bare
major `0` honestly returns `None`. `Number.parseInt` maps `v0.8`, `v0.10`
and `v0.12` all to major `0`, so keying by major would collapse three
distinct lines onto whichever the iteration order happened to yield
first — an early-Node lookup would silently answer with the wrong line's
schedule. A schedule feed carrying an undecodable date fails typed
rather than dying.

Phase itself is a function of `(release, schedule, now)`, with the
schedule owned by the release index rather than the domain model — the
domain model holds no `Ref`. The reference date is an explicit argument,
which is what makes phase logic testable without stubbing `Date` — see
[wall-clock time via Clock](runtimes-wall-clock-via-clock.md).

## Alternatives rejected

**Key the schedule by numeric major.** Rejected because it is
demonstrably wrong for every Node release before v1.0: `v0.8`, `v0.10`
and `v0.12` all parse to major `0`, so a major-keyed table can represent
at most one of the three lines and silently misreports lookups against
the others.

## Consequences

A fixture built only from modern majors (`v20`, `v21`, `v22`) structurally
cannot catch a regression in this area, because those majors have no
dotted-line ambiguity to collapse — the package's test fixtures carry the
dotted `0.x` lines specifically so a reference date where the lines
disagree pins the behavior.
