---
id: "0016"
title: "effect: effect/ai/Skill models an Agent Skill as data, and McpServer serves it"
kind: adopt
shows: none
applies:
  "effect": ">=4.1.6"
detect: ["SKILL\\.md|registerSkill|McpServer"]
---

`effect/ai/Skill` is a new module (marked `unstable`): an Agent Skill as plain data, with validated YAML `Frontmatter`, markdown `instructions` and supporting `files`. `Skill.toFiles` and `Skill.fromFiles` convert to and from the `SKILL.md` layout. `McpServer.registerSkill` and `McpServer.skill` accept `Skill` values.

If the project hand-parses `SKILL.md` frontmatter or builds skills as ad hoc objects, consider adopting `Skill` and its schema. `Frontmatter` enforces the specification's `name` (lowercase letters, digits and single hyphens, at most 64 characters) and `description` limits, and keeps unknown fields. Check the installed `effect/ai/Skill` `.d.ts` before porting.
