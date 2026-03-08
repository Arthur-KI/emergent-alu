import { useState, useEffect, useRef, useMemo } from "react";

// ── 8-Bit Konfiguration ───────────────────────────────────────
const BITS = 8;
const M = Math.pow(2, BITS);        // 256
const HALF = M / 2;                 // 128
const STEPS = 128;
const PAT_LEN = 128;                // Geminis Tipp: größer bei 8-Bit!

// ── Kern (8-Bit) ──────────────────────────────────────────────
const modN = v => {
  v = Math.round(v);
  while (v >  HALF-1) v -= M;
  while (v < -HALF)   v += M;
  return v;
};
const xorN = (v,k) => {
  v=Math.round(v);
  let u=((v%M)+M)%M; u=u^(k%M);
  return u>=HALF?u-M:u;
};
const maskN = (v,mb) => {
  v=Math.round(v);
  const mask=(1<<mb)-1;
  let u=((v%M)+M)%M; u=u&mask;
  return u>=HALF?u-M:u;
};
const isSpike = (p,c) => Math.abs(c-p) >= Math.floor(M*0.4); // 8-Bit: niedrigerer Threshold

function getSpikes(amp, p) {
  let a1A=0,a2A=0,a3A=0, a1B=0,a2B=0,a3B=0, fb=0, pC=0;
  const spikes=[];
  for(let n=0;n<STEPS;n++){
    const xA=modN(amp+Math.round(p.fgain*fb));
    const na1A=maskN(p.gainA*a1A+xA, p.maskA);
    const na2A=xorN(p.gainA*a2A+na1A, p.xorA);
    const na3A=modN(p.gainA*a3A+na2A);
    const yA=modN(na3A+amp);
    const xB=modN(amp+Math.round(p.fgain*fb));
    const na1B=maskN(p.gainB*a1B+xB, p.maskB);
    const na2B=xorN(p.gainB*a2B+na1B, p.xorB);
    const na3B=modN(p.gainB*a3B+na2B);
    const yB=modN(na3B+amp);
    const yC=modN(yA+yB);
    if(isSpike(pC,yC) && n<PAT_LEN) spikes.push(n);
    a1A=na1A;a2A=na2A;a3A=na3A;
    a1B=na1B;a2B=na2B;a3B=na3B;
    fb=yC; pC=yC;
  }
  return spikes;
}

function spikePat(spikes){
  const p=Array(PAT_LEN).fill(0);
  spikes.forEach(t=>{if(t<PAT_LEN)p[t]=1;});
  return p;
}
function sim(a,b){ return 1-a.reduce((s,v,i)=>s+(v!==b[i]?1:0),0)/a.length; }

// ── 8 Operationen ─────────────────────────────────────────────
// Carry-Flag: Geminis Tipp! Overflow wird getrackt
function addWithCarry(a,b) {
  const raw = a + b;
  const result = modN(raw);
  const carry = (raw > HALF-1 || raw < -HALF) ? 1 : 0;
  return {result, carry};
}

const OPS = [
  { name:"ADD",    symbol:"+",   color:"#ff8060",
    fn:(a,b,c)=>{ const r=addWithCarry(a,b); return {result:r.result,carry:r.carry,flags:`C=${r.carry}`}; },
    desc:"a + b → carry" },
  { name:"SUB",    symbol:"−",   color:"#ff6090",
    fn:(a,b,c)=>{ const r=addWithCarry(a,-b); return {result:r.result,carry:r.carry,flags:`C=${r.carry}`}; },
    desc:"a − b → carry" },
  { name:"XOR",    symbol:"⊕",   color:"#60c8ff",
    fn:(a,b,c)=>{ const ua=((a%M)+M)%M,ub=((b%M)+M)%M,r=ua^ub; return {result:r>=HALF?r-M:r,carry:c,flags:""}; },
    desc:"a ⊕ b" },
  { name:"AND",    symbol:"∧",   color:"#b8ff60",
    fn:(a,b,c)=>{ const ua=((a%M)+M)%M,ub=((b%M)+M)%M,r=ua&ub; return {result:r>=HALF?r-M:r,carry:c,flags:""}; },
    desc:"a ∧ b" },
  { name:"OR",     symbol:"∨",   color:"#60ffd0",
    fn:(a,b,c)=>{ const ua=((a%M)+M)%M,ub=((b%M)+M)%M,r=ua|ub; return {result:r>=HALF?r-M:r,carry:c,flags:""}; },
    desc:"a ∨ b" },
  { name:"SHL",    symbol:"≪",   color:"#c8a0ff",
    fn:(a,b,c)=>{ const sh=Math.abs(b)%8; const raw=((a%M)+M)%M<<sh; const r=modN(raw); return {result:r,carry:raw>255?1:0,flags:`C=${raw>255?1:0}`}; },
    desc:"a ≪ (b%8)" },
  { name:"SHR",    symbol:"≫",   color:"#ffcc60",
    fn:(a,b,c)=>{ const sh=Math.abs(b)%8; const ua=((a%M)+M)%M; const r=ua>>sh; return {result:r,carry:c,flags:""}; },
    desc:"a ≫ (b%8)" },
  { name:"ADC",    symbol:"+C",  color:"#ff9030",
    fn:(a,b,c)=>{ const r=addWithCarry(a,b+c); return {result:r.result,carry:r.carry,flags:`C=${r.carry}`}; },
    desc:"a + b + Carry" },
];
const NUM_OPS = OPS.length;

// ── Optimierer ────────────────────────────────────────────────
function optimizeOps() {
  // 8-Bit: opCodes aus breiterer Range [1..30]
  const CANDIDATE_AMPS = [1,3,5,8,12,16,20,24,28,32,40,50,64,80,100,120];
  const params_space = [
    {gainA:1.07,gainB:1.15,xorA:9,  xorB:15, maskA:3,maskB:4,fgain:0.2},
    {gainA:1.05,gainB:1.10,xorA:50, xorB:120,maskA:4,maskB:5,fgain:0.1},
    {gainA:1.10,gainB:1.12,xorA:85, xorB:42, maskA:3,maskB:6,fgain:0.3},
    {gainA:1.07,gainB:1.07,xorA:170,xorB:85, maskA:5,maskB:5,fgain:0.0},
    {gainA:1.12,gainB:1.05,xorA:33, xorB:99, maskA:4,maskB:4,fgain:0.2},
    {gainA:1.15,gainB:1.10,xorA:60, xorB:200,maskA:6,maskB:3,fgain:0.1},
  ];

  let globalBest=null, globalScore=-1;

  for(const p of params_space){
    // Alle Muster berechnen
    const allPats={};
    for(const a of CANDIDATE_AMPS){
      const sp=getSpikes(a,p);
      allPats[a]={pat:spikePat(sp), count:sp.length, spikes:sp};
    }

    // 8 aus CANDIDATE_AMPS wählen (optimale Kombination)
    // Zu viele Kombinationen für vollständige Suche → greedy Ansatz
    // Starte mit bester Basis, füge iterativ am trennbarsten hinzu
    const valid=CANDIDATE_AMPS.filter(a=>allPats[a].count>=5);
    if(valid.length<NUM_OPS) continue;

    // Greedy: immer den Amp hinzufügen der am weitesten von allen bisherigen entfernt ist
    let chosen=[valid[0]];
    while(chosen.length<NUM_OPS && chosen.length<valid.length){
      let bestAmp=-1, bestMinSim=1;
      for(const a of valid){
        if(chosen.includes(a)) continue;
        const minS=Math.min(...chosen.map(c=>sim(allPats[a].pat,allPats[c].pat)));
        if(minS<bestMinSim){bestMinSim=minS;bestAmp=a;}
      }
      if(bestAmp<0) break;
      chosen.push(bestAmp);
    }
    if(chosen.length<NUM_OPS) continue;

    const pats=chosen.map(a=>allPats[a].pat);
    let minSim=1,sumSim=0,pairs=0;
    for(let i=0;i<NUM_OPS;i++)
      for(let j=i+1;j<NUM_OPS;j++){
        const s=sim(pats[i],pats[j]);
        if(s<minSim)minSim=s;
        sumSim+=s;pairs++;
      }
    const avgSim=sumSim/pairs;
    const score=(1-minSim)*0.6+(1-avgSim)*0.4;

    if(score>globalScore){
      globalScore=score;
      globalBest={
        params:p, chosen,
        pats, minSim, avgSim, score,
        spikeCounts:chosen.map(a=>allPats[a].count),
        allSpikes:chosen.map(a=>allPats[a].spikes)
      };
    }
  }
  return globalBest;
}

// ── Raster ────────────────────────────────────────────────────
function Raster({spikes,color,w=200,h=20}) {
  const ref=useRef();
  useEffect(()=>{
    const c=ref.current; if(!c) return;
    const ctx=c.getContext("2d");
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle="rgba(255,255,255,0.02)"; ctx.fillRect(0,0,w,h);
    spikes.forEach(t=>{
      if(t>=PAT_LEN)return;
      const x=1+(t/(PAT_LEN-1))*(w-2);
      ctx.strokeStyle=color; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(x,1); ctx.lineTo(x,h-1); ctx.stroke();
    });
  },[spikes,color,w,h]);
  return <canvas ref={ref} width={w} height={h} style={{width:w,height:h}}/>;
}

// ── Matrix ────────────────────────────────────────────────────
function SimMatrix8({pats,opcodes,colors}) {
  const n=NUM_OPS;
  const cell=32, off=22, W=off+n*cell+4, H=off+n*cell+4;
  const ref=useRef();
  useEffect(()=>{
    const c=ref.current; if(!c) return;
    const ctx=c.getContext("2d");
    ctx.clearRect(0,0,W,H);
    for(let i=0;i<n;i++){
      for(let j=0;j<n;j++){
        const s=i===j?1:sim(pats[i],pats[j]);
        ctx.fillStyle=i===j
          ?"rgba(255,255,255,0.12)"
          :`rgba(${Math.round(255*(1-s))},${Math.round(200*s)},80,${0.3+s*0.6})`;
        ctx.fillRect(off+j*cell+1,off+i*cell+1,cell-2,cell-2);
        ctx.fillStyle="rgba(255,255,255,0.8)";
        ctx.font=`${i===j?8:7}px 'Courier New'`;
        ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.fillText(i===j?`${opcodes[i]}`:`${Math.round(s*100)}%`,
          off+j*cell+cell/2, off+i*cell+cell/2);
      }
      ctx.fillStyle=colors[i]; ctx.font="7px 'Courier New'";
      ctx.textAlign="center"; ctx.textBaseline="middle";
      ctx.fillText(opcodes[i],off+i*cell+cell/2,11);
      ctx.fillText(opcodes[i],11,off+i*cell+cell/2);
    }
    ctx.textAlign="left"; ctx.textBaseline="alphabetic";
  },[pats,opcodes,colors]);
  return <canvas ref={ref} width={W} height={H} style={{width:W,height:H}}/>;
}

// ── Dataflow Step ─────────────────────────────────────────────
function DataflowStep({step,isLast}) {
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",
        background:`${step.op.color}0a`,borderLeft:`3px solid ${step.op.color}`}}>
        <div style={{width:30,height:30,borderRadius:6,background:step.op.color,
          display:"flex",alignItems:"center",justifyContent:"center",
          fontSize:14,color:"#07080c",fontWeight:"bold",flexShrink:0}}>
          {step.op.symbol}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:2}}>
            <span style={{fontSize:10,color:step.op.color,fontWeight:"bold"}}>{step.op.name}</span>
            <span style={{fontSize:8,color:"rgba(255,255,255,0.3)"}}>
              opcode={step.opCode} · {Math.round(step.similarity*100)}%
              {step.similarity>=0.99&&<span style={{color:"#b8ff60"}}> ✓</span>}
            </span>
            {step.carry!==undefined&&step.carry!==null&&(
              <span style={{fontSize:8,padding:"1px 5px",borderRadius:3,
                background:step.carry?"rgba(255,180,96,0.2)":"rgba(255,255,255,0.05)",
                color:step.carry?"#ffcc60":"rgba(255,255,255,0.3)"}}>
                Carry={step.carry} {step.carry?"⚑":""}
              </span>
            )}
          </div>
          <Raster spikes={step.spikes} color={step.op.color} w={160}/>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:7,color:"rgba(255,255,255,0.3)"}}>acc</div>
            <div style={{fontSize:18,color:"rgba(255,255,255,0.6)",fontFamily:"monospace",fontWeight:"bold"}}>{step.input}</div>
          </div>
          <span style={{fontSize:14,color:step.op.color}}>{step.op.symbol}</span>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:7,color:"rgba(255,255,255,0.3)"}}>b</div>
            <div style={{fontSize:18,color:"rgba(255,255,255,0.6)",fontFamily:"monospace",fontWeight:"bold"}}>{step.operand}</div>
          </div>
          <span style={{fontSize:12,color:"rgba(255,255,255,0.2)"}}>=</span>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:7,color:"rgba(255,255,255,0.3)"}}>result</div>
            <div style={{fontSize:22,color:step.op.color,fontFamily:"monospace",fontWeight:"bold"}}>{step.result}</div>
          </div>
        </div>
      </div>
      {!isLast&&(
        <div style={{height:16,background:"#08090d",display:"flex",
          alignItems:"center",padding:"0 16px",gap:8}}>
          <div style={{flex:1,height:1,background:"rgba(255,255,255,0.05)"}}/>
          <span style={{fontSize:8,color:"rgba(255,255,255,0.15)"}}>
            {step.result} → {step.carry?"C=1 ":""}fließt weiter
          </span>
          <div style={{flex:1,height:1,background:"rgba(255,255,255,0.05)"}}/>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [phase,  setPhase]  = useState("idle");
  const [result, setResult] = useState(null);
  const [steps,  setSteps]  = useState([]);
  const [newOp,  setNewOp]  = useState(0);
  const [newB,   setNewB]   = useState(10);
  const [editMode,setEdit]  = useState(false);

  const start = () => {
    setPhase("running");
    setTimeout(()=>{
      const r=optimizeOps();
      setResult(r);
      setPhase("done");
      // Starter-Pipeline: alle 8 Ops einmal
      setSteps(r.chosen.map((oc,i)=>({opCode:oc,operand:[5,10,15,3,7,2,4,6][i]||5})));
    },120);
  };

  // Pipeline ausführen mit Carry-Flag
  const log = useMemo(()=>{
    if(!result||!steps.length) return [];
    const {params,chosen,pats}=result;
    let acc=0, carry=0;
    return steps.map(s=>{
      const inputPat=spikePat(getSpikes(s.opCode,params));
      let bestOp=OPS[0],bestSim=0;
      pats.forEach((ref,i)=>{
        const sm=sim(inputPat,ref);
        if(sm>bestSim){bestSim=sm;bestOp=OPS[i];}
      });
      const {result:res,carry:newCarry,flags}=bestOp.fn(acc,s.operand,carry);
      const prev=acc;
      acc=res; carry=newCarry??carry;
      return {opCode:s.opCode,operand:s.operand,op:bestOp,
              similarity:bestSim,input:prev,result:res,
              carry:newCarry,flags,
              spikes:getSpikes(s.opCode,params)};
    });
  },[result,steps]);

  const addStep=()=>{
    if(!result)return;
    setSteps(prev=>[...prev,{opCode:result.chosen[newOp],operand:newB}]);
  };

  const perfectMatches=log.filter(s=>s.similarity>=0.99).length;
  const carryEvents=log.filter(s=>s.carry).length;

  return (
    <div style={{minHeight:"100vh",background:"#07080c",color:"#dde0e8",
      fontFamily:"'Courier New', monospace",padding:"20px 14px"}}>

      <div style={{marginBottom:14}}>
        <div style={{fontSize:13,letterSpacing:4,textTransform:"uppercase"}}>
          8-Bit Emergentes Rechenwerk
        </div>
        <div style={{fontSize:9,color:"rgba(255,255,255,0.25)",marginTop:3,lineHeight:1.8}}>
          256 Zustände · 128-Bit Muster · 8 Operationen · Carry-Flag<br/>
          MOS 6502 Level — emergent statt programmiert
        </div>
      </div>

      {phase==="idle"&&(
        <div style={{textAlign:"center",padding:"40px 20px"}}>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",marginBottom:20,lineHeight:2.2}}>
            <span style={{color:"#ff8060"}}>4-Bit vorher:</span> 16 Zustände · 32-Bit Muster · 4 Ops<br/>
            <span style={{color:"#b8ff60"}}>8-Bit jetzt: </span> 256 Zustände · 128-Bit Muster · 8 Ops<br/>
            <br/>
            Operationen: ADD · SUB · XOR · AND · OR · SHL · SHR · ADC<br/>
            <span style={{color:"#ffcc60"}}>+ Carry-Flag für Overflow (Geminis Tipp!)</span>
          </div>
          <button onClick={start} style={{
            padding:"14px 36px",fontSize:12,letterSpacing:3,borderRadius:8,
            border:"none",cursor:"pointer",background:"#b8ff60",
            color:"#07080c",fontFamily:"monospace",fontWeight:"bold"
          }}>▶ 8-Bit starten</button>
        </div>
      )}

      {phase==="running"&&(
        <div style={{textAlign:"center",padding:"60px 20px"}}>
          <div style={{fontSize:12,color:"#b8ff60",letterSpacing:2,marginBottom:10}}>
            8-Bit Optimierung läuft...
          </div>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.2)"}}>
            256 Zustände × 128-Bit Muster × greedy Suche
          </div>
        </div>
      )}

      {phase==="done"&&result&&(
        <>
          {/* Op-Übersicht */}
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
            {OPS.map((op,i)=>(
              <div key={i} style={{flex:1,minWidth:90,background:"#0c0d14",
                borderRadius:7,padding:"7px 9px",border:`1px solid ${op.color}33`}}>
                <div style={{display:"flex",gap:5,alignItems:"center",marginBottom:4}}>
                  <span style={{fontSize:14,color:op.color}}>{op.symbol}</span>
                  <div>
                    <div style={{fontSize:9,color:op.color,fontWeight:"bold"}}>{op.name}</div>
                    <div style={{fontSize:8,color:"rgba(255,255,255,0.3)"}}>
                      op=<span style={{color:op.color,fontWeight:"bold"}}>{result.chosen[i]}</span>
                    </div>
                  </div>
                </div>
                <Raster spikes={result.allSpikes[i]} color={op.color} w={110}/>
                <div style={{fontSize:7,color:"rgba(255,255,255,0.2)",marginTop:2}}>
                  {result.spikeCounts[i]}× · {op.desc}
                </div>
              </div>
            ))}
          </div>

          {/* Stats + Matrix */}
          <div style={{display:"flex",gap:10,marginBottom:12,flexWrap:"wrap"}}>
            <div style={{background:"#0c0d14",borderRadius:8,padding:"10px",
              border:"1px solid rgba(255,255,255,0.06)"}}>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",marginBottom:6,letterSpacing:1}}>
                TRENNBARKEIT 8×8
              </div>
              <SimMatrix8 pats={result.pats} opcodes={result.chosen}
                colors={OPS.map(o=>o.color)}/>
            </div>
            <div style={{flex:1,minWidth:160,display:"flex",flexDirection:"column",gap:8}}>
              {[
                {l:"Min Trennung",v:`${Math.round((1-result.minSim)*100)}%`,
                 c:result.minSim<0.5?"#b8ff60":"#ffcc60",note:"schlechtestes Paar"},
                {l:"Ø Ähnlichkeit",v:`${Math.round(result.avgSim*100)}%`,
                 c:"#60c8ff",note:"alle 28 Paare"},
                {l:"Pat-Länge",v:"128 Bit",c:"#c8a0ff",note:"8-Bit Raum"},
                {l:"Carry-Flag",v:"✓ aktiv",c:"#ffcc60",note:"Overflow-Tracking"},
              ].map(s=>(
                <div key={s.l} style={{background:"#0c0d14",borderRadius:6,
                  padding:"7px 10px",border:`1px solid ${s.c}22`}}>
                  <div style={{fontSize:8,color:"rgba(255,255,255,0.3)",textTransform:"uppercase"}}>{s.l}</div>
                  <div style={{fontSize:14,color:s.c,fontWeight:"bold"}}>{s.v}</div>
                  <div style={{fontSize:7,color:"rgba(255,255,255,0.2)"}}>{s.note}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Pipeline Controls */}
          <div style={{background:"#0c0d14",borderRadius:8,padding:"10px 12px",marginBottom:10,
            border:"1px solid rgba(255,255,255,0.06)"}}>
            <div style={{display:"flex",gap:5,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}>
              <span style={{fontSize:8,color:"rgba(255,255,255,0.3)"}}>PRESET:</span>
              {[
                {n:"Alle 8",  s:result.chosen.map((oc,i)=>({opCode:oc,operand:[5,10,15,3,7,2,4,6][i]}))},
                {n:"ADD×3",   s:[{opCode:result.chosen[0],operand:100},{opCode:result.chosen[0],operand:100},{opCode:result.chosen[0],operand:100}]},
                {n:"Overflow",s:[{opCode:result.chosen[0],operand:120},{opCode:result.chosen[0],operand:120},{opCode:result.chosen[7]||result.chosen[0],operand:10}]},
                {n:"Bit-Ops", s:[{opCode:result.chosen[2],operand:85},{opCode:result.chosen[3],operand:170},{opCode:result.chosen[4],operand:255}]},
              ].map(p=>(
                <button key={p.n} onClick={()=>setSteps(p.s)} style={{
                  padding:"3px 10px",fontSize:8,borderRadius:4,border:"none",cursor:"pointer",
                  fontFamily:"monospace",
                  background:JSON.stringify(steps)===JSON.stringify(p.s)?"#dde0e8":"rgba(255,255,255,0.07)",
                  color:JSON.stringify(steps)===JSON.stringify(p.s)?"#07080c":"rgba(255,255,255,0.5)"
                }}>{p.n}</button>
              ))}
              <button onClick={()=>setEdit(!editMode)} style={{
                padding:"3px 10px",fontSize:8,borderRadius:4,border:"none",cursor:"pointer",
                fontFamily:"monospace",
                background:editMode?"#b8ff60":"rgba(255,255,255,0.07)",
                color:editMode?"#07080c":"rgba(255,255,255,0.5)"
              }}>✏ Eigene</button>
            </div>

            {editMode&&(
              <div style={{background:"#08090d",borderRadius:6,padding:"8px",marginBottom:8}}>
                <div style={{display:"flex",gap:4,marginBottom:6,flexWrap:"wrap"}}>
                  {steps.map((s,i)=>{
                    const oi=result.chosen.indexOf(s.opCode);
                    const op=OPS[oi>=0?oi:0];
                    return (
                      <div key={i} style={{padding:"2px 7px",borderRadius:3,fontSize:8,
                        background:`${op.color}22`,color:op.color,
                        border:`1px solid ${op.color}44`,display:"flex",gap:3,alignItems:"center"}}>
                        <span>{op.symbol}(b={s.operand})</span>
                        <button onClick={()=>setSteps(p=>p.filter((_,j)=>j!==i))}
                          style={{background:"none",border:"none",color:op.color,cursor:"pointer",fontSize:9,padding:0}}>×</button>
                      </div>
                    );
                  })}
                </div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end"}}>
                  <div style={{display:"flex",flexDirection:"column",gap:2}}>
                    <span style={{fontSize:7,color:"rgba(255,255,255,0.3)"}}>Operation</span>
                    <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
                      {OPS.map((op,i)=>(
                        <button key={i} onClick={()=>setNewOp(i)} style={{
                          padding:"3px 8px",fontSize:9,borderRadius:3,border:"none",cursor:"pointer",
                          background:newOp===i?op.color:"rgba(255,255,255,0.07)",
                          color:newOp===i?"#07080c":"rgba(255,255,255,0.4)",fontFamily:"monospace"
                        }}>{op.symbol}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:2}}>
                    <span style={{fontSize:7,color:"rgba(255,255,255,0.3)"}}>
                      Operand b (0-255): <span style={{color:"#60ffd0"}}>{newB}</span>
                    </span>
                    <input type="range" min={0} max={127} step={1} value={newB}
                      onChange={e=>setNewB(parseInt(e.target.value))}
                      style={{accentColor:"#60ffd0",width:160}}/>
                  </div>
                  <button onClick={addStep} style={{
                    padding:"5px 14px",fontSize:9,borderRadius:5,border:"none",cursor:"pointer",
                    fontFamily:"monospace",background:"#b8ff60",color:"#07080c",fontWeight:"bold"
                  }}>+ Schritt</button>
                </div>
              </div>
            )}

            {/* Dataflow */}
            <div style={{borderRadius:6,overflow:"hidden",border:"1px solid rgba(255,255,255,0.05)"}}>
              {log.map((step,i)=>(
                <DataflowStep key={i} step={step} isLast={i===log.length-1}/>
              ))}
              {log.length>0&&(
                <div style={{padding:"10px 14px",background:"rgba(184,255,96,0.06)",
                  borderTop:"1px solid rgba(184,255,96,0.15)",
                  display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                  <span style={{fontSize:9,color:"rgba(255,255,255,0.3)",letterSpacing:1}}>ENDRESULTAT</span>
                  <div style={{display:"flex",gap:12,alignItems:"center"}}>
                    {log[log.length-1].carry>0&&(
                      <span style={{fontSize:10,color:"#ffcc60"}}>⚑ Carry={log[log.length-1].carry}</span>
                    )}
                    <span style={{fontSize:28,color:"#b8ff60",fontFamily:"monospace",fontWeight:"bold"}}>
                      {log[log.length-1].result}
                    </span>
                  </div>
                  <span style={{fontSize:8,color:"rgba(255,255,255,0.25)"}}>
                    {log.length} Schritte · {perfectMatches}/{log.length} ✓
                    {carryEvents>0&&` · ${carryEvents}× Carry`}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div style={{textAlign:"center"}}>
            <button onClick={()=>{setPhase("idle");setResult(null);setSteps([]);}}
              style={{padding:"5px 16px",fontSize:9,borderRadius:5,border:"none",cursor:"pointer",
                background:"rgba(255,255,255,0.06)",color:"rgba(255,255,255,0.3)",fontFamily:"monospace"}}>
              ↺ neu
            </button>
          </div>
        </>
      )}
    </div>
  );
}
