# @drivethru/contracts

The ports. Zero dependencies, zero vendor types — see
[ADR-0001](../../docs/adr/0001-ports-and-adapters.md).

```
src/common.ts     AudioFrame, CallContext, ProviderError, Provider
src/ports/        AsrProvider, LlmProvider, TtsProvider, VadProvider,
                  PosProvider, MenuSource
src/domain/       MenuSnapshot, OrderState, OrderCommand, OrderEvent
```

Two things belong here that do not exist yet (Phase 1 in
[the roadmap](../../docs/07-roadmap.md)):

**The conformance test kit.** A suite any adapter must pass before it may appear
in a profile — streaming order, cancellation mid-stream, error taxonomy, empty
input, unicode. A swap is only cheap if "does this adapter behave?" has a
mechanical answer.

**Fake providers.** Scripted ASR/LLM/TTS implementations so the orchestrator and
Order Service can be tested end to end from WAV files, with no GPU.

## Rule for anyone adding to this package

If a type here mentions a vendor — a model name, an SDK type, an endpoint shape
— it is in the wrong package. That belongs in the adapter.
