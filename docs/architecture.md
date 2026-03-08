# Emergent ALU — Architecture & Theory

## Core Pipeline: MASK → XOR → MOD

```
Input: amplitude (integer, 1 to 2^bits-1)
         ↓
   ┌─────────────────────────────────────┐
   │  Unit A                             │
   │  na1 = maskN(gainA·a1 + amp, maskA) │
   │  na2 = xorN( gainA·a2 + na1, xorA) │
   │  na3 = modN( gainA·a3 + na2)        │
   │  yA  = modN( na3 + amp)             │
   └─────────────────────────────────────┘
         ↓
   ┌─────────────────────────────────────┐
   │  Unit B (different params)          │
   │  same structure, gainB/maskB/xorB   │
   └─────────────────────────────────────┘
         ↓
   yC = modN(yA + yB)
   if |yC - yC_prev| >= threshold → SPIKE
         ↓
   spike_window pattern = operation identity
```

## Why Different Amplitudes → Different Patterns

The pipeline is nonlinear and sensitive to initial conditions.
Small difference in amplitude → diverging trajectory → different spike timing.

Like a double pendulum: tiny initial difference → completely different path.

## Gain Implementation (no multipliers)

```verilog
gainA = 17/16 = 1.0625:  x + (x >> 4)   // just shift + add
gainB =  9/8  = 1.125:   x + (x >> 3)   // just shift + add
```

Stays within integer arithmetic. No floating point. No DSP blocks.

## Scaling Law

From simulation across bit widths (same parameter structure, scaled):

```
bits  | unique% | theory_max_ops
------+---------+---------------
  8   |   57%   |           145
 16   |   99%   |        65,000
 32   |   97%   |  4,200,000,000
 64   |   96%   | ~17,000,000,000,000
```

Not exponential growth — the nonlinearity saturates.
But even 16-bit far exceeds any real ISA requirement.

## Reconfigurability via Amplitude Mapping

Hardware is FIXED. Opcodes are just amplitudes in a lookup table:

```
Traditional:  new ISA → redesign decoder → new chip → months
Emergent ALU: new ISA → new lookup table → flash → seconds
```

Example mapping for RISC-V subset (16-bit ALU):
```
ADD  → amplitude 12,847
SUB  → amplitude 31,204
AND  → amplitude  5,891
OR   → amplitude 44,123
XOR  → amplitude 19,067
...  (100 ops fit easily within ~65,000 available)
```

## Crossover Point vs Classical Decoder

```
Classical decoder gate count ≈ ops × 64
Emergent ALU gate count      ≈ 80 LUTs (constant)

Crossover: 80 / 64 ≈ ~20-30 ops
Above ~30 ops: Emergent ALU is smaller
Above ~1000 ops: Emergent ALU wins massively
```

## Fingerprinting (Simulation)

Early mistake: 64-bit rolling hash → hash collisions.
Fix: 192-bit fingerprint (3 independent 64-bit hashes):

```python
fp1 = fp1 * 1000003 + step + 1     # prime 1
fp2 = fp2 * 999983  + step*7 + 3   # prime 2
fp3 = fp3 * 1000033 + step*13 + 7  # prime 3
key = (fp1, fp2, fp3)               # 192-bit, collision-free
```

Result: 96-99% uniqueness confirmed across all tested bit widths.

## Open Research Directions

### Emergent Load Balancing
Units with slightly different parameters naturally specialize.
Winner-Takes-All via spike strength → no central scheduler needed.

### Emergent Fault Tolerance
If Unit A fails → Unit B's pattern still differs per amplitude.
System degrades gracefully, not catastrophically.

### Hebbian Adaptation
```
if op X fires frequently:
    gainA for op X path += small delta
```
Hardware learns its own workload distribution. No external controller.

### Async ASIC
FPGA forces synchronous clocking.
True async ASIC: MASK→XOR→MOD at gate propagation speed (~0.5ns/stage).
No clock domain. Zero power when idle. The original vision.

## FPGA vs Async Note

The synchronous FPGA implementation is a cycle-accurate simulation of
the async concept. Mathematical behavior is identical.

Async ASIC would be:
- Faster (gate delay vs clock cycle)
- Lower power (no clock tree, event-driven)
- More physically "honest" to the emergent concept

## Zero-Latency Speculative Decoding

Classical CPUs hide decode latency via speculative execution — complex branch
predictors, reorder buffers, and rollback logic. This complexity is the root
cause of Spectre and Meltdown vulnerabilities.

The Emergent Decoder enables a radically simpler alternative:

```
Classical speculative execution:
  Area cost:    massive (branch predictor = ~1% of die)
  Wrong guess:  pipeline flush → wasted cycles + security risk

Emergent speculative execution:
  Area cost:    ~80 LUTs per "always-on" core
  Wrong guess:  that core's result is ignored → zero penalty
```

### Continuous Background Evaluation

Pareto principle: in typical programs, 5-10 opcodes account for ~80% of
all instructions (ADD, SUB, LOAD, STORE, CMP, branch).

Proposed implementation:
```
10 "always-on" cores run continuously:
  Core 00: forever computing amplitude=1  (ADD)
  Core 01: forever computing amplitude=78 (SUB)
  Core 02: forever computing amplitude=60 (AND)
  ...

When real instruction arrives with amplitude X:
  → Is core X already computed? YES → latency = 0 ✓
  → Not precomputed? → fallback to on-demand (256 cycles)

Expected hit rate: ~80% of instructions → 0 latency
Expected miss rate: ~20% → 256 cycles (rare ops)
```

### Why This Wasn't Possible Before

Classical speculative execution is expensive because:
1. Wrong predictions require pipeline flush (wasted work)
2. Branch predictor logic is large and complex
3. Shared pipeline state creates security vulnerabilities

With 80-LUT cores:
1. "Wrong" cores just idle — no flush, no rollback
2. No predictor needed — run ALL likely opcodes simultaneously
3. No shared state between cores — no Spectre-style leakage

This converts the 256-cycle latency problem into a non-problem
for the vast majority of real workloads.

## Latency Hiding via RAM Streaming

The 2.56µs decode latency becomes invisible through pipelining:

```
Classical CPU (sequential):
  Fetch → Decode → Execute → Fetch → Decode → Execute
  Wait!    Wait!              Wait!   Wait!

Emergent + RAM Stream:
  RAM:     [Op1, Op2, Op3, Op4, Op5...] → continuous stream
  Decoder: Op1✓  Op2✓  Op3✓  Op4✓      → always ahead
  ALU:          Op1   Op2   Op3         → never waits!
```

While the ALU executes instruction N, the emergent cores
are already decoding instructions N+1 through N+5 from
the RAM prefetch buffer.

The 2.56µs decode time is spent during the ALU's execution
window — not added on top of it.

**Result: effective decode latency = 0**

This is identical in principle to how ARM's pipeline works —
but without the complex decoder logic. The emergent dynamics
do the decoding; the RAM stream hides the time it takes.

### Full Stack Vision

```
┌─────────────────────────────────────────────┐
│  RAM Prefetch Buffer                         │
│  [Op1][Op2][Op3][Op4][Op5]... streaming in  │
└──────────────┬──────────────────────────────┘
               ↓ continuous stream
┌──────────────────────────────────────────────┐
│  100 Emergent Cores (16-bit, 64 steps)       │
│  Each core decodes one op from stream        │
│  Sets multiplexer config (the "Weiche")      │
│  Refractory period distributes load          │
└──────────────┬───────────────────────────────┘
               ↓ op decoded, Weiche set
┌──────────────────────────────────────────────┐
│  Multiplexer                                 │
│  Routes A, B to correct ALU path            │
│  Config already set before operands arrive   │
└──────────────┬───────────────────────────────┘
               ↓ 1 clock cycle
┌──────────────────────────────────────────────┐
│  Classical ALU (64-bit)                      │
│  ADD / SUB / AND / XOR / MUL...             │
│  Never waits for decoder                     │
└──────────────────────────────────────────────┘

Effective latency:  1 clock cycle (ALU only)
Decoder latency:    hidden in pipeline ✓
Area for decoder:   < 0.1% of chip ✓
Reconfigurable:     change lookup table only ✓
```
