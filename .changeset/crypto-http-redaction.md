---
"@effected/crypto": minor
---

## Features

* `HttpRedaction` copies HTTP errors with credentials removed, for libraries that keep a request or response as an error cause. It keeps the method, URL, status and headers, replaces the values of `authorization`, cookies and token-style headers with `REDACTED`, redacts URL userinfo and signed-URL query values, and drops the body. `@effected/npm`, `@effected/runtimes`, `@effected/jwt`, `@effected/github` and `@effected/github-actions` use it.
