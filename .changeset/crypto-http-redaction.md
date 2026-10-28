---
"@effected/crypto": minor
---

## Features

* `HttpRedaction` copies HTTP errors with credentials removed, for libraries that keep a request or response as an error cause. It keeps the method, URL, status and headers, replaces the values of `authorization`, cookies and token-style headers with `REDACTED`, redacts URL userinfo and signed-URL query values, and drops the body. `@effected/npm`, `@effected/runtimes`, `@effected/jwt`, `@effected/github` and `@effected/github-actions` use it.

## Bug Fixes

### Security

* `HttpRedaction.text` runs in linear time. Its URL scan was quadratic on a long run of scheme characters with no `://` (80 KB took seconds), which a large server-sent error body could use to stall the event loop.
* `Bearer`, `Basic` and `token` credentials are matched in any case, so a lowercase `bearer …` no longer survives. A value is redacted only when it reads as a credential, so prose such as "invalid token provided by" is left as written.
