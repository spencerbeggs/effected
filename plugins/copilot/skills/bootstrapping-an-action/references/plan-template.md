# Plan file shape

Write to `<plansDirectory>/<YYYY-MM-DD>-bootstrap-<slug>.md`, where `<slug>` is the action name reduced to lowercase letters, digits and hyphens — never the raw name, which could carry a path separator. Every section is required; a section with nothing to say states that explicitly.

```markdown
---
status: ready
created: <YYYY-MM-DD>
kit: "@effected/github-actions@<installed version>"
---

# Bootstrap <action-name>

## Identity
- Name, org, purpose, branding.

## Frozen I/O contract
- Inputs: <count>. `INPUT_NAMES = [...] as const`. Defaults (mirror action.yml): ...
- Outputs: <count>. `OUTPUT_NAMES = [...] as const`. Baseline values: ...
- Cross-field rules: ...
- JSON contracts crossing the boundary: none, or one row per contract below. Inputs may repeat (one action can carry several JSON inputs); the structured output is singular.

| Direction | Name | Schema (exported class) | Published at | Version |
| --- | --- | --- | --- | --- |
| input | ... | ... | `<action>.input.schema.json` | unversioned |
| output | result | ... | `schemas/<semver>/<name>-<semver>.json` | <semver> |

## Phases
- main | main+post | pre+main+post, and why.
- GitHub access: none | token input | App auth (scopes: ...).

## Dependencies (honesty applied)
| Package | Installed | Imported by step | Why |
| --- | --- | --- | --- |

## Rename list
| File | Field or line | New value |
| --- | --- | --- |

## Steps (derived and provisional)
Derived from the purpose (question 1) and capabilities (question 6); the engineer agent finalises result types, error shapes and failure postures while building the walking skeleton. Treat every row as a starting point, not a frozen contract.
| Step | Result type | Error shape | Posture | R |
| --- | --- | --- | --- | --- |

## Reporting
- Surfaces, the single format module, stamp decision.

## Schema publication (only when a JSON contract crosses the boundary)
- Generator path, targets, version label, scripts, drift test.

## Self-dogfood
- Workflow, trigger, act target, freshness gate.

## Known unknowns
One row per enabling surface not confirmed in the installed tree, plus any checked-absent surface and the user's upstream-or-shim decision.
| # | Claim to verify | Against | Status |
| --- | --- | --- | --- |

## Build order (hand off to designing-an-action from Phase 0)
1. Freeze the contract in schema/inputs.ts and schema/outputs.ts; let the sync tests fail and fix them.
2. Walking skeleton: domain schema, inputs, outputs, state, step contracts as succeeding stubs, program and entries, layers proof.
3. Fill each step red/green/refactor in the order above.
4. Schema publication (if any), self-dogfood workflow, docs refresh, shim register audit.
```
