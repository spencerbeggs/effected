---
id: "0007"
title: "effect/ai: an MCP server with skills declares and serves the Skills extension on protocol revisions before 2026-07-28"
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.4"
detect: ["McpServer\\.(registerSkill|skill)\\(", "McpClient"]
---

This applies only to an MCP server that registers a skill with `McpServer.skill` or `McpServer.registerSkill`, or to a client that reads skills. Effect-TS/effect#10540 restores skills on the older, sessionful protocol revisions (2024-11-05 through 2025-11-25). There, the server used to drop the Skills extension from its `initialize` capabilities and answer only `resources/read` for the skill's files. It now declares the extension once any skill is registered, and answers skill discovery, retrieval and directory browsing as it does on 2026-07-28. `McpClient` reads them on those revisions too.

This was not probed here. Where the search matched, check two things. First, an `initialize` snapshot or capabilities assertion on an older revision now includes the extension. Second, a test that asserted a skills method was unknown on that revision now gets an answer. Run the MCP server's protocol tests.
