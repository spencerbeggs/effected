---
"@effected/jwt": patch
---

## Bug Fixes

* A crypto backend that cannot use a key (an algorithm the provider does not support) fails with `JwtError` reason `key`, as a rejected key does; core now reports this case as `JoseError` `CryptoFailed`, and the error message names the backend module, method and reason
