---
id: "0004"
title: "effect/ai: the OpenAI and Anthropic structured-output codecs no longer emit a second null branch for an optional nullable property"
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.4"
detect: ["(OpenAi|Anthropic)StructuredOutput", "toCodec(OpenAI|Anthropic)", "generateObject"]
---

`OpenAiStructuredOutput.toCodecOpenAI` and `AnthropicStructuredOutput.toCodecAnthropic` encode an optional property as required-and-nullable, because the providers' strict modes need every key. A property that already accepted `null` got a second `null` branch (Effect-TS/effect#10522). A probe of `Schema.optionalKey(Schema.NullOr(Schema.Finite))` emits `anyOf: [number, null, null]` on the old version and `anyOf: [number, null]` on the new one. An absent key still encodes to `null` and decodes back to absent.

The JSON Schema sent to the provider changes, so a snapshot or an exact assertion on it fails. Where the search matched a test that pins a structured-output schema, re-record it after checking that the only change is the dropped duplicate branch. A provider call is unaffected in what it accepts.

`LanguageModel.generateObject` and `Chat.generateObject` also take a new `allowEmpty` option. Check the installed `.d.ts` for it before relying on the default.
