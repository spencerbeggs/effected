---
"@effected/crypto": minor
---

## Features

* `HttpRedaction` copies HTTP errors with credentials removed, for libraries that keep a request or response as an error cause. It keeps the method, redacted URL, status and non-sensitive headers, and removes `authorization`, cookies, token-style headers, userinfo, signed-URL query values and the body. `@effected/npm`, `@effected/runtimes`, `@effected/jwt`, `@effected/github` and `@effected/github-actions` use it.
