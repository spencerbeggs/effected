---
"@effected/github-actions": minor
---

## Features

### `ActionEnvironment.makeTest` / `layerTest` accept a webhook payload directly

A new optional second positional argument serves `payload` to the test double without routing through the filesystem:

```ts
import { ActionEnvironment } from "@effected/github-actions";

const layer = ActionEnvironment.layerTest(
	{ GITHUB_EVENT_NAME: "pull_request" },
	{ pull_request: { number: 42 } },
);
```

Previously there was no route to a payload through the standard double at all: `layerTest` hard-provides a noop filesystem and `makeTest` captures it at construction, so seeding `GITHUB_EVENT_PATH` through `overrides` sent the read nowhere. Consumers whose action logic is a function of the webhook payload had to drop to hand-composing a filesystem stub at every call site. `undefined` still means "not served" — an unarranged payload read fails typed, naming `GITHUB_EVENT_PATH`.

### `ActionLogger.withStep` — a quiet-on-success, verbose-on-failure step wrapper

```ts
import { ActionLogger } from "@effected/github-actions";
import { Effect } from "effect";

const program = Effect.gen(function* () {
	const logger = yield* ActionLogger;
	yield* logger.withStep("publish", publishEffect, { summary: "📦 published" });
});
```

Runs a named step quietly on success — exactly one info line, default `✅ <name>`, overridable via `options.summary` — and on failure emits a `❌ <name>` header followed by the full buffered transcript. `withBuffer({ onSuccess: "discard" })` alone cannot express this: it leaves a green step with zero lines. The new `WithStepOptions` type is exported alongside it.

## Documentation

- `ActionInput.string` — an input whose contract is "set it empty to disable this" cannot be read via `Config.withDefault`; empty is classified missing before the default is consulted. Use `Config.option` instead.
- `ActionInput.provider` / `providerOver` / `layerDefault` — never compose a bare `ConfigProvider.fromEnv` beneath them. It uppercases the config path, so input-name keys never match and reads silently fall back to their default while the test suite stays green.
- `GitHubMarkdown` — a render cannot fail, so wrapping it in `Effect.try` is unnecessary. The one reachable throw is `tableFor`'s row codec, for a value smuggled past the types — not the serializer.
