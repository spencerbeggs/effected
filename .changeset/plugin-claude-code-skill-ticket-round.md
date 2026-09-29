---
"@effected/claude-code-plugin": patch
---

## Documentation

* The Actions skills read `isDebug` as a member of the `ActionEnvironment` service and teach that `Action.run` lowers the log level under step debugging, so hand-wired log-level wrappers are deleted.
* The output-contracts example annotates the inner `Schema.Struct` of a `Schema.Class`, and the schemastore skills state that an undeclared `x-*` annotation on a node is dropped silently while one passed through `rootAnnotations` or `includeAnnotationKey` fails the build.
* The action canon places `schemastore.config.ts` in `lib/scripts/` with the path passed explicitly; bootstrapping-an-action covers removing the structured output, the schema identity in its rename list, and shipping `published: false` until first release.
