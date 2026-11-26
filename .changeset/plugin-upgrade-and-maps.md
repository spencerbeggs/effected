---
"@effected/ai-plugins": minor
---

## Features

### The upgrade skill is `/effected:upgrade` and runs unattended

The consumer upgrade skill is renamed from `effected-renovate` to `upgrade`, so it is invoked as `/effected:upgrade`; the old name no longer exists. Invoking it is consent to every repository-local step, adopt entries included: it applies them by default and holds one back only for a named serious issue (a change to a published package's API or behaviour, a conflict with the repository's own instructions or a deliberate pin, a fix that needs a forbidden workaround, or a design decision with more than one reasonable answer), reporting held-back items at the end instead of stopping. It still never commits, pushes or opens a pull request. A new step repins a vendored Effect submodule to the resolved `effect` tag on every upgrade.

### Agents look up the kit and core before they write

* The SessionStart briefing opens with a lookup ritual (name the capability, grep the construct index, read the package reference and core's routing table, confirm in source) with absolute paths that run in an installed plugin, and is about half its former length
* A new SubagentStart hook gives `effect-developer`, `effect-reviewer` and `action-engineer` the same lookup rule
* Those three agents preload `effect-v4-module-index`, gate every new helper on the lookup, and name the construct they chose in their report
* The map skills open with a one-minute lookup procedure; `effect-v4-module-index` gains routing rows for globs, semver, parsing, retries, environment reads, temporary directories and HTTP; `effect-v4-testing` gains a table of which test double fits which service
* Skill descriptions lead with the verbs and objects an agent searches by

### A simplifier pass is part of every code change

`effect-developer` and `action-engineer` run a simplifier pass over their diff once it is green and re-run the gates; `effect-reviewer` runs it as a standard review step and reports a behaviour-changing simplification as a defect. On Claude Code the pass is the built-in `simplify` skill; on Copilot it is an inline checklist.

## Bug Fixes

* Examples that hand-rolled file reads, UUIDs and clock reads now use `@effected/memfs`, `SecureRandom` and `DateTime`
