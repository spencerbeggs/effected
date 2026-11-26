---
id: "0014"
title: "effect: workflow and cluster fixes change suspension, retry and replay behaviour"
kind: behaviour
shows: behavioural
applies:
  "effect": ">=4.1.6"
detect: ["Workflow\\.|WorkflowEngine|Activity\\.|Entity\\.keepAlive|ClusterWorkflowEngine"]
---

Several `effect/workflow` and cluster fixes change what a running workflow does. Search for workflow and activity definitions and rerun their tests:

- `Activity.retry` under `Workflow.SuspendOnFailure` now sends failed attempts to the retry policy instead of suspending at once. When the policy is exhausted the workflow suspends, and `resume` replays the stored failures.
- A workflow no longer suspends on a durable wait before sibling child workflows (including discarded starts) are dispatched, and `Workflow.execute` with `{ discard: true }` is no longer interrupted before dispatch.
- A workflow that awaits its own execution fails with a defect instead of hanging.
- Shared child executions no longer leave extra waiting parents suspended (see the `MessageStorage` entry for the storage change behind it).
- Suspended replays share one workflow scope while it has no finalizers, so a finalizer or compensation registered late through an earlier run's handle now sees the final run's exit, not `Exit.void`.
- `Workflow.intoResult` captures compensation defects under `Workflow.CaptureDefects`, `Entity.keepAlive` survives a disable and immediate re-enable, and shard rebalancing no longer stalls activity waits until `entityTerminationTimeout`.
