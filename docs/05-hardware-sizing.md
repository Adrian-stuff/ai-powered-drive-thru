# 05 — Hardware & Model Sizing

## The store box

One machine per restaurant, sized for two lanes concurrently with headroom for
a model upgrade. Fanless where the install is in a hot ceiling space.

| Component | Spec | Why |
| --- | --- | --- |
| GPU | 16 GB VRAM — RTX 4000 Ada SFF (70 W) or RTX 2000 Ada | 8B LLM int8 (~9 GB) + Whisper turbo (~2 GB) + TTS (~1 GB) with room to grow |
| CPU | 8-core x86 (i5-13500T class) | Audio DSP, AEC, and the runtime; not the bottleneck |
| RAM | 32 GB | Catalog, session store, buffers |
| Storage | 1 TB NVMe | Models, telemetry buffer, retained eval audio |
| Network | 2× GbE | One to POS VLAN, one to lane hardware |
| Power | UPS, 15 min | Ride out brownouts without a cold model load |

Budget roughly $2.5–3.5k per store. Against ~$0.45/order of headset labor at
400 orders/day, payback is measured in weeks, not years — which is the entire
business case and should be re-checked with the franchisee's real numbers before
anyone buys hardware.

**Jetson Orin AGX 64 GB** is the alternative for tight thermal or space
constraints: lower power, fanless, but a smaller software ecosystem and slower
prefill. Prefer x86 + discrete GPU where the space allows.

## Model choices

These are v1 starting points, not commitments. Everything below is behind a
port precisely because this table will look dated within a year.

### ASR

| Option | Why | Why not |
| --- | --- | --- |
| **faster-whisper large-v3-turbo, int8** *(default)* | Strong accented/noisy accuracy, ~2 GB, well-understood | No native streaming; needs chunked pseudo-streaming |
| NVIDIA Parakeet TDT 0.6B | Genuinely streaming, very fast on NVIDIA | English-only, weaker on heavy accents |
| distil-whisper large-v3 | ~2× faster than full Whisper | Small accuracy loss on short utterances, which is exactly our case |

Evaluate on *drive-thru audio*, not LibriSpeech. Road noise, wind, bass-heavy
car stereos, and children in the back seat are the actual test set, and WER on
clean read speech predicts almost nothing here.

### LLM

| Option | Why | Why not |
| --- | --- | --- |
| **Qwen3-8B-Instruct, int8** *(default)* | Excellent tool-calling for its size, fits comfortably | — |
| Llama 3.1 8B Instruct | Mature tooling, broad support | Slightly weaker structured output |
| Qwen3-4B | ~2× faster, viable on smaller GPUs | Needs a tighter prompt and more fast-path coverage |
| Cloud (Claude / GPT / Gemini) | Best reasoning on weird orders | Latency, cost, and a WAN dependency |

Serve with **vLLM** (best throughput and prefix caching) or **llama.cpp**
(simplest ops, good enough at one concurrent request). Both speak the
OpenAI-compatible wire format, so the adapter is the same either way.

### TTS

| Option | Why | Why not |
| --- | --- | --- |
| **Piper** *(default)* | ~50 ms first audio, tiny, CPU-only | Flat prosody; audibly synthetic |
| Kokoro-82M | Much better prosody, still fast | ~1 GB VRAM, newer and less proven |
| Cloud (Cartesia / ElevenLabs) | Best quality, voice cloning for brand | Latency and per-character cost |

Brand voice matters more than engineers expect — the franchise will have
opinions about the persona, and "sounds like a robot" is a real objection from
customers. Budget a cloud TTS profile for chains that care, and note that TTS
is the easiest component to upgrade later because nothing depends on it.

### VAD

Silero VAD. Small, CPU, well-proven. The semantic endpointing classifier on top
is ours: a distilled model over ASR partials plus prosody. That classifier is
the single highest-leverage piece of custom ML in the system, and the one thing
here genuinely worth building rather than buying.

## Concurrency

One lane is one session: one ASR stream, at most one in-flight LLM request, one
TTS stream. Two lanes plus a speculative prefill peaks at four concurrent model
calls — comfortable on 16 GB. Queue rather than degrade: a 100 ms wait beats
swapping a model out of VRAM.
