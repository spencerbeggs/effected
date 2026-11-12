---
id: "0009"
title: "effect/ai: WorkloadIdentity exchanges a workload identity token for a cached Anthropic, OpenAI or OpenRouter access token"
kind: adopt
shows: none
applies:
  effect: ">=4.1.4"
  "@effect/ai-anthropic": ">=4.1.4"
  "@effect/ai-openai": ">=4.1.4"
  "@effect/ai-openrouter": ">=4.1.4"
detect: ["grant-type:token-exchange", "token-type:(jwt|id_token)"]
---

Offer this to the user; never apply it unasked. It replaces a hand-rolled OAuth token exchange that trades a workload identity token, such as a CI OIDC token, for a model provider's access token, and the cache around it.

`effect/ai`'s `WorkloadIdentity.make` authenticates an `HttpClient`: it exchanges the identity token, caches the access token until it expires, and refuses to send the identity token to a token URL that is not `https`, except on localhost. For one provider, use that provider package's `AnthropicWorkloadIdentity`, `OpenAiWorkloadIdentity` or `OpenRouterWorkloadIdentity` module (Effect-TS/effect#10512).

Where the search matched a token-exchange request body, check whether it feeds a provider client. If it does, replace the request and its cache with the provider's module. The `HttpClient` it exchanges through must not follow redirects or log request bodies, because the identity token travels in the body. `WorkloadIdentity` turns redirects off for `FetchHttpClient` and fails the exchange on a redirect response; a custom client, or a logging or tracing middleware that records bodies, must be checked by hand. Keep the identity-token source: an `@effected/oidc` `IdentityToken` or the CI environment still supplies it. Check the installed `.d.ts` for the options. Verify with a test against a stubbed token endpoint that asserts one exchange across two requests.
