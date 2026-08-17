---
"@effected/spdx": minor
---

## Features

`SpdxExpression` now accepts `WITH` exceptions on a `LicenseRef`/`DocumentRef` reference, matching the SPDX ABNF's `simple-expression` production. `LicenseRef-Foo WITH Bison-exception-2.2` and `DocumentRef-tool-1.2:LicenseRef-Foo WITH Bison-exception-2.2` now parse instead of being rejected.

```ts
import { SpdxExpression, WithExceptionNode, LicenseRefNode } from "@effected/spdx";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const expr = yield* SpdxExpression.parse("LicenseRef-Foo WITH Bison-exception-2.2");
  return expr instanceof WithExceptionNode && expr.license instanceof LicenseRefNode;
});

console.log(Effect.runSync(program));
// => true
```

`WithExceptionNode.license` is now typed as `LicenseNode | LicenseRefNode` to reflect the widened grammar. The exception must still be a cataloged SPDX exception id, and `LicenseRef-Foo+` (a `+` on a reference) is still rejected.
