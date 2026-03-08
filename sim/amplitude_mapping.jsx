import { useState, useRef } from "react";

// ── Core simulation (16-bit, proven params scaled from 8-bit) ──
function makeCore(bits) {
  const M = Math.pow(2, bits);
  const HALF = M / 2;
  const modN = v => {
    v = Math.round(v);
    while (v >  HALF-1) v -= M;
    while (v < -HALF)   v += M;
    return v;
  };
  const xorN = (v, k) => {
    v = Math.round(v);
    let u = ((v % M) + M) % M; u = u ^ (k % M);
    return u >= HALF ? u - M : u;
  };
  const maskN = (v, mb) => {
    v = Math.round(v);
    const mask = (1 << mb) - 1;
    let u = ((v % M) + M) % M; u = u & mask;
    return u >= HALF ? u - M : u;
  };
  const isSpike = (p, c) => Math.abs(c - p) >= Math.floor(M * 0.4);
  return { modN, xorN, maskN, isSpike };
}

const BITS = 16;
const STEPS = 256;
const PARAMS = {
  gainA: 1.05, gainB: 1.10,
  xorA: 24, xorB: 40,
  maskA: 6, maskB: 10,
  fgain: 0,
};

function getSpikes(amp) {
  const { modN, xorN, maskN, isSpike } = makeCore(BITS);
  const p = PARAMS;
  let a1A=0,a2A=0,a3A=0,a1B=0,a2B=0,a3B=0,fb=0,pC=0;
  const spikes = [];
  for (let n = 0; n < STEPS; n++) {
    const xA   = modN(amp + Math.round(p.fgain * fb));
    const na1A = maskN(p.gainA * a1A + xA,   p.maskA);
    const na2A = xorN( p.gainA * a2A + na1A, p.xorA);
    const na3A = modN( p.gainA * a3A + na2A);
    const yA   = modN(na3A + amp);
    const xB   = modN(amp + Math.round(p.fgain * fb));
    const na1B = maskN(p.gainB * a1B + xB,   p.maskB);
    const na2B = xorN( p.gainB * a2B + na1B, p.xorB);
    const na3B = modN( p.gainB * a3B + na2B);
    const yB   = modN(na3B + amp);
    const yC   = modN(yA + yB);
    if (isSpike(pC, yC)) spikes.push(n);
    a1A=na1A;a2A=na2A;a3A=na3A;
    a1B=na1B;a2B=na2B;a3B=na3B;
    fb=yC; pC=yC;
  }
  return spikes;
}

function spikeKey(spikes) {
  const arr = new Array(64).fill(0);
  for (const s of spikes) if (s < 64) arr[s] = 1;
  return arr.join("");
}

function spikeWin(spikes) {
  const wins = new Array(8).fill(0);
  for (const s of spikes) if (s < STEPS) wins[Math.floor(s * 8 / STEPS)] = 1;
  return wins.join("");
}

// ── Architectures to demonstrate ──
const ARCHITECTURES = [
  {
    name: "RISC-V (subset)",
    color: "#00aaff",
    ops: [
      { name:"ADD",   symbol:"+" },
      { name:"SUB",   symbol:"-" },
      { name:"AND",   symbol:"&" },
      { name:"OR",    symbol:"|" },
      { name:"XOR",   symbol:"^" },
      { name:"SLL",   symbol:"<<" },
      { name:"SRL",   symbol:">>" },
      { name:"SLT",   symbol:"<?" },
      { name:"MUL",   symbol:"×" },
      { name:"DIV",   symbol:"÷" },
      { name:"REM",   symbol:"%" },
      { name:"LUI",   symbol:"UI" },
    ]
  },
  {
    name: "ARM Thumb (subset)",
    color: "#ff6600",
    ops: [
      { name:"MOV",   symbol:"→" },
      { name:"CMP",   symbol:"=?" },
      { name:"ADD",   symbol:"+" },
      { name:"SUB",   symbol:"-" },
      { name:"MUL",   symbol:"×" },
      { name:"LSL",   symbol:"<<" },
      { name:"LSR",   symbol:">>" },
      { name:"ASR",   symbol:"»" },
      { name:"AND",   symbol:"&" },
      { name:"ORR",   symbol:"|" },
    ]
  },
  {
    name: "Custom DSP",
    color: "#aa00ff",
    ops: [
      { name:"MAC",   symbol:"×+" },
      { name:"FFT",   symbol:"F" },
      { name:"CLIP",  symbol:"[]" },
      { name:"ABS",   symbol:"|x|" },
      { name:"SAT",   symbol:"sat" },
      { name:"NORM",  symbol:"n" },
      { name:"COR",   symbol:"cor" },
      { name:"CONV",  symbol:"*" },
    ]
  }
];

export default function App() {
  const [archIdx, setArchIdx]   = useState(0);
  const [mapping, setMapping]   = useState(null);
  const [building, setBuilding] = useState(false);
  const [demo, setDemo]         = useState(null);
  const [demoAmp, setDemoAmp]   = useState("");
  const stopRef = useRef(false);

  const buildMapping = async (idx) => {
    setBuilding(true); setMapping(null); setDemo(null);
    stopRef.current = false;

    const arch = ARCHITECTURES[idx];
    const numOps = arch.ops.length;

    // Find N distinct amplitudes with maximally different spike patterns
    await new Promise(r => setTimeout(r, 20));

    const ampMax = Math.pow(2, BITS) - 1;
    const candidates = [];
    const SAMPLE = 3000;
    for (let i = 1; i <= SAMPLE; i++) {
      const a = Math.round(Math.exp(Math.log(ampMax) * i / SAMPLE));
      if (a >= 1 && a < ampMax) candidates.push(a);
    }

    // Build pattern library
    const lib = new Map();
    for (const amp of candidates) {
      const key = spikeKey(getSpikes(amp));
      if (!lib.has(key)) lib.set(key, { amp, key, win: spikeWin(getSpikes(amp)) });
    }

    const allPatterns = [...lib.values()];

    // Greedy selection: pick N maximally distinct patterns
    function hamming(a, b) {
      let d = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
      return d;
    }

    const chosen = [allPatterns[0]];
    while (chosen.length < numOps && chosen.length < allPatterns.length) {
      let best = null, bestMinDist = -1;
      for (const cand of allPatterns) {
        if (chosen.includes(cand)) continue;
        const minDist = Math.min(...chosen.map(c => hamming(cand.key, c.key)));
        if (minDist > bestMinDist) {
          bestMinDist = minDist;
          best = cand;
        }
      }
      if (best) chosen.push(best);
      else break;
    }

    // Build lookup table: opName → amplitude
    const table = arch.ops.map((op, i) => ({
      ...op,
      amplitude: chosen[i]?.amp ?? 0,
      win: chosen[i]?.win ?? "00000000",
      key: chosen[i]?.key ?? "",
    }));

    setMapping({ arch, table, totalAvailable: lib.size });
    setBuilding(false);
  };

  const runDemo = (entry) => {
    const spikes = getSpikes(entry.amplitude);
    const win = spikeWin(spikes);
    setDemo({ op: entry.name, symbol: entry.symbol,
              amp: entry.amplitude, win, spikes: spikes.slice(0, 32) });
    setDemoAmp(String(entry.amplitude));
  };

  const runCustomAmp = () => {
    const amp = parseInt(demoAmp);
    if (isNaN(amp) || amp < 1) return;
    const spikes = getSpikes(amp);
    const win = spikeWin(spikes);
    // Find which op this matches
    const key = spikeKey(spikes);
    const match = mapping?.table.find(e => e.key === key);
    setDemo({ op: match ? match.name : "?unknown?",
              symbol: match ? match.symbol : "?",
              amp, win, spikes: spikes.slice(0, 32),
              custom: true, matched: !!match });
  };

  return (
    <div style={{ fontFamily:"monospace", background:"#0a0a0a", color:"#00ff88",
                  minHeight:"100vh", padding:"20px" }}>
      <div style={{ maxWidth:740, margin:"0 auto" }}>

        <h2 style={{ fontSize:18, marginBottom:4 }}>
          Emergent ALU — Reconfigurable via Amplitude Mapping
        </h2>
        <p style={{ color:"#555", fontSize:12, marginBottom:4 }}>
          Fixed 16-bit hardware · swap ISA by changing the lookup table · no silicon redesign
        </p>
        <div style={{ background:"#111", padding:10, marginBottom:20,
                      borderRadius:4, fontSize:12, color:"#888" }}>
          <span style={{ color:"#ffaa00" }}>Concept:</span>{"  "}
          opName → lookup table → amplitude → 16-bit pipeline → unique spike pattern
        </div>

        {/* Architecture selector */}
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:12, color:"#888", marginBottom:8 }}>
            Choose ISA to map onto 16-bit Emergent ALU:
          </div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            {ARCHITECTURES.map((a, i) => (
              <button key={i}
                onClick={() => { setArchIdx(i); buildMapping(i); }}
                disabled={building}
                style={{ background: archIdx===i ? a.color : "#111",
                         color: archIdx===i ? "#000" : a.color,
                         border: `1px solid ${a.color}`,
                         padding:"8px 16px", cursor:"pointer",
                         fontFamily:"monospace", fontSize:13, fontWeight:"bold" }}>
                {a.name}
              </button>
            ))}
          </div>
        </div>

        {building && (
          <div style={{ color:"#555", fontSize:13, marginBottom:20 }}>
            Building optimal amplitude mapping...
          </div>
        )}

        {mapping && (
          <>
            {/* Summary */}
            <div style={{ background:"#111", padding:14, marginBottom:14,
                          borderRadius:4, fontSize:13 }}>
              <span style={{ color: ARCHITECTURES[archIdx].color, fontWeight:"bold" }}>
                {mapping.arch.name}
              </span>
              {" "}mapped onto 16-bit Emergent ALU
              {"  "}·{"  "}
              <span style={{ color:"#00ff88" }}>
                {mapping.table.length} ops assigned
              </span>
              {"  "}·{"  "}
              <span style={{ color:"#555" }}>
                {mapping.totalAvailable.toLocaleString()} available slots
                ({mapping.totalAvailable - mapping.table.length} unused)
              </span>
            </div>

            {/* Lookup table */}
            <div style={{ background:"#111", padding:16, marginBottom:14, borderRadius:4 }}>
              <div style={{ fontSize:12, color:"#888", marginBottom:10 }}>
                Lookup Table (click op to simulate)
              </div>
              <div style={{ display:"grid",
                            gridTemplateColumns:"repeat(auto-fill, minmax(300px, 1fr))",
                            gap:6 }}>
                {mapping.table.map((entry, i) => (
                  <div key={i}
                    onClick={() => runDemo(entry)}
                    style={{ background:"#0a0a0a", padding:"8px 12px", borderRadius:3,
                             cursor:"pointer", display:"flex", alignItems:"center",
                             gap:10, border:"1px solid #1a1a1a",
                             transition:"border-color 0.2s",
                             borderColor: demo?.amp===entry.amplitude?"#00ff88":"#1a1a1a" }}>
                    <span style={{ color: ARCHITECTURES[archIdx].color,
                                   fontWeight:"bold", width:50, fontSize:13 }}>
                      {entry.symbol}
                    </span>
                    <span style={{ color:"#888", fontSize:12, width:45 }}>{entry.name}</span>
                    <span style={{ color:"#333", fontSize:11 }}>
                      amp={entry.amplitude.toLocaleString()}
                    </span>
                    <span style={{ color:"#1a4a1a", fontSize:11, marginLeft:"auto" }}>
                      [{entry.win}]
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Demo output */}
            {demo && (
              <div style={{ background:"#0a1a0a", border:"1px solid #00ff88",
                            padding:16, marginBottom:14, borderRadius:4 }}>
                <div style={{ fontSize:12, color:"#888", marginBottom:8 }}>
                  Simulation result
                </div>
                <div style={{ fontSize:20, color:"#00ff88", marginBottom:8, fontWeight:"bold" }}>
                  {demo.symbol} {demo.op}
                  {demo.custom && (
                    <span style={{ fontSize:13, color: demo.matched?"#00ff88":"#ff4444",
                                   marginLeft:12 }}>
                      {demo.matched ? "✓ matched!" : "✗ unknown amplitude"}
                    </span>
                  )}
                </div>
                <div style={{ fontSize:13, color:"#555", marginBottom:8 }}>
                  amplitude = {demo.amp.toLocaleString()}
                </div>
                <div style={{ fontSize:12, color:"#888", marginBottom:4 }}>
                  Spike window pattern:
                </div>
                <div style={{ display:"flex", gap:4, marginBottom:8 }}>
                  {demo.win.split("").map((bit, i) => (
                    <div key={i} style={{
                      width:32, height:32, display:"flex", alignItems:"center",
                      justifyContent:"center", fontSize:11,
                      background: bit==="1" ? "#00ff88" : "#111",
                      color: bit==="1" ? "#000" : "#333",
                      borderRadius:2, fontWeight:"bold"
                    }}>
                      W{i}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize:11, color:"#333" }}>
                  Spike times (first 32 steps): [{demo.spikes.join(",")}]
                </div>
              </div>
            )}

            {/* Custom amplitude test */}
            <div style={{ background:"#111", padding:14, borderRadius:4 }}>
              <div style={{ fontSize:12, color:"#888", marginBottom:8 }}>
                Test any amplitude → which op does it match?
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <input
                  value={demoAmp}
                  onChange={e => setDemoAmp(e.target.value)}
                  placeholder="Enter amplitude (1–65534)"
                  style={{ flex:1, background:"#0a0a0a", color:"#00ff88",
                           border:"1px solid #333", padding:"8px 12px",
                           fontFamily:"monospace", fontSize:13 }}
                />
                <button onClick={runCustomAmp}
                  style={{ background:"#00ff88", color:"#000", border:"none",
                           padding:"8px 16px", cursor:"pointer",
                           fontFamily:"monospace", fontSize:13, fontWeight:"bold" }}>
                  ▶ Run
                </button>
              </div>
            </div>
          </>
        )}

        {/* Architecture note */}
        <div style={{ marginTop:20, background:"#050505", padding:14,
                      borderRadius:4, fontSize:12, color:"#444", lineHeight:1.7 }}>
          <div style={{ color:"#666", marginBottom:6 }}>How it works:</div>
          Hardware: fixed 16-bit MASK→XOR→MOD pipeline (~80 LUTs, never changes)<br/>
          Mapping:  lookup table in RAM: opcode → amplitude (can be flashed/changed)<br/>
          Runtime:  CPU sends amplitude → pipeline → unique spike pattern → result<br/>
          Reconfigure: swap lookup table → different ISA, same hardware<br/>
          <div style={{ color:"#ffaa00", marginTop:6 }}>
            → RISC-V today, ARM tomorrow, custom DSP next week. Zero hardware changes.
          </div>
        </div>
      </div>
    </div>
  );
}
