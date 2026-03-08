import { useState, useRef } from "react";

// ── Core 16-bit simulation ──
const BITS = 16;
const M = Math.pow(2, BITS);
const HALF = M / 2;
const STEPS = 256;

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

// Params A (proven scaled from 8-bit)
const PA = { gainA:1.05, gainB:1.10, xorA:24, xorB:40, maskA:6, maskB:10 };
// Params B (different — prime-offset)
const PB = { gainA:1.07, gainB:1.12, xorA:37, xorB:71, maskA:5, maskB:11 };

function runUnit(amp, p, steps) {
  let a1A=0,a2A=0,a3A=0,a1B=0,a2B=0,a3B=0,pC=0,fb=0;
  const spikes = [];
  for (let n = 0; n < steps; n++) {
    const xA   = modN(amp);
    const na1A = maskN(p.gainA * a1A + xA,   p.maskA);
    const na2A = xorN( p.gainA * a2A + na1A, p.xorA);
    const na3A = modN( p.gainA * a3A + na2A);
    const yA   = modN(na3A + amp);
    const xB   = modN(amp);
    const na1B = maskN(p.gainB * a1B + xB,   p.maskB);
    const na2B = xorN( p.gainB * a2B + na1B, p.xorB);
    const na3B = modN( p.gainB * a3B + na2B);
    const yB   = modN(na3B + amp);
    const yC   = modN(yA + yB);
    if (isSpike(pC, yC)) spikes.push(n);
    a1A=na1A;a2A=na2A;a3A=na3A;
    a1B=na1B;a2B=na2B;a3B=na3B;
    pC=yC; fb=yC;
  }
  return { spikes, finalOut: pC };
}

function runUnitWithInput(amp, extraInput, p, steps) {
  // Option 3: cascade — amp + extraInput fed in
  let a1A=0,a2A=0,a3A=0,a1B=0,a2B=0,a3B=0,pC=0;
  const spikes = [];
  for (let n = 0; n < steps; n++) {
    const combinedAmp = modN(amp + Math.round(extraInput * 0.1));
    const xA   = modN(combinedAmp);
    const na1A = maskN(p.gainA * a1A + xA,   p.maskA);
    const na2A = xorN( p.gainA * a2A + na1A, p.xorA);
    const na3A = modN( p.gainA * a3A + na2A);
    const yA   = modN(na3A + combinedAmp);
    const xB   = modN(combinedAmp);
    const na1B = maskN(p.gainB * a1B + xB,   p.maskB);
    const na2B = xorN( p.gainB * a2B + na1B, p.xorB);
    const na3B = modN( p.gainB * a3B + na2B);
    const yB   = modN(na3B + combinedAmp);
    const yC   = modN(yA + yB);
    if (isSpike(pC, yC)) spikes.push(n);
    a1A=na1A;a2A=na2A;a3A=na3A;
    a1B=na1B;a2B=na2B;a3B=na3B;
    pC=yC;
  }
  return { spikes, finalOut: pC };
}

function toWin(spikes, steps, numWins=8) {
  const w = new Array(numWins).fill(0);
  for (const s of spikes) if (s < steps) w[Math.floor(s * numWins / steps)] = 1;
  return w.join("");
}

function toKey(spikes, steps=64) {
  const a = new Array(steps).fill(0);
  for (const s of spikes) if (s < steps) a[s] = 1;
  return a.join("");
}

// ── Three strategies ──
function strategy1_concat(amp) {
  // Concatenation: same params, count windows from both
  const rA = runUnit(amp, PA, STEPS);
  const rB = runUnit(amp, PB, STEPS);
  // 16 windows total (8+8)
  const wA = toWin(rA.spikes, STEPS, 8);
  const wB = toWin(rB.spikes, STEPS, 8);
  return { key: wA + wB, display: wA + "|" + wB };
}

function strategy2_dualparams(amp) {
  // Same amplitude, different params → two independent signatures
  const rA = runUnit(amp, PA, STEPS);
  const rB = runUnit(amp, PB, STEPS);
  const kA = toKey(rA.spikes, 48);
  const kB = toKey(rB.spikes, 48);
  return { key: kA + kB, display: toWin(rA.spikes,STEPS) + "|" + toWin(rB.spikes,STEPS) };
}

function strategy3_cascade(amp) {
  // Cascade: A output feeds into B
  const rA = runUnit(amp, PA, STEPS);
  const rB = runUnitWithInput(amp, rA.finalOut, PB, STEPS);
  const kA = toKey(rA.spikes, 48);
  const kB = toKey(rB.spikes, 48);
  return { key: kA + kB, display: toWin(rA.spikes,STEPS) + "|" + toWin(rB.spikes,STEPS) };
}

const STRATEGIES = [
  { id:1, name:"Option 1: Concatenation",    desc:"Same amp, 2 param sets, 16 windows total",    fn:strategy1_concat,    color:"#00aaff" },
  { id:2, name:"Option 2: Dual Params",      desc:"Same amp, 2 param sets, combined key (96 bit)",fn:strategy2_dualparams,color:"#ff6600" },
  { id:3, name:"Option 3: Cascade",          desc:"A output feeds into B input",                  fn:strategy3_cascade,   color:"#aa00ff" },
];

const SAMPLES = 2000;

export default function App() {
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [cur, setCur]         = useState(null);
  const [baseline, setBaseline] = useState(null);
  const stop = useRef(false);

  const ampMax = M - 1;

  const runAll = async () => {
    setRunning(true); setResults([]); stop.current = false;

    // Baseline: single 16-bit unit
    setCur("Baseline (single 16-bit)");
    await new Promise(r => setTimeout(r, 20));
    const baseMap = new Map();
    for (let i = 1; i <= SAMPLES; i++) {
      const amp = Math.round(Math.exp(Math.log(ampMax) * i / SAMPLES));
      if (amp < 1 || amp >= ampMax) continue;
      const r = runUnit(amp, PA, STEPS);
      const k = toKey(r.spikes, 48);
      if (!baseMap.has(k)) baseMap.set(k, amp);
    }
    setBaseline(baseMap.size);

    // Test each strategy
    for (const strat of STRATEGIES) {
      if (stop.current) break;
      setCur(strat.name);
      await new Promise(r => setTimeout(r, 20));

      const map = new Map();
      const examples = [];
      for (let i = 1; i <= SAMPLES; i++) {
        const amp = Math.round(Math.exp(Math.log(ampMax) * i / SAMPLES));
        if (amp < 1 || amp >= ampMax) continue;
        const { key, display } = strat.fn(amp);
        if (!map.has(key)) {
          map.set(key, amp);
          if (examples.length < 4) examples.push({ amp, display });
        }
      }

      setResults(prev => [...prev, {
        ...strat,
        count: map.size,
        examples,
        improvement: map.size / (baseMap.size || 1)
      }]);
    }

    setRunning(false); setCur(null);
  };

  const maxCount = Math.max(...results.map(r => r.count), baseline || 0, 1);

  return (
    <div style={{ fontFamily:"monospace", background:"#0a0a0a", color:"#00ff88",
                  minHeight:"100vh", padding:"20px" }}>
      <div style={{ maxWidth:740, margin:"0 auto" }}>

        <h2 style={{ fontSize:18, marginBottom:4 }}>
          Dual 16-bit Unit — 3 Combination Strategies
        </h2>
        <p style={{ color:"#555", fontSize:12, marginBottom:20 }}>
          Single 16-bit baseline vs 3 ways to combine two 16-bit units
        </p>

        <button onClick={runAll} disabled={running}
          style={{ background:running?"#333":"#00ff88", color:"#000", border:"none",
                   padding:"10px 24px", cursor:running?"not-allowed":"pointer",
                   fontFamily:"monospace", fontSize:14, fontWeight:"bold",
                   marginBottom:20 }}>
          {running ? `▶ Testing: ${cur}...` : "▶ Test All 3 Strategies"}
        </button>

        {/* Baseline */}
        {baseline !== null && (
          <div style={{ background:"#111", padding:12, marginBottom:8,
                        borderRadius:4, display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width:200, color:"#888", fontSize:13 }}>
              Baseline (single 16-bit)
            </div>
            <div style={{ flex:1, background:"#1a1a1a", height:28,
                          position:"relative", borderRadius:2 }}>
              <div style={{ background:"#ffaa00", height:"100%", borderRadius:2,
                            width:`${baseline/maxCount*100}%` }}/>
              <span style={{ position:"absolute", left:8, top:5,
                             color:"#000", fontSize:12, fontWeight:"bold" }}>
                {baseline.toLocaleString()} ops
              </span>
            </div>
            <div style={{ width:60, color:"#ffaa00", fontSize:12 }}>×1.0</div>
          </div>
        )}

        {/* Results */}
        {results.map(r => (
          <div key={r.id} style={{ background:"#111", padding:12, marginBottom:8,
                                    borderRadius:4 }}>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:8 }}>
              <div style={{ width:200, color:r.color, fontSize:13, fontWeight:"bold" }}>
                {r.name}
              </div>
              <div style={{ flex:1, background:"#1a1a1a", height:28,
                            position:"relative", borderRadius:2 }}>
                <div style={{ background:r.color, height:"100%", borderRadius:2,
                              width:`${r.count/maxCount*100}%`,
                              transition:"width 0.5s" }}/>
                <span style={{ position:"absolute", left:8, top:5,
                               color:"#000", fontSize:12, fontWeight:"bold" }}>
                  {r.count.toLocaleString()} ops
                </span>
              </div>
              <div style={{ width:60, color:r.color, fontSize:13, fontWeight:"bold" }}>
                ×{r.improvement.toFixed(1)}
              </div>
            </div>

            <div style={{ fontSize:11, color:"#555", marginBottom:6 }}>{r.desc}</div>

            {/* Example patterns */}
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {r.examples.map(({amp, display}) => (
                <div key={amp} style={{ background:"#0a0a0a", padding:"3px 8px",
                                        borderRadius:2, fontSize:10, color:"#444" }}>
                  amp={amp.toLocaleString()} [{display}]
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Winner */}
        {results.length === 3 && (
          <div style={{ marginTop:16, background:"#0a1a0a",
                        border:"1px solid #00ff88", padding:16, borderRadius:4 }}>
            <div style={{ fontSize:12, color:"#888", marginBottom:10 }}>Verdict</div>
            {(() => {
              const winner = results.reduce((a,b) => b.count > a.count ? b : a);
              const sorted = [...results].sort((a,b) => b.count - a.count);
              return (
                <>
                  <div style={{ color:"#00ff88", fontSize:15, marginBottom:8 }}>
                    🏆 Winner: {winner.name}
                  </div>
                  {sorted.map((r,i) => (
                    <div key={r.id} style={{ fontSize:13, color:r.color,
                                             marginBottom:4 }}>
                      #{i+1} {r.name.split(":")[1]}:
                      {" "}{r.count.toLocaleString()} ops
                      {" "}(×{r.improvement.toFixed(1)} vs baseline)
                    </div>
                  ))}
                  <div style={{ marginTop:10, fontSize:12, color:"#555" }}>
                    Baseline single 16-bit: {baseline?.toLocaleString()} ops
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
