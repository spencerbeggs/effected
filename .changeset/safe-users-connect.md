---
"@effected/github": minor
---

## Features

### `GitHubUserAuth`

Runs the OAuth web flow a GitHub App or OAuth App uses to act as a user: `exchange` (with PKCE), `refresh` and `revokeGrant`. It calls `fetch` directly, so a Worker that only signs users in links neither octokit nor the JWT signer. Tokens are `Redacted`, expiries are absolute instants, and no credential reaches an error message or a kept cause. `GitHubUserAuth.layerTest` is the test double.

Every failure is one of two errors:

* `GitHubUserAuthFinal`: GitHub refused. It keeps the `code` and carries a `remedy`
* `GitHubUserAuthTemporary`: `network`, `timeout`, `status` (5xx, 429, 408, or a 403 whose message names a rate limit) or `malformed`. Retry later and keep the tokens you hold

Branch on `remedy`, not on the error being final. `reconnect` means the user's grant is dead, while `reconfigure` means the app is wrong. `incorrect_client_credentials` lands on `reconfigure`, so a handler that drops tokens on any final failure signs every user out when a client secret is rotated.

```ts
import { GitHubUserAuth } from "@effected/github";
import { Effect, Redacted } from "effect";

// bind once — layers memoize by reference
const UserAuth = GitHubUserAuth.layer({
  clientId: "Iv23liExample",
  clientSecret: Redacted.make(process.env.GITHUB_CLIENT_SECRET as string),
});

const renew = (refreshToken: Redacted.Redacted<string>) =>
  Effect.gen(function* () {
    const auth = yield* GitHubUserAuth;
    return yield* auth.refresh({ refreshToken });
  }).pipe(
    Effect.catchTag("GitHubUserAuthFinal", (error) =>
      error.remedy === "reconnect" ? Effect.succeed("sign-in-again" as const) : Effect.fail(error),
    ),
  );
```

GitHub rotates the refresh token on every refresh it processes, so a refresh that failed after reaching GitHub answers `bad_refresh_token` when retried, and the user signs in again.
