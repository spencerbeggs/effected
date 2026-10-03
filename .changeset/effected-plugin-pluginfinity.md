---
"@effected/ai-plugin": minor
---

## Features

### One plugin for Claude Code and GitHub Copilot

The effected plugin is now built from a single source for both hosts, so the Claude Code and Copilot plugins carry the same skills, agents and session briefing at the same version. The Copilot plugin moves onto the shared version line with this release.

* The Copilot plugin now carries every skill reference the Claude Code plugin does, including the installer integrity options that had fallen out of its `actions-cache-and-artifacts` reference
* Copilot agents list only tools Copilot provides: `read`, `edit`, `search`, `todo`, `execute` and `web`
* Four skills whose combined trigger text exceeded Copilot's 1024-character limit now ship a shorter Copilot description that fits within it
* The Copilot session briefing finds the project root from the session's working directory, since Copilot exposes no project-root variable

## Bug Fixes

* The `effect-v4-testing` and `effected-packages` skills now parse correctly: unquoted `when_to_use` text containing a colon followed by a space, or a `#`, had been invalid or cut short
