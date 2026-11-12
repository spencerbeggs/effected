---
id: "0005"
title: "@effect/ai-openai and @effect/ai-anthropic: an OpenAI WebSocket transform failure is an AiError, and Anthropic keeps tool-call finish reasons under native structured output"
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.4"
detect: ["@effect/ai-(openai|anthropic)", "finishReason"]
---

Two provider changes, from Effect-TS/effect#10512 and Effect-TS/effect#10527. Both were read in the provider source, not probed:

- **OpenAI over WebSocket.** A failure in the client's transform now arrives as an `AiError` in the error channel, where it used to die as a defect. A caller that caught it with `catchDefect` or `catchAllCause`, or a test that asserted a die, should handle the `AiError` instead.
- **Anthropic with native structured output.** A JSON response that also makes an ordinary tool call reports `finishReason` `"tool-calls"`, where it was rewritten to `"stop"`. Only the fallback structured-output tool still maps its tool call to `"stop"`. A `switch` on `finishReason` after `generateObject` may now see `"tool-calls"`.

Where the search matched, find the WebSocket client and any handling of `finishReason`. Run the tests that drive those providers, recorded or live.
