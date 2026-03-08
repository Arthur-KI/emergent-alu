# Emergent Instruction Decoder

**First hardware demonstration of opcode classification without a decoder circuit.**

![ULX3S Hardware Proof](results/hardware_demo.jpg)
*8 distinct operations — 8 distinct LED patterns — no decoder logic. ULX3S 85K, March 8, 2026.*

> *"The decoder is not missing. It never needed to exist."*

---

## Quickstart (5 minutes to reproduce)

```
1. Open IceStudio → select board: ULX3S-85F
2. Add blocks: CLOCK(clk_25mhz)  BTN(btn_0)  CODE  8×LED(led_0..led_7)
3. Paste rtl/emergent_alu_icestudio.v into the CODE block
4. Connect: clk_25mhz + btn_0 → led_0..led_7
5. Werkzeuge → Bauen → Hochladen
6. Watch 8 operations produce 8 different LED patterns
   btn_0 = reset to Op 0
```

If the LEDs blink differently for each operation → you've reproduced it. ✓

---

## What is this?

A conventional CPU decodes instructions like this:
```
opcode → Decoder (20-30% of chip area) → "this is ADD" → ALU
```

This project does it like this:
```
amplitude → MASK → XOR → MOD → unique spike pattern → "this is ADD"
            ↑
            No decoder. No if-then. No instruction register.
            3 operations. 80 LUTs. That's it.
```

Different amplitudes produce **different spike-timing patterns** — not because
they were programmed to, but because the nonlinear dynamics of the pipeline
make it happen naturally.

This is formally a **Reservoir Computer**: the pipeline is the reservoir,
amplitude is the input, spike patterns are reservoir states, and the
amplitude lookup table is the readout. The reservoir never needs training.

**Proven on real silicon. March 8, 2026.**

---

## Key Results

| Metric | Result |
|--------|--------|
| Hardware platform | ULX3S 85K (Lattice ECP5 LFE5U-85F) |
| Opcode recognition | **8/8 correct (100%)** |
| LUT usage | **~80 / 84,000 (< 0.1%)** |
| Distinct opcodes @ 16-bit | ~65,000 (99% unique) |
| Distinct opcodes @ 32-bit | ~4.2 billion (97% unique) |
| 100-core mesh LUT usage | ~10,400 / 84,000 (12%) |
| Parallel ops (100 cores) | **89 simultaneously** |

---

## How It Works

### The MASK→XOR→MOD Pipeline

Three operations, applied iteratively for 256 steps:

```
Stage 1 — maskN:  gain·x  AND  maskA   → filters low bits
Stage 2 — xorN:   gain·x  XOR  xorA   → nonlinear mixing  
Stage 3 — modN:   gain·x  MOD  2^bits  → signal wrapping
```

Two parallel units (A and B) with different parameters run simultaneously.
A **spike** is recorded whenever their combined output jumps by more than
a threshold. After 256 steps, the spike-timing pattern uniquely identifies
the input amplitude — and therefore the operation.

### Why It Works: Attractors

Each amplitude falls into a **different attractor** in the pipeline's phase
space. 256 iterations = transient leading to that attractor. Different
amplitudes → different attractors → different spike patterns.

### Gain — no multipliers needed
```verilog
gainA = 17/16:  x + (x >> 4)   // 2 LUTs, zero DSP blocks
gainB =  9/8:   x + (x >> 3)   // 2 LUTs, zero DSP blocks
```

### Proven 8-bit Parameters
```
gainA = 17/16   gainB = 9/8
xorA  = 12      xorB  = 20
maskA = 0x07    maskB = 0x1F
threshold = 77
```

### Opcode Table (8 ops, all distinct ✓)
```
Op 0 → amplitude  1      Op 4 → amplitude 15
Op 1 → amplitude 78      Op 5 → amplitude 17
Op 2 → amplitude 60      Op 6 → amplitude 82
Op 3 → amplitude 83      Op 7 → amplitude 74
```

To add a new opcode: pick a new amplitude, add it to the table. No hardware changes.

---

## Hardware Proof

| Op | Amplitude | LEDs lit    | Spike signature |
|----|-----------|-------------|-----------------|
| 0  | 1         | D4+D5       | Middle windows |
| 1  | 78        | D0+D1       | Early spikes only |
| 2  | 60        | D1 only     | Minimal signature |
| 3  | 83        | D0+D1+D6+D7 | Two separate clusters |
| 4  | 15        | D3+D4+D5    | Center-weighted |
| 5  | 17        | D3+D4       | Near-center |
| 6  | 82        | D1+D2       | Early-mid |
| 7  | 74        | D0+D1+D2    | Three-LED sweep |

Resource usage: **~80 LUTs. No DSP. No BRAM. No PLL.**

---

## Scaling

```
8-bit:   ~145 ops   (57% unique)   ← hardware proven ✓
16-bit:  ~65,000    (99% unique)   ← simulated
32-bit:  ~4.2B      (97% unique)   ← simulated  
64-bit:  ~17T       (96% unique)   ← simulated
```

Hardware is **identical** at all bit widths. Same 80 LUTs. Different data path width.

### vs Classical Decoder

| Ops | Classical | Emergent | Winner |
|-----|-----------|----------|--------|
| 8   | ~500 gates | ~80 LUTs | classical |
| 100 | ~6,000 gates | ~80 LUTs | **emergent** |
| 1,000 | ~60,000 gates | ~80 LUTs | **emergent** |
| any | redesign chip | update table | **emergent** |

Crossover: **~20-30 ops.** RISC-V has 100. x86 has 1,000.

---

## 100-Core Parallel Mesh

100 cores with varied parameters fit in **12% of the ULX3S**.
A biologically-inspired **Refractory Period** (winner rests for R cycles)
distributes load across all cores — no central scheduler needed:

| Refractory R | Active Cores | Imbalance | Idle Ops |
|-------------|-------------|-----------|----------|
| 0 (pure WTA) | 80/100 | 248% | 0 |
| 8  | 84/100 | 112% | 0 |
| 16 | **89/100** | **89%** | **0** |

**89 operations decode in parallel** after a single 10µs window.
Like a freight train vs a sports car: higher latency per trip,
but 89 results arrive simultaneously instead of one by one.

```
100 cores × ~84 LUTs + refractory counters ≈ 10,400 LUTs = 12% of ULX3S
```

---

## What It Can and Cannot Do

**✓ Does:**
- Classify which operation an amplitude represents
- Replace the instruction decoder (most area-intensive CPU component)
- Scale to any ISA by updating the amplitude table only
- Distribute 89 ops in parallel with no scheduler
- Fit 100-core mesh in < 15% of a ~€150 FPGA board

**✗ Does not:**
- Compute exact arithmetic results

`reservoir(ADD, 5, 3)` does NOT output `8`. The reservoir output is a
deterministic but chaotic hash — precise classification, not calculation.

The correct architecture is:
```
Emergent Decoder  →  identifies the operation  →  Classical ALU  →  result
```
The emergent decoder replaces the most expensive component. The ALU stays classical.

> **Honest failure note:** We tested whether a linear readout could recover
> exact arithmetic from reservoir states alone. An initial 100% accuracy result
> was identified as **data leakage** (operand values accidentally included as
> features). Removing them collapsed accuracy to 0–6%. The chaos wins.
> This confirms the system's role: classifier, not calculator.

---

## ⚠️ Sync vs Async

The conceptual model is **asynchronous** — data propagates through MASK→XOR→MOD
at gate speed (~0.5ns/stage), no clock required.

The FPGA implementation is **synchronous** because Lattice ECP5 FPGAs require
clocked logic. The synchronous version is a cycle-accurate emulation of the
async concept — mathematically identical behavior.

An async ASIC implementation (the original vision) remains a future goal.

---

## Speed

```
FPGA @ 25MHz:  256 cycles = 10.2µs per op
ASIC @ 1GHz:   256 cycles = 256ns per op   (~850× slower than modern CPU)

Single op:   slower than CPU
Batch of 89: same total time as CPU doing 89 ops sequentially
```

Speed is not the goal. **Minimal area + ISA flexibility are.**

---

## Repository Structure

```
emergent-alu/
├── README.md
├── LICENSE_MIT              ← sim / software  
├── LICENSE_CERN_OHL         ← hardware files
├── rtl/
│   ├── emergent_alu_icestudio.v   ← IceStudio (no module wrapper)
│   └── emergent_alu_ulx3s.v      ← full Verilog module
├── sim/
│   ├── emergent_8bit.jsx          ← 8-bit interactive simulator
│   ├── emergent_16bit.jsx         ← 16-bit simulator
│   ├── cascade_2to32.jsx          ← cascade scaling
│   ├── amplitude_mapping.jsx      ← reconfigurable ISA demo
│   └── dual_unit_test.jsx         ← dual-unit comparison
├── results/
│   └── hardware_results.md        ← measured LED patterns
└── docs/
    └── architecture.md            ← theory, scaling, open questions
```

---

## Relation to Existing Work

| Field | Similarity | Key Difference |
|-------|-----------|----------------|
| Reservoir Computing | Fixed nonlinear dynamics | No training, no readout weights — pattern IS the opcode |
| Neuromorphic (Loihi, TrueNorth) | Spike-based signaling | No neural network, no synaptic weights |
| Content-Addressable Memory | Pattern → identity | Emergent, not stored |
| FPGA partial reconfiguration | Runtime flexibility | No bitstream change needed |

---

## Open Research Questions

1. **Zero-Latency Speculative Decoding** — since each core uses < 0.1% FPGA fabric,
   dedicate a subset of cores to permanently pre-calculate the most common opcodes
   (ADD, SUB, CMP, LOAD). When the instruction arrives, the result is already ready:
   classification latency drops from 256 cycles → 0. No branch predictor tables,
   no rollback logic, no Spectre/Meltdown-style attack surface.
   Classical speculative execution is complex because it is expensive to be wrong.
   Here, being wrong costs nothing — just 80 LUTs idling for one window.

2. Is 96–99% amplitude uniqueness a fundamental property or parameter-dependent?
2. Emergent fault tolerance — does classification hold when one core fails?
3. Hebbian adaptation — can per-path gain updates optimize for observed workload?
4. Async ASIC — gate-propagation-speed, no clock, near-zero idle power
5. 16-bit hardware validation — simulation results await FPGA confirmation
6. PUF application — fabrication variations make each chip's signatures unique

---

## GitHub Topics

```
fpga  neuromorphic-computing  verilog  reservoir-computing
hardware-architecture  open-source-hardware  ulx3s
instruction-decoder  ecp5  icestudio
```

---

## Citation

```
Emergent Instruction Decoder — Opcode-Free Computing on FPGA
First hardware demonstration: March 8, 2026
ULX3S 85K (Lattice ECP5 LFE5U-85F)
https://github.com/[your-username]/emergent-alu
```

---

## License

- `sim/` — **MIT License**
- `rtl/` — **CERN Open Hardware Licence v2 - Permissive**

---

*"The decoder is not missing. It never needed to exist."*
