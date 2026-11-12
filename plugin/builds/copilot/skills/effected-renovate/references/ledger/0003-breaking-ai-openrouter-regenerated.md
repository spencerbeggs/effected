---
id: "0003"
title: "@effect/ai-openrouter: the generated client follows the current OpenRouter spec, removing intermediate schema exports and adding required fields"
kind: breaking
shows: typed
applies:
  effect: ">=4.1.4"
detect: ["@effect/ai-openrouter"]
---

This applies only to a repository that depends on `@effect/ai-openrouter`, which moves in lockstep with `effect`. Its `Generated` module was regenerated from the current OpenRouter specification (Effect-TS/effect#10521). It drops 296 exports and adds 1,228.

- **A removed intermediate schema export** fails to import. Derive the type from the request or response schema that contained it instead.
- **Newly required fields** fail to typecheck, or to decode, in hand-built values, fixtures and stored responses. Generation statistics need `workspace_id`, and activity entries need `cached_tokens`. `Model` needs `endpoints`. `BYOKKey` needs `declared_region`, `declared_zdr`, `is_byok_only` and `is_required`. `PublicEndpoint` needs `native_tools`, `service_tier`, `supports_diarization` and `supports_tool_choice`. `Guardrail` needs `include_byok_in_budgets`. `VideoModel` needs `creativity` and `upscale_factor`. `GenerationContentData` needs `error`, and `FusionCallAnalysisInProgressEvent` needs `analyst_model`. Every `Observability*Destination` needs `regions`, `broadcast_generation_cost`, `broadcast_generation_cost_allocation`, `broadcast_generation_identity` and `broadcast_generation_request_context`.
- **The workspace-deletion confirmation flag is a boolean**, and tool parameter and structured-output schemas accept JSON-valued records.

Run the typecheck, then the tests that decode recorded OpenRouter responses. Read the installed `Generated` `.d.ts` for each schema a fixture builds.
