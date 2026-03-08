import { useState, useEffect, useRef, useMemo } from "react";

// ── Konfiguration ─────────────────────────────────────────────
const BITS = 8;
const M = Math.pow(2, BITS);
const HALF = M / 2;
const M16 = Math.pow(2, 16);
const HALF16 = M16 / 2;
const STEPS = 128;
const PAT_LEN = 128;

// ── 8-Bit Kern ────────────────────────────────────────────────
const modN = v => { v=Math.round(v); while(v>HALF-1)v-=M; while(v<-HALF)v+=M; return v; };
const xorN = (v,k) => { v=Math.round(v); let u=((v%M)+M)%M; u=u^(k%M); return u>=HALF?u-M:u; };
const maskN = (v,mb) => { v=Math.round(v); const mask=(1<<mb)-1; let u=((v%M)+M)%M; u=u&mask; return u>=HALF?u-M:u; };
const isSpike = (p,c) => Math.abs(c-p) >= Math.floor(M*0.4);

// Beste Parameter aus 8-Bit Optimierung
const P_LOW  = {gainA:1.07,gainB:1.15,xorA:9,  xorB:15, maskA:3,maskB:4,fgain:0.2};
const P_HIGH = {gainA:1.05,gainB:1.10,xorA:50, xorB:120,maskA:4,maskB:5,fgain:0.1};

function getSpikes(amp, p) {
  let a1A=0,a2A=0,a3A=0, a1B=0,a2B=0,a3B=0, fb=0, pC=0;
  const spikes=[];
  for(let n=0;n<STEPS;n++){
    const xA=modN(amp+Math.round(p.fgain*fb));
    const na1A=maskN(p.gainA*a1A+xA,p.maskA);
    const na2A=xorN(p.gainA*a2A+na1A,p.xorA);
    const na3A=modN(p.gainA*a3A+na2A);
    const yA=modN(na3A+amp);
    const xB=modN(amp+Math.round(p.fgain*fb));
    const na1B=maskN(p.gainB*a1B+xB,p.maskB);
    const na2B=xorN(p.gainB*a2B+na1B,p.xorB);
    const na3B=modN(p.gainB*a3B+na2B);
    const yB=modN(na3B+amp);
    const yC=modN(yA+yB);
    if(isSpike(pC,yC)&&n<PAT_LEN) spikes.push(n);
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

// ── OpCodes (aus 8-Bit Optimierung) ──────────────────────────
const OP_CODES = {ADD:1, SUB:100, XOR:20, AND:24, OR:64, SHL:12, SHR:120, ADC:5};
const OPS_DEF = [
  {name:"ADD", symbol:"+",  color:"#ff8060", code:1},
  {name:"SUB", symbol:"−",  color:"#ff6090", code:100},
  {name:"XOR", symbol:"⊕",  color:"#60c8ff", code:20},
  {name:"AND", symbol:"∧",  color:"#b8ff60", code:24},
  {name:"OR",  symbol:"∨",  color:"#60ffd0", code:64},
  {name:"SHL", symbol:"≪",  color:"#c8a0ff", code:12},
  {name:"SHR", symbol:"≫",  color:"#ffcc60", code:120},
  {name:"ADC", symbol:"+C", color:"#ff9030", code:5},
];

// Alle Referenzmuster vorberechnen
const REF_PATS = {};
OPS_DEF.forEach(op=>{ REF_PATS[op.code]=spikePat(getSpikes(op.code,P_LOW)); });

function recognizeOp(opCode) {
  const inputPat=spikePat(getSpikes(opCode,P_LOW));
  let bestOp=OPS_DEF[0], bestSim=0;
  OPS_DEF.forEach(op=>{
    const s=sim(inputPat,REF_PATS[op.code]);
    if(s>bestSim){bestSim=s;bestOp=op;}
  });
  return {op:bestOp, similarity:bestSim};
}

// ── 16-Bit Kern: zwei 8-Bit Units + Carry-Spike ───────────────
//
// Low Unit:   verarbeitet Low-Byte (0-7)
//             erzeugt Carry-Spike wenn Überlauf
//             → Carry-Spike fließt als Signal zu High Unit
//
// High Unit:  verarbeitet High-Byte (8-15)
//             empfängt Carry-Spike von Low Unit
//             → ADC statt ADD wenn Carry-Spike aktiv
//
// Das ist NICHT programmiert — der Carry-Spike
// ändert den Eingabewert der High Unit emergent!

function run16bit(opCode, aLow, aHigh, bLow, bHigh) {
  const {op} = recognizeOp(opCode);

  // ── Low Unit ──────────────────────────────────────────────
  let lowResult, carrySpike=0, lowCarry=0;
  const rawLow = (() => {
    const ua=((aLow%M)+M)%M, ub=((bLow%M)+M)%M;
    switch(op.name){
      case "ADD": case "ADC": return aLow+bLow;
      case "SUB": return aLow-bLow;
      case "XOR": return (ua^ub)>=HALF?(ua^ub)-M:(ua^ub);
      case "AND": return (ua&ub)>=HALF?(ua&ub)-M:(ua&ub);
      case "OR":  return (ua|ub)>=HALF?(ua|ub)-M:(ua|ub);
      case "SHL": return aLow<<(Math.abs(bLow)%8);
      case "SHR": return ua>>(Math.abs(bLow)%8);
      default: return aLow+bLow;
    }
  })();

  // Carry-Erkennung: Überlauf = Carry-Spike!
  if(rawLow > HALF-1 || rawLow < -HALF) {
    carrySpike = 1;  // ← Das ist der Carry-Spike
    lowCarry = rawLow > 0 ? 1 : -1;
  }
  lowResult = modN(rawLow);

  // ── Carry-Spike Visualisierung ────────────────────────────
  // Der Spike "fließt" von Low zu High durch das System
  // In echter Hardware: ein Signal-Wire zwischen den Units
  const carrySignal = carrySpike;

  // ── High Unit: empfängt Carry-Spike ───────────────────────
  // Wenn Carry-Spike aktiv → High Unit bekommt extra +1 (oder -1)
  // Das passiert EMERGENT durch das Signal, nicht durch Programmierung
  const aHighWithCarry = aHigh + (carrySignal * lowCarry);
  let highResult;
  const rawHigh = (() => {
    const ua=((aHighWithCarry%M)+M)%M, ub=((bHigh%M)+M)%M;
    switch(op.name){
      case "ADD": case "ADC": return aHighWithCarry+bHigh;
      case "SUB": return aHighWithCarry-bHigh;
      case "XOR": return (ua^ub)>=HALF?(ua^ub)-M:(ua^ub);
      case "AND": return (ua&ub)>=HALF?(ua&ub)-M:(ua&ub);
      case "OR":  return (ua|ub)>=HALF?(ua|ub)-M:(ua|ub);
      case "SHL": return aHighWithCarry<<(Math.abs(bHigh)%8);
      case "SHR": return ua>>(Math.abs(bHigh)%8);
      default: return aHighWithCarry+bHigh;
    }
  })();
  highResult = modN(rawHigh);
  const finalCarry = (rawHigh > HALF-1 || rawHigh < -HALF) ? 1 : 0;

  // ── 16-Bit Zusammensetzung ────────────────────────────────
  // Low Byte + High Byte → 16-Bit Wert
  const lowU  = ((lowResult%M)+M)%M;
  const highU = ((highResult%M)+M)%M;
  const result16 = (highU << 8) | lowU;
  // Signed 16-Bit
  const result16signed = result16 >= HALF16 ? result16 - M16 : result16;

  return {
    op, lowResult, highResult,
    carrySpike, carrySignal, finalCarry,
    result16: result16signed,
    lowU, highU,
    spikes: getSpikes(opCode, P_LOW)
  };
}

// ── Pipeline ──────────────────────────────────────────────────
function runPipeline16(steps) {
  let accLow=0, accHigh=0, carry=0;
  return steps.map(s=>{
    const r = run16bit(s.opCode, accLow, accHigh, s.bLow, s.bHigh);
    const prevLow=accLow, prevHigh=accHigh;
    const prev16 = ((((accHigh%M)+M)%M)<<8) | (((accLow%M)+M)%M);
    const prev16s = prev16>=HALF16?prev16-M16:prev16;
    accLow=r.lowResult; accHigh=r.highResult; carry=r.finalCarry;
    return {...r, inputLow:prevLow, inputHigh:prevHigh, input16:prev16s,
            bLow:s.bLow, bHigh:s.bHigh, opCode:s.opCode};
  });
}

// ── Raster ────────────────────────────────────────────────────
function Raster({spikes,color,w=160,h=18}) {
  const ref=useRef();
  useEffect(()=>{
    const c=ref.current; if(!c) return;
    const ctx=c.getContext("2d");
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle="rgba(255,255,255,0.02)"; ctx.fillRect(0,0,w,h);
    spikes.forEach(t=>{
      const x=1+(t/(PAT_LEN-1))*(w-2);
      ctx.strokeStyle=color; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(x,1); ctx.lineTo(x,h-1); ctx.stroke();
    });
  },[spikes,color,w,h]);
  return <canvas ref={ref} width={w} height={h} style={{width:w,height:h}}/>;
}

// ── 16-Bit Anzeige ────────────────────────────────────────────
function Bit16Display({value, label, color}) {
  const u = ((value%M16)+M16)%M16;
  const bits = u.toString(2).padStart(16,'0');
  const high = bits.slice(0,8);
  const low  = bits.slice(8,16);
  return (
    <div style={{textAlign:"center"}}>
      <div style={{fontSize:7,color:"rgba(255,255,255,0.3)",marginBottom:2}}>{label}</div>
      <div style={{fontSize:20,color,fontFamily:"monospace",fontWeight:"bold"}}>{value}</div>
      <div style={{fontSize:8,fontFamily:"monospace",letterSpacing:2,marginTop:2}}>
        <span style={{color:"#60c8ff"}}>{high}</span>
        <span style={{color:"rgba(255,255,255,0.2)"}}> </span>
        <span style={{color:"#ff8060"}}>{low}</span>
      </div>
      <div style={{fontSize:7,color:"rgba(255,255,255,0.2)",marginTop:1}}>
        H=<span style={{color:"#60c8ff"}}>{parseInt(high,2)}</span>
        {" "}L=<span style={{color:"#ff8060"}}>{parseInt(low,2)}</span>
      </div>
    </div>
  );
}

// ── Carry-Spike Visualisierung ────────────────────────────────
function CarryBridge({active}) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:4,
      padding:"4px 10px",
      background:active?"rgba(255,204,96,0.12)":"rgba(255,255,255,0.03)",
      borderRadius:5,border:`1px solid ${active?"#ffcc6066":"rgba(255,255,255,0.06)"}`,
      transition:"all 0.3s"}}>
      <div style={{fontSize:8,color:"rgba(255,255,255,0.3)"}}>Low Unit</div>
      <div style={{flex:1,height:2,position:"relative",
        background:"rgba(255,255,255,0.07)",borderRadius:1}}>
        {active&&(
          <div style={{position:"absolute",top:-3,left:"40%",
            width:8,height:8,borderRadius:"50%",
            background:"#ffcc60",
            boxShadow:"0 0 8px #ffcc60",
            animation:"pulse 0.5s ease"}}/>
        )}
      </div>
      <div style={{fontSize:8,color:"rgba(255,255,255,0.3)"}}>High Unit</div>
      {active?(
        <span style={{fontSize:8,color:"#ffcc60",fontWeight:"bold"}}>⚑ Carry-Spike!</span>
      ):(
        <span style={{fontSize:8,color:"rgba(255,255,255,0.15)"}}>kein Carry</span>
      )}
    </div>
  );
}

// ── Schritt-Anzeige ───────────────────────────────────────────
function Step16({step, isLast}) {
  const b16 = (step.bHigh<<8)|step.bLow;
  const b16s = b16>=HALF16?b16-M16:b16;
  return (
    <div>
      <div style={{background:`${step.op.color}08`,borderLeft:`3px solid ${step.op.color}`,
        padding:"10px 12px"}}>
        {/* Op Header */}
        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8,flexWrap:"wrap"}}>
          <div style={{width:28,height:28,borderRadius:6,background:step.op.color,
            display:"flex",alignItems:"center",justifyContent:"center",
            fontSize:14,color:"#07080c",fontWeight:"bold",flexShrink:0}}>
            {step.op.symbol}
          </div>
          <div>
            <span style={{fontSize:10,color:step.op.color,fontWeight:"bold"}}>{step.op.name}</span>
            <span style={{fontSize:8,color:"rgba(255,255,255,0.3)",marginLeft:8}}>
              opcode={step.opCode} · 16-Bit
            </span>
          </div>
          <Raster spikes={step.spikes} color={step.op.color} w={130}/>
        </div>

        {/* Zwei-Ebenen Berechnung */}
        <div style={{display:"flex",flexDirection:"column",gap:4}}>

          {/* Low Unit */}
          <div style={{display:"flex",gap:8,alignItems:"center",
            background:"rgba(255,128,96,0.06)",borderRadius:5,padding:"5px 8px",flexWrap:"wrap"}}>
            <span style={{fontSize:8,color:"#ff8060",minWidth:50,letterSpacing:1}}>LOW UNIT</span>
            <div style={{display:"flex",gap:6,alignItems:"center",fontSize:10,fontFamily:"monospace"}}>
              <span style={{color:"rgba(255,255,255,0.5)"}}>{step.inputLow}</span>
              <span style={{color:"#ff8060"}}>{step.op.symbol}</span>
              <span style={{color:"rgba(255,255,255,0.5)"}}>{step.bLow}</span>
              <span style={{color:"rgba(255,255,255,0.2)"}}>=</span>
              <span style={{color:"#ff8060",fontWeight:"bold",fontSize:14}}>{step.lowResult}</span>
            </div>
          </div>

          {/* Carry-Spike Bridge */}
          <CarryBridge active={step.carrySpike===1}/>

          {/* High Unit */}
          <div style={{display:"flex",gap:8,alignItems:"center",
            background:"rgba(96,200,255,0.06)",borderRadius:5,padding:"5px 8px",flexWrap:"wrap"}}>
            <span style={{fontSize:8,color:"#60c8ff",minWidth:50,letterSpacing:1}}>HIGH UNIT</span>
            <div style={{display:"flex",gap:6,alignItems:"center",fontSize:10,fontFamily:"monospace"}}>
              <span style={{color:"rgba(255,255,255,0.5)"}}>
                {step.inputHigh}
                {step.carrySpike===1&&<span style={{color:"#ffcc60"}}>+C</span>}
              </span>
              <span style={{color:"#60c8ff"}}>{step.op.symbol}</span>
              <span style={{color:"rgba(255,255,255,0.5)"}}>{step.bHigh}</span>
              <span style={{color:"rgba(255,255,255,0.2)"}}>=</span>
              <span style={{color:"#60c8ff",fontWeight:"bold",fontSize:14}}>{step.highResult}</span>
            </div>
          </div>

          {/* 16-Bit Zusammensetzung */}
          <div style={{display:"flex",gap:10,alignItems:"center",
            background:"rgba(184,255,96,0.05)",borderRadius:5,padding:"6px 10px",
            justifyContent:"space-between",flexWrap:"wrap"}}>
            <span style={{fontSize:8,color:"#b8ff60",letterSpacing:1}}>16-BIT ERGEBNIS</span>
            <Bit16Display value={step.result16} label="" color="#b8ff60"/>
            {step.finalCarry>0&&(
              <span style={{fontSize:8,color:"#ffcc60"}}>⚑ Carry out</span>
            )}
          </div>
        </div>
      </div>

      {!isLast&&(
        <div style={{height:18,background:"#08090d",display:"flex",
          alignItems:"center",padding:"0 16px",gap:8}}>
          <div style={{flex:1,height:1,background:"rgba(255,255,255,0.05)"}}/>
          <span style={{fontSize:8,color:"rgba(255,255,255,0.15)"}}>
            {step.result16} fließt weiter →
          </span>
          <div style={{flex:1,height:1,background:"rgba(255,255,255,0.05)"}}/>
        </div>
      )}
    </div>
  );
}

// ── Presets ───────────────────────────────────────────────────
const PRESETS = [
  {
    name:"Overflow!",
    desc:"255+1 → Carry-Spike → 256",
    steps:[
      {opCode:1,  bLow:1,   bHigh:0},   // ADD 0x0001 → 256 mit Carry
      {opCode:1,  bLow:255, bHigh:0},   // ADD 0x00FF
      {opCode:20, bLow:85,  bHigh:170}, // XOR
    ]
  },
  {
    name:"16-Bit ADD",
    desc:"Große Zahlen addieren",
    steps:[
      {opCode:1,  bLow:255, bHigh:1},   // + 511
      {opCode:1,  bLow:255, bHigh:1},   // + 511 nochmal
      {opCode:5,  bLow:10,  bHigh:0},   // ADC +10
    ]
  },
  {
    name:"Bitweise 16",
    desc:"XOR → AND → OR",
    steps:[
      {opCode:20, bLow:255, bHigh:85},
      {opCode:24, bLow:170, bHigh:15},
      {opCode:64, bLow:15,  bHigh:240},
    ]
  },
  {
    name:"Shift 16",
    desc:"Links- und Rechtsshift",
    steps:[
      {opCode:1,  bLow:1,   bHigh:0},
      {opCode:12, bLow:4,   bHigh:0},   // SHL 4
      {opCode:120,bLow:2,   bHigh:0},   // SHR 2
    ]
  },
];

export default function App() {
  const [steps, setSteps]   = useState(PRESETS[0].steps);
  const [editMode, setEdit] = useState(false);
  const [newOp, setNewOp]   = useState(0);
  const [newBLow, setNBL]   = useState(1);
  const [newBHigh, setNBH]  = useState(0);

  const log = useMemo(()=>runPipeline16(steps),[steps]);

  const carryEvents = log.filter(s=>s.carrySpike).length;
  const finalResult = log.length ? log[log.length-1].result16 : 0;

  return (
    <div style={{minHeight:"100vh",background:"#07080c",color:"#dde0e8",
      fontFamily:"'Courier New', monospace",padding:"20px 14px"}}>

      {/* Header */}
      <div style={{marginBottom:14}}>
        <div style={{fontSize:13,letterSpacing:4,textTransform:"uppercase"}}>
          16-Bit Emergentes Rechenwerk
        </div>
        <div style={{fontSize:9,color:"rgba(255,255,255,0.25)",marginTop:3,lineHeight:1.8}}>
          Zwei gekoppelte 8-Bit Units · Carry als Spike-Signal<br/>
          <span style={{color:"#ff8060"}}>Low Unit</span> →{" "}
          <span style={{color:"#ffcc60"}}>Carry-Spike</span> →{" "}
          <span style={{color:"#60c8ff"}}>High Unit</span> → 16-Bit Ergebnis
        </div>
      </div>

      {/* Architektur */}
      <div style={{background:"#0c0d14",borderRadius:8,padding:"10px 14px",marginBottom:12,
        border:"1px solid rgba(255,255,255,0.06)",
        fontSize:9,color:"rgba(255,255,255,0.3)",fontFamily:"monospace",lineHeight:2.2}}>
        x[15:8] ──→ <span style={{color:"#60c8ff"}}>[HIGH UNIT: MASK→XOR→MOD]</span> ←── <span style={{color:"#ffcc60"}}>⚑ Carry-Spike</span><br/>
        {"           "}↑{"                                              "}↑<br/>
        x[7:0]  ──→ <span style={{color:"#ff8060"}}>[LOW  UNIT: MASK→XOR→MOD]</span> ──→ <span style={{color:"#ffcc60"}}>Overflow?</span><br/>
        {"           "}↓<br/>
        <span style={{color:"#b8ff60"}}>y[15:0] = {"{"}High,Low{"}"}</span>
        <span style={{color:"rgba(255,255,255,0.2)"}}> ← 16-Bit Ergebnis zusammengesetzt</span>
      </div>

      {/* Presets */}
      <div style={{display:"flex",gap:5,marginBottom:10,flexWrap:"wrap"}}>
        {PRESETS.map(p=>(
          <button key={p.name} onClick={()=>setSteps(p.steps)} style={{
            flex:1,minWidth:100,padding:"5px 8px",fontSize:8,borderRadius:5,border:"none",
            cursor:"pointer",fontFamily:"monospace",textAlign:"left",
            background:JSON.stringify(steps)===JSON.stringify(p.steps)?"rgba(184,255,96,0.15)":"#0c0d14",
            color:JSON.stringify(steps)===JSON.stringify(p.steps)?"#b8ff60":"rgba(255,255,255,0.4)",
            outline:JSON.stringify(steps)===JSON.stringify(p.steps)?"1px solid #b8ff6044":"1px solid rgba(255,255,255,0.06)"
          }}>
            <div style={{fontWeight:"bold"}}>{p.name}</div>
            <div style={{fontSize:7,opacity:0.6}}>{p.desc}</div>
          </button>
        ))}
        <button onClick={()=>setEdit(!editMode)} style={{
          padding:"5px 10px",fontSize:8,borderRadius:5,border:"none",cursor:"pointer",
          fontFamily:"monospace",
          background:editMode?"#b8ff60":"rgba(255,255,255,0.07)",
          color:editMode?"#07080c":"rgba(255,255,255,0.4)"
        }}>✏ Eigene</button>
      </div>

      {/* Editor */}
      {editMode&&(
        <div style={{background:"#0c0d14",borderRadius:8,padding:"10px 12px",marginBottom:10,
          border:"1px solid rgba(255,255,255,0.08)"}}>
          <div style={{display:"flex",gap:4,marginBottom:8,flexWrap:"wrap"}}>
            {steps.map((s,i)=>{
              const op=OPS_DEF.find(o=>o.code===s.opCode)||OPS_DEF[0];
              return (
                <div key={i} style={{padding:"3px 8px",borderRadius:4,fontSize:8,
                  background:`${op.color}22`,color:op.color,
                  border:`1px solid ${op.color}44`,display:"flex",gap:4,alignItems:"center"}}>
                  <span>{op.symbol} L={s.bLow} H={s.bHigh}</span>
                  <button onClick={()=>setSteps(p=>p.filter((_,j)=>j!==i))}
                    style={{background:"none",border:"none",color:op.color,cursor:"pointer",fontSize:9,padding:0}}>×</button>
                </div>
              );
            })}
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end"}}>
            <div style={{display:"flex",flexDirection:"column",gap:2}}>
              <span style={{fontSize:7,color:"rgba(255,255,255,0.3)"}}>Op</span>
              <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
                {OPS_DEF.map((op,i)=>(
                  <button key={i} onClick={()=>setNewOp(i)} style={{
                    padding:"3px 7px",fontSize:9,borderRadius:3,border:"none",cursor:"pointer",
                    background:newOp===i?op.color:"rgba(255,255,255,0.07)",
                    color:newOp===i?"#07080c":"rgba(255,255,255,0.4)",fontFamily:"monospace"
                  }}>{op.symbol}</button>
                ))}
              </div>
            </div>
            {[["Low Byte (0-255)",newBLow,setNBL],["High Byte (0-255)",newBHigh,setNBH]].map(([l,v,set])=>(
              <div key={l} style={{display:"flex",flexDirection:"column",gap:2}}>
                <span style={{fontSize:7,color:"rgba(255,255,255,0.3)"}}>{l}: <span style={{color:"#60ffd0"}}>{v}</span></span>
                <input type="range" min={0} max={255} step={1} value={v}
                  onChange={e=>set(parseInt(e.target.value))}
                  style={{accentColor:"#60ffd0",width:120}}/>
              </div>
            ))}
            <button onClick={()=>setSteps(p=>[...p,{opCode:OPS_DEF[newOp].code,bLow:newBLow,bHigh:newBHigh}])}
              style={{padding:"5px 14px",fontSize:9,borderRadius:5,border:"none",cursor:"pointer",
                fontFamily:"monospace",background:"#b8ff60",color:"#07080c",fontWeight:"bold"}}>
              + Schritt
            </button>
          </div>
        </div>
      )}

      {/* Dataflow */}
      <div style={{background:"#0c0d14",borderRadius:8,overflow:"hidden",marginBottom:12,
        border:"1px solid rgba(255,255,255,0.06)"}}>
        <div style={{padding:"8px 12px",borderBottom:"1px solid rgba(255,255,255,0.06)",
          fontSize:9,color:"rgba(255,255,255,0.3)",letterSpacing:1,
          display:"flex",justifyContent:"space-between"}}>
          <span>16-BIT DATAFLOW</span>
          <span style={{color:carryEvents>0?"#ffcc60":"rgba(255,255,255,0.2)"}}>
            {carryEvents>0?`${carryEvents}× Carry-Spike ⚑`:"kein Carry"}
          </span>
        </div>
        {log.map((step,i)=>(
          <Step16 key={i} step={step} isLast={i===log.length-1}/>
        ))}
        {log.length>0&&(
          <div style={{padding:"12px 16px",background:"rgba(184,255,96,0.06)",
            borderTop:"1px solid rgba(184,255,96,0.15)",
            display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
            <span style={{fontSize:9,color:"rgba(255,255,255,0.3)",letterSpacing:1}}>ENDRESULTAT 16-BIT</span>
            <Bit16Display value={finalResult} label="" color="#b8ff60"/>
            <div style={{fontSize:8,color:"rgba(255,255,255,0.25)",textAlign:"right"}}>
              {log.length} Schritte<br/>
              {carryEvents} Carry-Spikes<br/>
              Range: −32768 … +32767
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse { 0%{opacity:0;transform:scale(0.5)} 100%{opacity:1;transform:scale(1)} }
      `}</style>
    </div>
  );
}
