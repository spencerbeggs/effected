---
"@effected/semver": minor
---

## Breaking Changes

### Comparison statics removed

The dual statics `SemVer.compare`, `SemVer.equal`, `SemVer.gt`, `SemVer.gte`, `SemVer.lt`, `SemVer.lte`, `SemVer.neq` and `Range.filter` are gone. Each one repeated an instance method, so the kit now has a single way to spell each comparison. Statics with no instance counterpart, such as `Range.satisfies`, stay dual. Closes #269.

**Migration:** call the instance method. For a data-last comparison in a pipeline, build one from `SemVer.Order` with core's `Order`:

```ts
import { SemVer } from "@effected/semver";
import { Array as Arr, Order } from "effect";

// Before: SemVer.gt(a, b), Range.filter(versions, range)
a.gt(b);
range.filter(versions);

// Before: Arr.filter(versions, SemVer.gt(floor))
Arr.filter(versions, Order.isGreaterThan(SemVer.Order)(floor));
```
