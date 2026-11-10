---
id: "0053"
title: "AI tool parameters and results go through their JSON codec, so a Tool.dynamic result must be JSON"
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.3"
detect: ["Tool\\.dynamic\\(", "encodedResult"]
---

This applies to code that defines `effect/ai` tools, whether served over MCP or called by a language model. Tool parameters are now decoded with their JSON codec, so a `Schema.Date` parameter accepts an ISO string (Effect-TS/effect#10332). Tool results are encoded with their JSON codec, so a `Schema.Date` or `Schema.BigInt` result reaches the client as JSON (Effect-TS/effect#10362).

- **A `Tool.dynamic` tool with no `success` schema must return a JSON value**, even when `toModelOutput` replaces the payload the model sees. Any other value, such as a `Date`, now fails with `ToolResultEncodingError`. Declare a `success` schema, or return a JSON value. A dynamic tool that returns `undefined` declares `success: Schema.Void`.
- **`encodedResult` of a `Schema.Void` tool is now `null`**, not `undefined`. That includes `Tool.make` with no `success` schema. Update any test or handler that compares it with `undefined`.
- A test that pinned a non-JSON result reaching the client unchanged now sees the encoded form. Update it to the encoded value.

Check the installed `effect/ai/Tool` `.d.ts`. Verify by running your tool tests, and by calling each dynamic tool once through your MCP harness.
