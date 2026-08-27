# Service-design rules that decide module shape

Three rules the SKILL body states in one line each. They are here because each
one is a *design* decision — it settles where a symbol lives, not how a call is
spelled — and each was derived from first principles more than once before it
was written down.

## 1. The value-only service: the bounded exception to "no non-effectful members"

The house rule is **no non-effectful members on a service shape**, because
`Layer.mock` takes `PartialEffectful<S>` and one plain member makes *every*
member required (`Layer.ts:2230` at rc.109). That rule targets **mixed**
shapes: methods plus a stray pure helper, where the helper revokes the
optionality the methods were relying on.

A shape that is **entirely one immutable value** is not that case. Consider a
service whose whole contract is a resolved record — the runner's environment,
a set of discovered paths, a decoded config:

```ts
class ActionEnvironment extends Context.Service<ActionEnvironment, {
 readonly workspace: string;
 readonly runnerOs: "Linux" | "Windows" | "macOS";
}>()("@effected/github-actions/ActionEnvironment") {}
```

There is no behaviour here to mock, so nothing degrades. `Layer.succeed` is not
a fallback for it — it is the correct and complete double, in tests and in
production. `Layer.mock` was never the tool for this shape, so losing its
optionality costs nothing.

**The criterion, stated so it can be applied rather than pattern-matched:** *the
entire shape is one immutable value with no mockable behaviour.* Not "mostly
data". Not "the methods are trivial". Entirely.

**And the boundary is sharp: the moment a method appears, it is a service
again.** One effect-returning member and the shape is mixed — the pure fields
now revoke that member's `Layer.mock` optionality, and the original rule
reapplies to the whole shape, retroactively. So a value-only service is a
standing invitation to a future defect: whoever adds the first method must also
move the data off, or accept `Layer.mock` degrading everywhere. Say so in the
service's TSDoc when you declare one.

## 2. A layer static belongs to the module that owns the dependency

The reflex is that `Svc.layer` lives on `Svc`. That is right when the layer's
dependencies are already the service module's dependencies. It is **wrong** the
moment a layer variant needs something the service's own module must not reach —
because **statics on one class share one module**, and a module is the unit of
reachability for a bundler.

> A layer-family static belongs to the module that **owns the dependency it
> needs**, not to the module that **declares the service**.

Three uses in this kit, each with the confinement it buys:

| Static | Declared in | Confines |
| --- | --- | --- |
| `GitHubApp.clientLayer` | `@effected/github`'s `GitHubApp.ts` | the JWT signer. A third static on `GitHubClient` would make every token-only consumer link it. |
| `Workspaces.localExecLayer` | `@effected/workspaces` | builds `@effected/commands`' `LocalExec` service, so `commands` keeps zero `@effected/*` edges. |
| `GitHubCacheBlobStore.layer` | `@effected/github-actions`'s `BlobStore.githubCache.ts` | `@azure/storage-blob`. `BlobStore.layerGitHubCache` would make it reachable from every module that reads a blob. |

The naming follows the same logic: the static is named for the **variant** it
builds (`clientLayer`, `localExecLayer`), because it is no longer *the* layer of
the class it hangs on.

The test for whether you are in this case: *would putting this static on the
service class make a dependency reachable from a consumer that does not use it?*
If yes, move the static — the tree-shaking invariant then holds structurally
rather than by convention, which is the only way it survives a refactor.

## 3. Swappable contracts: no ambient default, and ship values as well as layers

A **swappable contract** is a service whose implementation is a *policy choice* —
the consumer is meant to pick, and picking wrong is a correctness failure, not a
performance one. Two rules, both learned the expensive way on
`@effected/workspaces`' `PublishabilityDetector` (the service that decides
whether a package publishes, and to which registry).

### 3a. No ambient default in a composite

Do **not** merge a default implementation into the package's composite layer.
Leave the requirement in `R` and make the consumer provide it.

The safety argument is that `Layer.mergeAll` is **last-wins**, so the natural
spelling of an override loses to a default in complete silence:

```ts
// With PublishabilityDetector merged into Workspaces.layer():
Layer.mergeAll(myDetector, Workspaces.layer())   // ← the DEFAULT wins. Compiles. Runs. Wrong.
```

No type error, no warning; the consumer's explicit policy is discarded by merge
order. For a service whose default answer is "publishes to the public registry",
that silent revert is the worst failure available.

The ergonomic argument points the same way: with the requirement in `R`, wiring
that forgets to choose **does not compile**, and consumers who never call the
operation never have to supply a policy at all — the requirement surfaces in the
consuming operation's `R`, not in the package's.

`@effected/workspaces` ships exactly this: `PublishabilityDetector` is
deliberately absent from `Workspaces.layer`, and the common case is one explicit
`Layer.provide(PublishabilityDetector.layerNpm)`.

### 3b. Ship every implementation as a VALUE, not only as a layer

For each implementation, export the **shape value** and derive the layer from
it:

```ts
static readonly npm: PublishabilityDetectorShape = { detect: (pkg) => … };
static readonly none: PublishabilityDetectorShape = { detect: () => Effect.succeed([]) };

static readonly layerNpm: Layer.Layer<PublishabilityDetector> = Layer.succeed(this, this.npm);
static readonly layerNone: Layer.Layer<PublishabilityDetector> = Layer.succeed(this, this.none);
```

The layer-only form quietly forbids the most common real composition: a consumer
who wants to *wrap* or *extend* the default — "npm semantics, except this one
package is internal" — cannot use a layer without re-entering the tag it is
trying to replace. Given the value, that consumer writes

```ts
Layer.succeed(PublishabilityDetector, {
 detect: (pkg) => isInternal(pkg) ? Effect.succeed([]) : PublishabilityDetector.npm.detect(pkg),
});
```

with no wrapping ceremony. Naming convention: the value carries the policy name
(`npm`, `none`), the layer is `layer<PolicyName>` — never a bare `layer`, which
would imply a default the contract deliberately does not have.
