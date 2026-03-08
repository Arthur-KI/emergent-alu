import { useState, useRef, useMemo, useEffect } from "react";

// ── Stufen ────────────────────────────────────────────────────
const LEVELS = [
  { bits:2,  name:"2-Bit",  color:"#ff6060", patLen:64,  steps:128,  states:4,          maxOps:0, example:"Carry-Baustein", structural:true },
  { bits:4,  name:"4-Bit",  color:"#ff9030", patLen:32,  steps:64,   states:16,         maxOps:8, example:"Nibble/BCD"  },
  { bits:8,  name:"8-Bit",  color:"#ffcc60", patLen:128, steps:256,  states:256,        maxOps:8, example:"Arduino/C64" },
  { bits:16, name:"16-Bit", color:"#60c8ff", patLen:256, steps:512,  states:65536,      maxOps:8, example:"Game Boy"    },
  { bits:32, name:"32-Bit", color:"#b8ff60", patLen:512, steps:1024, states:4294967296, maxOps:8, example:"Raspberry Pi"},
];

const OPS_DEF = [
  {name:"ADD",symbol:"+", color:"#ff8060"},
  {name:"SUB",symbol:"−", color:"#ff6090"},
  {name:"XOR",symbol:"⊕", color:"#60c8ff"},
  {name:"AND",symbol:"∧", color:"#b8ff60"},
  {name:"OR", symbol:"∨", color:"#60ffd0"},
  {name:"SHL",symbol:"≪", color:"#c8a0ff"},
  {name:"SHR",symbol:"≫", color:"#ffcc60"},
  {name:"ADC",symbol:"+C",color:"#ff9030"},
];

// ── Kern ──────────────────────────────────────────────────────
function makeCore(bits) {
  const M=Math.pow(2,bits), HALF=M/2;
  const modN=v=>{v=Math.round(v);while(v>HALF-1)v-=M;while(v<-HALF)v+=M;return v;};
  const xorN=(v,k)=>{v=Math.round(v);let u=((v%M)+M)%M;u=u^(k%M);return u>=HALF?u-M:u;};
  const maskN=(v,mb)=>{
    const b=Math.max(1,Math.min(mb,bits-1));
    v=Math.round(v);
    const mask=(1<<b)-1;
    let u=((v%M)+M)%M; u=u&mask;
    return u>=HALF?u-M:u;
  };
  const isSpike=(p,c)=>Math.abs(c-p)>=Math.max(1,Math.floor(M*0.3));
  return {M,HALF,modN,xorN,maskN,isSpike};
}

function runUnit(amp, bits, patLen, numSteps, p) {
  const {modN,xorN,maskN,isSpike}=makeCore(bits);
  let a1A=0,a2A=0,a3A=0,a1B=0,a2B=0,a3B=0,fb=0,pC=0;
  const spikes=[];
  for(let n=0;n<numSteps;n++){
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
    if(isSpike(pC,yC)&&n<patLen) spikes.push(n);
    a1A=na1A;a2A=na2A;a3A=na3A;
    a1B=na1B;a2B=na2B;a3B=na3B;
    fb=yC;pC=yC;
  }
  return spikes;
}

function spikePat(spikes,patLen){
  const p=Array(patLen).fill(0);
  spikes.forEach(t=>{if(t<patLen)p[t]=1;});
  return p;
}
function sim(a,b){return 1-a.reduce((s,v,i)=>s+(v!==b[i]?1:0),0)/a.length;}

// ── Bewährte Parameter aus früheren Sessions ──────────────────
// Basis: gainA=1.07, gainB=1.15, xorA≈bits, xorB≈2*bits
// xor/mask skaliert proportional zu Bitbreite
function getParamSets(bits) {
  const s=bits/8; // Skalierungsfaktor
  // For 2-bit, add very slow-gain params that create distinguishable patterns
  if(bits<=2) return [
    {gainA:1.0,  gainB:1.0,  xorA:1, xorB:2, maskA:1, maskB:1, fgain:0.0},
    {gainA:1.0,  gainB:1.0,  xorA:1, xorB:3, maskA:1, maskB:1, fgain:0.1},
    {gainA:1.0,  gainB:1.05, xorA:2, xorB:3, maskA:1, maskB:1, fgain:0.0},
    {gainA:1.05, gainB:1.0,  xorA:1, xorB:2, maskA:1, maskB:1, fgain:0.2},
    {gainA:1.0,  gainB:1.0,  xorA:2, xorB:1, maskA:1, maskB:1, fgain:0.3},
    {gainA:1.05, gainB:1.05, xorA:1, xorB:3, maskA:1, maskB:1, fgain:0.1},
    {gainA:1.10, gainB:1.10, xorA:1, xorB:2, maskA:1, maskB:1, fgain:0.0},
    {gainA:1.0,  gainB:1.15, xorA:3, xorB:1, maskA:1, maskB:1, fgain:0.2},
  ];
  return [
    // Basis (bewährt für 8-Bit, skaliert)
    {gainA:1.07, gainB:1.15, xorA:Math.round(9*s),  xorB:Math.round(15*s), maskA:3, maskB:4, fgain:0.2},
    {gainA:1.05, gainB:1.10, xorA:Math.round(12*s), xorB:Math.round(20*s), maskA:3, maskB:5, fgain:0.1},
    {gainA:1.10, gainB:1.12, xorA:Math.round(5*s),  xorB:Math.round(25*s), maskA:4, maskB:4, fgain:0.3},
    {gainA:1.07, gainB:1.07, xorA:Math.round(15*s), xorB:Math.round(30*s), maskA:2, maskB:3, fgain:0.0},
    {gainA:1.12, gainB:1.05, xorA:Math.round(8*s),  xorB:Math.round(18*s), maskA:4, maskB:5, fgain:0.2},
    {gainA:1.15, gainB:1.10, xorA:Math.round(20*s), xorB:Math.round(10*s), maskA:3, maskB:4, fgain:0.1},
  ].map(p=>({
    ...p,
    xorA:Math.max(1,p.xorA),
    xorB:Math.max(1,p.xorB),
    maskA:Math.max(1,Math.min(p.maskA,bits-1)),
    maskB:Math.max(1,Math.min(p.maskB,bits-1)),
  }));
}

// ── Kandidaten pro Bitbreite ──────────────────────────────────
function getCandidates(bits) {
  if(bits<=2) return [1,2,3];
  const HALF=Math.pow(2,bits)/2;
  const maxC=Math.max(3, Math.min(Math.floor(HALF*0.75), bits<=8?HALF-1:Math.floor(HALF/4)));
  const set=new Set();
  set.add(1);
  if(bits<=8){
    for(let v=2;v<=maxC;v++) set.add(v);
  } else {
    const steps=24;
    for(let i=1;i<=steps;i++){
      const v=Math.round(Math.exp((i/steps)*Math.log(maxC)));
      if(v>=1&&v<=maxC) set.add(v);
    }
  }
  return [...set].sort((a,b)=>a-b);
}

// ── Evaluierung ───────────────────────────────────────────────
function evalChosen(chosen, allPats) {
  const pats=chosen.map(a=>allPats[a].pat);
  let minSim=1,sumSim=0,pairs=0,dist=0;
  for(let i=0;i<chosen.length;i++)
    for(let j=i+1;j<chosen.length;j++){
      const s=sim(pats[i],pats[j]);
      if(s<minSim)minSim=s;
      sumSim+=s;pairs++;
      if(s<0.65)dist++;
    }
  const avgSim=pairs>0?sumSim/pairs:1;
  const allPerfect=(dist===pairs&&pairs>0);
  const score=(allPerfect?0.5:0)+(1-minSim)*0.35+(pairs>0?dist/pairs:0)*0.15;
  return {pats,minSim,avgSim,dist,total:pairs,allPerfect,score};
}

// ── Optimierer: erst alle trennbar, dann Score ────────────────
function optimizeLevel(lvl) {
  const {bits,patLen,steps,maxOps}=lvl;
  const paramSets=getParamSets(bits);
  const candidates=getCandidates(bits);

  // Structural units (2-Bit) are carry-only — no op recognition needed
  if(lvl.structural||lvl.maxOps===0){
    const params=paramSets[0];
    return {params,chosen:[1,2],pats:[[],[]], score:100,
      minSim:0,avgSim:0,dist:1,total:1,structural:true,
      spikeCounts:[0,0],allSpikes:[[],[]]};
  }

  let globalBest=null, globalScore=-1;

  for(const params of paramSets){
    const allPats={};
    for(const a of candidates){
      const sp=runUnit(a,bits,patLen,steps,params);
      allPats[a]={pat:spikePat(sp,patLen),count:sp.length,spikes:sp};
    }
    const valid=candidates.filter(a=>allPats[a].count>=1);
    const need=Math.min(maxOps,valid.length);
    if(need<2) continue;

    // Mehrere Startpunkte für bessere Abdeckung
    const starts=valid.slice(0, Math.min(5,valid.length));
    for(const start of starts){
      let chosen=[start];
      while(chosen.length<need){
        let bestAmp=-1, bestMinSim=1;
        for(const a of valid){
          if(chosen.includes(a)) continue;
          const minS=Math.min(...chosen.map(c=>sim(allPats[a].pat,allPats[c].pat)));
          if(minS<bestMinSim){bestMinSim=minS;bestAmp=a;}
        }
        if(bestAmp<0) break;
        chosen.push(bestAmp);
      }
      if(chosen.length<2) continue;
      const ev=evalChosen(chosen,allPats);
      if(ev.score>globalScore){
        globalScore=ev.score;
        const displayScore=ev.allPerfect
          ?Math.round(70+ev.minSim*0<1?30*(1-ev.minSim):30)
          :Math.round(ev.score*100);
        globalBest={
          params, chosen, pats:ev.pats,
          score:Math.max(1,Math.round((1-ev.minSim)*60+(ev.total>0?ev.dist/ev.total:0)*40)),
          minSim:ev.minSim, avgSim:ev.avgSim,
          dist:ev.dist, total:ev.total,
          spikeCounts:chosen.map(a=>allPats[a].count),
          allSpikes:chosen.map(a=>allPats[a].spikes),
        };
      }
    }
  }

  if(!globalBest){
    const params=paramSets[0];
    const chosen=candidates.slice(0,Math.min(maxOps,candidates.length));
    const pats=chosen.map(a=>spikePat(runUnit(a,bits,patLen,steps,params),patLen));
    globalBest={params,chosen,pats,score:0,minSim:1,avgSim:1,dist:0,total:0,
      spikeCounts:chosen.map(()=>0),allSpikes:chosen.map(()=>[])};
  }
  return globalBest;
}

// ── Carry Demo ────────────────────────────────────────────────
function cascadeAdd(value, bits) {
  const half=bits/2;
  const halfM=Math.pow(2,half);
  const mask=halfM-1;
  const lo=value&mask;
  const hi=(value>>>(half))&mask;
  const rawLo=lo+1;
  const carry=rawLo>=halfM?1:0;
  const newLo=rawLo&mask;
  const rawHi=hi+carry;
  const newCarry=rawHi>=halfM?1:0;
  const newHi=rawHi&mask;
  return {lo,hi,newLo,newHi,carry,finalCarry:newCarry,
    result:(newHi<<half)|newLo, half, halfM};
}

// ── Raster Canvas ─────────────────────────────────────────────
function Raster({spikes,patLen,color,w=200,h=12}) {
  const ref=useRef();
  useEffect(()=>{
    const c=ref.current; if(!c)return;
    const ctx=c.getContext("2d");
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle="rgba(255,255,255,0.02)"; ctx.fillRect(0,0,w,h);
    if(!patLen||patLen<2)return;
    spikes.forEach(t=>{
      if(t>=patLen)return;
      const x=1+(t/(patLen-1))*(w-2);
      ctx.strokeStyle=color; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(x,1); ctx.lineTo(x,h-1); ctx.stroke();
    });
  },[spikes,patLen,color,w,h]);
  return <canvas ref={ref} width={w} height={h} style={{width:w,height:h,display:"block"}}/>;
}

// ── Score Ring ────────────────────────────────────────────────
function ScoreRing({score,color,size=48}) {
  const r=17,cx=size/2,cy=size/2,circ=2*Math.PI*r;
  const dash=(Math.max(0,Math.min(100,score))/100)*circ;
  const sc=score>70?"#b8ff60":score>40?"#ffcc60":"#ff6060";
  if(score===100){
    // structural unit
    return (
      <svg width={size} height={size} style={{flexShrink:0}}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#ffcc6044" strokeWidth={3}/>
        <text x={cx} y={cy+4} textAnchor="middle" fontSize={14}
          fill="#ffcc60" fontFamily="monospace">⚑</text>
      </svg>
    );
  }
  return (
    <svg width={size} height={size} style={{flexShrink:0}}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={3}/>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={sc} strokeWidth={3}
        strokeDasharray={`${dash} ${circ}`} strokeDashoffset={circ/4} strokeLinecap="round"/>
      <text x={cx} y={cy+4} textAnchor="middle" fontSize={10}
        fill={sc} fontFamily="monospace" fontWeight="bold">{score}%</text>
    </svg>
  );
}

// ── Flow Diagramm ─────────────────────────────────────────────
function FlowDiagram({results}) {
  return (
    <div style={{background:"#0c0d14",borderRadius:8,padding:"12px 14px",
      border:"1px solid rgba(255,255,255,0.06)",marginBottom:10}}>
      <div style={{fontSize:8,color:"rgba(255,255,255,0.3)",letterSpacing:1,marginBottom:10}}>
        KASKADEN-ARCHITEKTUR · jede Stufe = 2× kleinere Units + Carry-Spike
      </div>
      <div style={{display:"flex",alignItems:"center",overflowX:"auto",paddingBottom:4}}>
        {LEVELS.map((l,i)=>{
          const r=results[l.bits];
          const score=r?.score??null;
          const sc=score===null?null:score>70?"#b8ff60":score>40?"#ffcc60":"#ff6060";
          return (
            <div key={l.bits} style={{display:"flex",alignItems:"center"}}>
              <div style={{textAlign:"center",minWidth:64}}>
                <div style={{width:52,height:52,borderRadius:8,margin:"0 auto 4px",
                  background:`${l.color}12`,
                  border:`2px solid ${score!==null?l.color+"88":l.color+"33"}`,
                  display:"flex",flexDirection:"column",alignItems:"center",
                  justifyContent:"center",gap:1}}>
                  <span style={{fontSize:9,color:l.color,fontWeight:"bold"}}>{l.name}</span>
                  {score!==null
                    ?<span style={{fontSize:8,color:sc}}>{score}%</span>
                    :<span style={{fontSize:8,color:"rgba(255,255,255,0.2)"}}>…</span>}
                </div>
                <div style={{fontSize:6,color:"rgba(255,255,255,0.2)"}}>
                  {l.states>1e9?`${(l.states/1e9).toFixed(1)}G`:
                   l.states>1e6?`${(l.states/1e6).toFixed(1)}M`:
                   l.states>1e3?`${(l.states/1e3).toFixed(0)}k`:l.states}
                </div>
              </div>
              {i<LEVELS.length-1&&(
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",minWidth:36}}>
                  <span style={{fontSize:8,color:"#ffcc60"}}>⚑</span>
                  <div style={{height:2,width:28,borderRadius:1,
                    background:`linear-gradient(90deg,${l.color}55,${LEVELS[i+1].color}55)`}}/>
                  <span style={{fontSize:6,color:"rgba(255,255,255,0.2)"}}>2×</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Level Karte ───────────────────────────────────────────────
function LevelCard({lvl,result,expanded,onToggle,prevLvl,cascVal}) {
  const cascade=useMemo(()=>{
    if(!lvl||lvl.bits<4)return null;
    const maxV=Math.pow(2,lvl.bits)-1;
    return cascadeAdd(cascVal&maxV, lvl.bits);
  },[lvl,cascVal]);

  const numOps=result?.chosen?.length??0;
  const allPerfect=result&&result.total>0&&result.dist===result.total;
  const sc=!result?null:result.score>70?"#b8ff60":result.score>40?"#ffcc60":"#ff6060";

  return (
    <div style={{borderRadius:10,overflow:"hidden",background:"#0c0d14",
      border:`1px solid ${result&&result.score>60?"#b8ff6044":lvl.color+"33"}`}}>

      {/* Header */}
      <div onClick={onToggle} style={{padding:"10px 14px",cursor:"pointer",
        background:expanded?`${lvl.color}08`:"transparent",
        display:"flex",alignItems:"center",gap:12}}>
        {result
          ?<ScoreRing score={result.score} color={lvl.color}/>
          :<div style={{width:48,height:48,borderRadius:"50%",flexShrink:0,
              border:"3px solid rgba(255,255,255,0.08)",
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:8,color:"rgba(255,255,255,0.2)"}}>…</div>}
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:2,flexWrap:"wrap"}}>
            <span style={{fontSize:12,color:lvl.color,fontWeight:"bold",letterSpacing:2}}>
              {lvl.name}
            </span>
            {result&&(result.structural
              ?<span style={{fontSize:8,color:"#ffcc60"}}>Carry-Baustein ⚑</span>
              :<span style={{fontSize:8,color:sc}}>
                {result.dist}/{result.total} trennbar {allPerfect?"✓":""}
              </span>
            )}
          </div>
          <div style={{fontSize:8,color:"rgba(255,255,255,0.25)"}}>
            {lvl.states.toLocaleString('de')} Zustände · PAT={lvl.patLen} · {lvl.example}
          </div>
          {result?.params&&(
            <div style={{fontSize:7,color:"rgba(255,255,255,0.2)",marginTop:1}}>
              gain {result.params.gainA.toFixed(2)}/{result.params.gainB.toFixed(2)} ·
              xor {result.params.xorA}/{result.params.xorB} ·
              op [{result.chosen.join(",")}]
            </div>
          )}
        </div>
        <span style={{fontSize:10,color:"rgba(255,255,255,0.3)",flexShrink:0}}>
          {expanded?"▲":"▼"}
        </span>
      </div>

      {/* Kaskaden-Verbindung */}
      {prevLvl&&result&&(
        <div style={{padding:"3px 14px 5px",
          borderTop:"1px solid rgba(255,255,255,0.04)",
          background:"rgba(255,204,96,0.03)"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{flex:1,height:1,
              background:`linear-gradient(90deg,${prevLvl.color}44,transparent)`}}/>
            <span style={{fontSize:8,color:"rgba(255,255,255,0.25)"}}>
              2× {prevLvl.name}{cascade?.carry?" ⚑ Carry":""} → {lvl.name}
            </span>
            <div style={{flex:1,height:1,
              background:`linear-gradient(90deg,transparent,${lvl.color}44)`}}/>
          </div>
        </div>
      )}

      {/* Detail */}
      {expanded&&result&&(
        <div style={{padding:"10px 14px",borderTop:`1px solid ${lvl.color}22`}}>

          {/* Stats */}
          <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
            {[
              {l:"Score",    v:`${result.score}%`, c:sc},
              {l:"Min Sep.", v:`${Math.round((1-result.minSim)*100)}%`, c:lvl.color},
              {l:"Ø Ähnl.",  v:`${Math.round(result.avgSim*100)}%`,    c:"rgba(255,255,255,0.5)"},
              {l:"Trennbar", v:`${result.dist}/${result.total}`,        c:allPerfect?"#b8ff60":"#ffcc60"},
            ].map(s=>(
              <div key={s.l} style={{background:"#08090d",borderRadius:5,padding:"5px 9px",textAlign:"center"}}>
                <div style={{fontSize:7,color:"rgba(255,255,255,0.3)"}}>{s.l}</div>
                <div style={{fontSize:13,color:s.c,fontWeight:"bold"}}>{s.v}</div>
              </div>
            ))}
          </div>

          {/* Parameter Info */}
          <div style={{background:"#08090d",borderRadius:5,padding:"6px 10px",
            marginBottom:10,fontSize:8,color:"rgba(255,255,255,0.3)",lineHeight:1.8}}>
            <span style={{color:lvl.color}}>Beste Parameter:</span>{" "}
            gainA={result.params.gainA.toFixed(2)} gainB={result.params.gainB.toFixed(2)}{" · "}
            xorA={result.params.xorA} xorB={result.params.xorB}{" · "}
            maskA={result.params.maskA} maskB={result.params.maskB}{" · "}
            fgain={result.params.fgain}
          </div>

          {/* Spike Muster — nur wenn nicht structural */}
          {!result.structural&&<div style={{display:"flex",flexDirection:"column",gap:3,marginBottom:10}}>
            {OPS_DEF.slice(0,numOps).map((op,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:9,color:op.color,minWidth:20}}>{op.symbol}</span>
                <span style={{fontSize:7,color:"rgba(255,255,255,0.2)",minWidth:30}}>
                  ={result.chosen[i]}
                </span>
                <div style={{flex:1,background:"#08090d",borderRadius:3,padding:"1px 3px"}}>
                  <Raster spikes={result.allSpikes[i]} patLen={lvl.patLen} color={op.color}/>
                </div>
                <span style={{fontSize:7,color:"rgba(255,255,255,0.2)",minWidth:22,textAlign:"right"}}>
                  {result.spikeCounts[i]}×
                </span>
              </div>
            ))}
          </div>}

          {/* Structural info */}
          {result.structural&&(
            <div style={{background:"rgba(255,204,96,0.08)",borderRadius:6,padding:"10px 12px",
              marginBottom:10,border:"1px solid #ffcc6033"}}>
              <div style={{fontSize:9,color:"#ffcc60",marginBottom:4}}>⚑ Carry-Baustein</div>
              <div style={{fontSize:8,color:"rgba(255,255,255,0.35)",lineHeight:1.8}}>
                2-Bit hat nur M=4 Zustände (−2,−1,0,1).<br/>
                Zu wenig Raum für Op-Erkennung — aber perfekt als<br/>
                Carry-Lieferant für die 4-Bit Stufe darüber.<br/>
                Overflow bei 1+1=2 → Carry-Spike → High-Unit.
              </div>
            </div>
          )}

          {/* Carry Demo */}
          {cascade&&(
            <div style={{background:"#08090d",borderRadius:6,padding:"8px 10px",
              border:"1px solid rgba(255,255,255,0.06)"}}>
              <div style={{fontSize:8,color:"rgba(255,255,255,0.3)",marginBottom:6,letterSpacing:1}}>
                CARRY DEMO · 2× {lvl.bits/2}-Bit Units
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                <div style={{background:`${prevLvl?.color||lvl.color}18`,borderRadius:4,
                  padding:"5px 9px",textAlign:"center",
                  border:`1px solid ${prevLvl?.color||lvl.color}33`}}>
                  <div style={{fontSize:7,color:"rgba(255,255,255,0.3)"}}>LOW {lvl.bits/2}-Bit</div>
                  <div style={{fontSize:12,fontFamily:"monospace",fontWeight:"bold",
                    color:prevLvl?.color||lvl.color}}>{cascade.lo} → {cascade.newLo}</div>
                  <div style={{fontSize:7,color:cascade.carry?"#ffcc60":"rgba(255,255,255,0.15)"}}>
                    {cascade.carry?"⚑ Carry!":"kein Carry"}
                  </div>
                </div>
                <div style={{fontSize:16,color:cascade.carry?"#ffcc60":"rgba(255,255,255,0.15)"}}>
                  {cascade.carry?"⚑":"→"}
                </div>
                <div style={{background:`${lvl.color}18`,borderRadius:4,padding:"5px 9px",
                  textAlign:"center",border:`1px solid ${lvl.color}33`}}>
                  <div style={{fontSize:7,color:"rgba(255,255,255,0.3)"}}>HIGH {lvl.bits/2}-Bit</div>
                  <div style={{fontSize:12,fontFamily:"monospace",fontWeight:"bold",color:lvl.color}}>
                    {cascade.hi}{cascade.carry
                      ?<span style={{color:"#ffcc60",fontSize:9}}>+1</span>:null}
                    {" → "}{cascade.newHi}
                  </div>
                </div>
                <span style={{fontSize:12,color:"rgba(255,255,255,0.2)"}}>→</span>
                <div style={{background:"rgba(184,255,96,0.08)",borderRadius:4,
                  padding:"5px 9px",textAlign:"center",
                  border:"1px solid rgba(184,255,96,0.2)"}}>
                  <div style={{fontSize:7,color:"rgba(255,255,255,0.3)"}}>{lvl.name}</div>
                  <div style={{fontSize:16,fontFamily:"monospace",fontWeight:"bold",color:"#b8ff60"}}>
                    {cascade.result}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────
export default function App() {
  const [phase,    setPhase]   = useState("idle");
  const [results,  setResults] = useState({});
  const [progress, setProgress]= useState(0);
  const [progName, setProgName]= useState("");
  const [expanded, setExpanded]= useState({});
  const [cascVal,  setCascVal] = useState(255);

  const totalScore=useMemo(()=>{
    const vals=Object.values(results).filter(r=>r&&!r.structural);
    return vals.length?Math.round(vals.reduce((s,r)=>s+r.score,0)/vals.length):0;
  },[results]);

  const start=async()=>{
    setPhase("running"); setResults({}); setProgress(0);
    const res={};
    for(let i=0;i<LEVELS.length;i++){
      const lvl=LEVELS[i];
      setProgName(lvl.name); setProgress(i);
      await new Promise(r=>setTimeout(r,30));
      res[lvl.bits]=optimizeLevel(lvl);
      setResults({...res});
    }
    setPhase("done"); setProgress(LEVELS.length);
  };

  return (
    <div style={{minHeight:"100vh",background:"#07080c",color:"#dde0e8",
      fontFamily:"'Courier New',monospace",padding:"20px 14px"}}>

      <div style={{marginBottom:14}}>
        <div style={{fontSize:12,letterSpacing:3,textTransform:"uppercase"}}>
          Emergente Kaskade · 2→4→8→16→32 Bit
        </div>
        <div style={{fontSize:9,color:"rgba(255,255,255,0.25)",marginTop:3,lineHeight:1.8}}>
          <span style={{color:"#ffcc60"}}>Bewährte Params skaliert</span> ·
          Parameter × opCodes gemeinsam optimiert ·
          <span style={{color:"#60c8ff"}}> 2× kleinere Units pro Stufe</span>
        </div>
      </div>

      {phase==="idle"&&(
        <div style={{textAlign:"center",padding:"30px 20px"}}>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",marginBottom:20,lineHeight:2.5}}>
            {LEVELS.map(l=>(
              <div key={l.bits} style={{display:"flex",alignItems:"center",
                justifyContent:"center",gap:10,marginBottom:2}}>
                <div style={{width:8,height:8,borderRadius:2,background:l.color}}/>
                <span style={{color:l.color,minWidth:52}}>{l.name}</span>
                <span style={{textAlign:"left"}}>
                  {l.states.toLocaleString('de')} Zust. · {l.maxOps} Ops · {l.example}
                </span>
              </div>
            ))}
          </div>
          <button onClick={start} style={{
            padding:"12px 36px",fontSize:12,letterSpacing:3,borderRadius:8,border:"none",
            cursor:"pointer",background:"#b8ff60",color:"#07080c",
            fontFamily:"monospace",fontWeight:"bold"
          }}>▶ Kaskade starten</button>
        </div>
      )}

      {(phase==="running"||phase==="done")&&(
        <>
          {phase==="running"&&(
            <div style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",
                fontSize:8,color:"rgba(255,255,255,0.3)",marginBottom:4}}>
                <span>Optimiere {progName}…</span>
                <span>{progress}/{LEVELS.length}</span>
              </div>
              <div style={{height:3,background:"rgba(255,255,255,0.07)",borderRadius:2}}>
                <div style={{width:`${(progress/LEVELS.length)*100}%`,height:"100%",borderRadius:2,
                  background:"linear-gradient(90deg,#ff6060,#ff9030,#ffcc60,#60c8ff,#b8ff60)",
                  transition:"width 0.3s"}}/>
              </div>
            </div>
          )}

          {Object.keys(results).length>=2&&<FlowDiagram results={results}/>}

          {phase==="done"&&(
            <div style={{background:"#0c0d14",borderRadius:8,padding:"10px 12px",
              marginBottom:10,border:"1px solid rgba(255,255,255,0.06)"}}>
              <div style={{fontSize:8,color:"rgba(255,255,255,0.3)",marginBottom:4}}>
                CARRY-DEMO WERT:{" "}
                <span style={{color:"#dde0e8",fontFamily:"monospace"}}>{cascVal}</span>
              </div>
              <input type="range" min={0} max={65535} step={1} value={cascVal}
                onChange={e=>setCascVal(parseInt(e.target.value))}
                style={{accentColor:"#ffcc60",width:"100%",marginBottom:5}}/>
              <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                {[3,7,15,63,255,1023,4095,65534].map(v=>(
                  <button key={v} onClick={()=>setCascVal(v)} style={{
                    padding:"2px 7px",fontSize:7,borderRadius:3,border:"none",cursor:"pointer",
                    fontFamily:"monospace",
                    background:cascVal===v?"#ffcc60":"rgba(255,255,255,0.07)",
                    color:cascVal===v?"#07080c":"rgba(255,255,255,0.4)"
                  }}>{v}</button>
                ))}
              </div>
            </div>
          )}

          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {LEVELS.map((lvl,i)=>(
              <LevelCard key={lvl.bits}
                lvl={lvl}
                result={results[lvl.bits]}
                expanded={!!expanded[lvl.bits]}
                onToggle={()=>setExpanded(e=>({...e,[lvl.bits]:!e[lvl.bits]}))}
                prevLvl={i>0?LEVELS[i-1]:null}
                cascVal={cascVal}/>
            ))}
          </div>

          {phase==="done"&&(
            <>
              <div style={{marginTop:12,background:"#0c0d14",borderRadius:8,
                padding:"12px 14px",border:"1px solid rgba(255,255,255,0.06)",
                fontSize:9,lineHeight:2.2,color:"rgba(255,255,255,0.35)"}}>
                <span style={{color:"#dde0e8",letterSpacing:2}}>FAZIT</span><br/>
                {LEVELS.map(l=>{
                  const r=results[l.bits];
                  if(!r)return null;
                  const sc=r.score>60?"#b8ff60":r.score>35?"#ffcc60":"#ff6060";
                  return (
                    <div key={l.bits}>
                      <span style={{color:l.color}}>{l.name}</span>:{" "}
                      <span style={{color:sc}}>{r.dist}/{r.total} · {r.score}%</span>
                      {" · "}op [{r.chosen.join(",")}]
                    </div>
                  );
                })}
                <div style={{marginTop:6,color:"rgba(255,255,255,0.6)"}}>
                  Ø Score:{" "}
                  <span style={{color:"#b8ff60",fontWeight:"bold"}}>{totalScore}%</span>
                </div>
              </div>
              <div style={{textAlign:"center",marginTop:10}}>
                <button onClick={()=>{setPhase("idle");setResults({});setExpanded({});}}
                  style={{padding:"5px 16px",fontSize:9,borderRadius:5,border:"none",cursor:"pointer",
                    fontFamily:"monospace",background:"rgba(255,255,255,0.06)",
                    color:"rgba(255,255,255,0.3)"}}>↺ neu</button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
