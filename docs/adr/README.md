# Architecture Decision Records

One file per decision that would be expensive to reverse. Each states the
context, the decision, what it costs, and what would make us revisit it.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-ports-and-adapters.md) | Ports and adapters for every model-shaped dependency | Accepted |
| [0002](0002-local-first-inference.md) | Local inference by default, cloud as a profile | Accepted |
| [0003](0003-streaming-pipeline.md) | Streaming, cancellable pipeline with semantic endpointing | Accepted |
| [0004](0004-order-state-machine.md) | The LLM proposes; a deterministic state machine disposes | Accepted |
| [0005](0005-config-driven-profiles.md) | Provider wiring is config, not code | Accepted |
| [0006](0006-typescript-bun.md) | TypeScript on Bun for the orchestration tier | Accepted |
