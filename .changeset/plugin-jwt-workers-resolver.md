---
"@effected/ai-plugins": patch
---

## Documentation

* The `effected-packages` `@effected/jwt` reference warns that a resolver shared between requests on Cloudflare Workers must be `JwksResolver.layerWith({ coalesce: false })`, and teaches `JwtKey.verificationOf` for deriving a verification key from a signing key
