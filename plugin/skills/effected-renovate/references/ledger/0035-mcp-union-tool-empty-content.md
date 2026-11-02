---
id: "0035"
title: A union MCP tool with no success schema answers with empty content
kind: behaviour
shows: behavioural
applies:
  "@effected/mcp": ">=0.12.0"
detect: ["(^|[^A-Za-z])Tool\\.make\\("]
---

A union tool declared with no `success` schema now answers `tools/call` with `content: []`. It used to fail with an internal error. If a test asserted that error, or a client relied on it, update it; if the tool should return something, give it a `success` schema.

How it shows itself: only tests find it.
