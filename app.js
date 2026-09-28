(() => {
'use strict';

const $ = id => document.getElementById(id);
const els = {
  symbol:$('symbol'), capital:$('capital'), start:$('start'), stop:$('stop'), demo:$('demoBtn'), read:$('readBtn'),
  conn:$('connection'), equity:$('equity'), trades:$('trades'), winrate:$('winrate'), pnl:$('sessionPnl'), price:$('price'),
  chart:$('chart'), candleStatus:$('candleStatus'), lastUpdate:$('lastUpdate'), consensus:$('consensus'), guardian:$('guardian'),
  engineState:$('engineState'), agents:$('agentGrid'), positions:$('positions'), feed:$('feed'), clear:$('clearHistory'), diagnostic:$('diagnostic')
};

const MAX_CANDLES = 240;
const HISTORY_LIMIT = 200;
const DEFAULT_CAPITAL = 50;
const AGENT_NAMES = ['Trend EMA','Momentum ROC','RSI 14','MACD','Breakout','Volatility','Volume','Mean Reversion','Structure','RiskGuardian'];
const STORAGE_KEY = 'trading-ai-v4-demo-history';

const state = {
  symbol:'btcusdt', candles:[], price:0, ws:null, reconnectTimer:null, connectionId:0,
  running:false, mode:'DEMO', capital:DEFAULT_CAPITAL, equity:DEFAULT_CAPITAL, position:null,
  trades:[], events:[], agents:[], lastClosedCandle:0, peak:DEFAULT_CAPITAL, drawdown:0, lastEvaluation:0
};

function fmt(n){ return Number(n||0).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function clamp(n,a,b){ return Math.max(a,Math.min(b,n)); }
function avg(a){ return a.length ? a.reduce((x,y)=>x+y,0)/a.length : null; }
function sma(a,n){ return a.length<n ? null : avg(a.slice(-n)); }
function ema(a,n){
  if(a.length<n) return null;
  let e=avg(a.slice(0,n)), k=2/(n+1);
  for(let i=n;i<a.length;i++) e=a[i]*k+e*(1-k);
  return e;
}
function std(a,n){ if(a.length<n)return null; const m=sma(a,n); return Math.sqrt(avg(a.slice(-n).map(x=>(x-m)**2))); }
function rsi(a,n=14){
  if(a.length<n+1)return null;
  let gain=0,loss=0;
  for(let i=a.length-n;i<a.length;i++){const d=a[i]-a[i-1]; if(d>0)gain+=d; else loss-=d;}
  if(loss===0)return 100;
  return 100-(100/(1+(gain/loss)));
}
function roc(a,n=10){ return a.length<n+1 ? null : (a.at(-1)/a.at(-1-n)-1)*100; }
function atr(c,n=14){
  if(c.length<n+1)return null;
  const tr=[];
  for(let i=1;i<c.length;i++) tr.push(Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c)));
  return sma(tr,n);
}
function macdSeries(a){
  if(a.length<35)return [];
  const out=[];
  for(let i=25;i<a.length;i++){
    const slice=a.slice(0,i+1), fast=ema(slice,12), slow=ema(slice,26);
    if(fast!=null&&slow!=null)out.push(fast-slow);
  }
  return out;
}
function closes(){ return state.candles.map(c=>c.c); }
function signal(x){ return x>0?'BUY':x<0?'SELL':'WAIT'; }
function scoreFor(sig){ return sig==='BUY'?1:sig==='SELL'?-1:0; }

function addEvent(text,type='info'){
  const now=new Date().toLocaleTimeString('it-IT');
  const last=state.events[0];
  if(last && last.text===text && Date.now()-last.ts<5000) return;
  state.events.unshift({time:now,ts:Date.now(),text,type});
  state.events=state.events.slice(0,60);
  renderEvents();
}
function setConnection(text,cls=''){ els.conn.textContent='● '+text; els.conn.className='status '+cls; }
function resetAgents(){
  state.agents=AGENT_NAMES.map(name=>({name,signal:name==='RiskGuardian'?'STANDBY':'WAIT',score:0,reason:'Attendo dati mercato'}));
  renderAgents();
}
function renderAgents(){
  els.agents.innerHTML=state.agents.map(a=>{
    const pct=Math.round(clamp(Math.abs(a.score)*100,0,100));
    const cls=a.signal.toLowerCase();
    return `<div class="agent"><div class="top"><span class="name">${a.name}</span><span class="sig ${cls}">${a.signal}</span></div><div class="reason">${a.reason}</div><div class="bar"><i class="${cls}bar" style="width:${pct}%"></i></div></div>`;
  }).join('');
}
function renderEvents(){
  if(!state.events.length){els.feed.innerHTML='<div class="muted">Nessun evento.</div>';return;}
  els.feed.innerHTML=state.events.map(e=>`<div class="trade"><div><small>${e.time}</small><strong>${e.text}</strong></div><div></div><div><small>${e.type.toUpperCase()}</small></div></div>`).join('');
}
function positionPnl(){
  if(!state.position||!state.price)return 0;
  const p=state.position, diff=p.side==='BUY'?state.price-p.entry:p.entry-state.price;
  return diff*p.qty;
}
function renderPosition(){
  if(!state.position){els.positions.innerHTML='Nessuna posizione';return;}
  const p=state.position, pnl=positionPnl(), cls=pnl>=0?'up':'down';
  els.positions.innerHTML=`<div class="position"><div class="posgrid">
    <div><b>DIR</b><span>${p.side}</span></div><div><b>ENTRY</b><span>${fmt(p.entry)}</span></div><div><b>QTY</b><span>${p.qty.toFixed(6)}</span></div>
    <div><b>SL</b><span>${fmt(p.sl)}</span></div><div><b>TP</b><span>${fmt(p.tp)}</span></div><div><b>LIVE P&L</b><span class="${cls}">€${fmt(pnl)}</span></div>
  </div><div class="muted" style="margin-top:7px">Consenso ${p.votes}/9 • ${p.reason}</div></div>`;
}
function renderStats(){
  const wins=state.trades.filter(t=>t.pnl>0).length, closed=state.trades.length, live=positionPnl(), total=state.equity+live;
  els.equity.textContent='€'+fmt(total); els.trades.textContent=closed; els.winrate.textContent=closed?Math.round(wins/closed*100)+'%':'—';
  const p=total-state.capital; els.pnl.textContent='P&L €'+fmt(p); els.pnl.className=p>=0?'up':'down';
}
function renderHistory(){
  if(!state.trades.length){ els.feed.innerHTML='<div class="muted">Nessun trade chiuso.</div>'; return; }
  els.feed.innerHTML=state.trades.map(t=>`<div class="trade"><div><small>${t.time}</small><strong>${t.side} • ${t.reason}</strong></div><div><small>ENTRY → EXIT</small><strong>${fmt(t.entry)} → ${fmt(t.exit)}</strong></div><div><small>P&L</small><strong class="pnl ${t.pnl>=0?'up':'down'}">€${fmt(t.pnl)}</strong></div></div>`).join('');
}
function saveHistory(){ try{localStorage.setItem(STORAGE_KEY,JSON.stringify({trades:state.trades,equity:state.equity,capital:state.capital,peak:state.peak}));}catch(e){} }
function loadSaved(){
  try{
    const x=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
    if(x&&Array.isArray(x.trades)){state.trades=x.trades.slice(0,100);state.equity=Number(x.equity)||DEFAULT_CAPITAL;state.capital=Number(x.capital)||DEFAULT_CAPITAL;state.peak=Number(x.peak)||state.equity;els.capital.value=state.capital;}
  }catch(e){}
}

function renderChart(){
  const c=els.chart; if(!c)return;
  const ctx=c.getContext('2d'); if(!ctx)return;
  const rect=c.getBoundingClientRect(), dpr=Math.max(1,window.devicePixelRatio||1);
  const w=Math.max(280,Math.floor(rect.width||c.parentElement?.clientWidth||320));
  const h=190;
  c.style.width='100%'; c.style.height=h+'px';
  if(c.width!==Math.floor(w*dpr)||c.height!==Math.floor(h*dpr)){c.width=Math.floor(w*dpr);c.height=Math.floor(h*dpr);}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const data=state.candles.slice(-100); if(data.length<2){return;}
  const vals=data.map(x=>Number(x.c)).filter(Number.isFinite);
  const min=Math.min(...vals),max=Math.max(...vals),span=Math.max(max-min,0.0000001),pad=10;
  ctx.strokeStyle='#202020';ctx.lineWidth=1;
  for(let i=1;i<4;i++){const y=i*h/4;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  ctx.beginPath();
  data.forEach((item,i)=>{const v=Number(item.c);const x=pad+i*(w-pad*2)/(data.length-1);const y=h-pad-(v-min)/span*(h-pad*2);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});
  ctx.strokeStyle='#ff7a18';ctx.lineWidth=2.2;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();
  ctx.fillStyle='#ff7a18';const last=data.at(-1);const lx=w-pad,ly=h-pad-(Number(last.c)-min)/span*(h-pad*2);ctx.beginPath();ctx.arc(lx,ly,3,0,Math.PI*2);ctx.fill();
  if(state.position){const py=h-pad-(state.position.entry-min)/span*(h-pad*2);ctx.strokeStyle='#777';ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(0,py);ctx.lineTo(w,py);ctx.stroke();ctx.setLineDash([]);}
}

async function loadHistory(){
  const symbol=state.symbol.toUpperCase();
  els.candleStatus.textContent='Caricamento 200 candele reali…';
  try{
    const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=${HISTORY_LIMIT}`,{cache:'no-store'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const arr=await r.json();
    if(!Array.isArray(arr)||arr.length<60)throw new Error('Dati insufficienti');
    state.candles=arr.map(k=>({t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]}));
    state.price=state.candles.at(-1).c;state.lastClosedCandle=state.candles.at(-1).t;
    els.price.textContent=state.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    els.candleStatus.textContent=`${state.candles.length} candele • dati reali`;
    evaluate(false);renderChart();setTimeout(renderChart,50);return true;
  }catch(e){
    els.candleStatus.textContent='Errore dati mercato';addEvent('Errore caricamento candele: '+e.message,'error');return false;
  }
}

function disconnect(){
  state.connectionId++;
  clearTimeout(state.reconnectTimer);state.reconnectTimer=null;
  if(state.ws){try{state.ws.onclose=null;state.ws.close();}catch(e){}state.ws=null;}
}
function connect(){
  disconnect(); const id=state.connectionId, stream=`${state.symbol}@kline_1m`;
  let ws;
  try{ws=new WebSocket(`wss://stream.binance.com:9443/ws/${stream}`);}catch(e){setConnection('errore','err');addEvent('WebSocket: '+e.message,'error');return;}
  state.ws=ws;setConnection('connecting');
  ws.onopen=()=>{if(id!==state.connectionId)return;setConnection('LIVE','live');addEvent('WebSocket LIVE • '+state.symbol.toUpperCase(),'live');};
  ws.onmessage=e=>{
    if(id!==state.connectionId)return;
    try{
      const d=JSON.parse(e.data),k=d.k;if(!k)return;
      const candle={t:+k.t,o:+k.o,h:+k.h,l:+k.l,c:+k.c,v:+k.v};
      const idx=state.candles.findIndex(x=>x.t===candle.t); if(idx>=0)state.candles[idx]=candle;else{state.candles.push(candle);if(state.candles.length>MAX_CANDLES)state.candles.shift();}
      state.price=candle.c;els.price.textContent=state.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});els.lastUpdate.textContent='agg. '+new Date().toLocaleTimeString('it-IT');els.candleStatus.textContent=`${state.candles.length} candele • ${k.x?'chiusa':'in corso'}`;
      if(k.x&&candle.t!==state.lastClosedCandle){state.lastClosedCandle=candle.t;evaluate(true);}
      checkPosition();renderPosition();renderStats();renderChart();
    }catch(err){addEvent('Errore elaborazione WebSocket','error');}
  };
  ws.onerror=()=>{if(id===state.connectionId)setConnection('errore','err');};
  ws.onclose=()=>{if(id!==state.connectionId)return;setConnection('reconnecting','err');clearTimeout(state.reconnectTimer);state.reconnectTimer=setTimeout(()=>connect(),3000);};
}

function evaluate(closed){
  if(state.candles.length<60)return;
  const c=state.candles,a=closes(),last=a.at(-1),prev=a.at(-2);
  const e9=ema(a,9),e21=ema(a,21),e50=ema(a,50),r=rsi(a),ro=roc(a),m=macdSeries(a),mac=m.at(-1),macSig=ema(m,9);
  const bbm=sma(a,20),sd=std(a,20),upper=bbm+2*sd,lower=bbm-2*sd,at=atr(c),avgVol=sma(c.map(x=>x.v),20);
  const recentHigh=Math.max(...a.slice(-21,-1)),recentLow=Math.min(...a.slice(-21,-1));
  const body=last-prev, range=Math.max(last-prev,0);
  const signals=[], reasons=[];
  // 1 Trend: three EMA alignment, with neutral zone around EMA21 to avoid noise.
  signals.push(e9>e21&&e21>e50?'BUY':e9<e21&&e21<e50?'SELL':'WAIT'); reasons.push(`EMA 9/21/50 ${e9>e21&&e21>e50?'rialzista':e9<e21&&e21<e50?'ribassista':'mista'}`);
  // 2 Momentum: ROC with adaptive threshold.
  signals.push(ro>0.08?'BUY':ro<-0.08?'SELL':'WAIT'); reasons.push(`ROC ${ro.toFixed(2)}%`);
  // 3 RSI: only extreme zones, so it does not fight every trend candle.
  signals.push(r<30?'BUY':r>70?'SELL':'WAIT'); reasons.push(`RSI ${r.toFixed(1)}`);
  // 4 MACD: histogram direction.
  const hist=mac-macSig; signals.push(hist>0?'BUY':hist<0?'SELL':'WAIT'); reasons.push(`MACD hist ${hist.toFixed(4)}`);
  // 5 Breakout: confirmed close beyond recent 20-candle range.
  signals.push(last>recentHigh?'BUY':last<recentLow?'SELL':'WAIT'); reasons.push(last>recentHigh?'Breakout massimo':'');
  if(last<recentLow)reasons[4]='Breakout minimo'; if(last>=recentLow&&last<=recentHigh)reasons[4]='Nessun breakout';
  // 6 Volatility: direction comes from candle/EMA, but agent stays neutral in excessive volatility.
  const vol=at/last; const volDir=e9>e21?'BUY':e9<e21?'SELL':'WAIT';
  signals.push(vol>0.007?'WAIT':volDir); reasons.push(`ATR ${(vol*100).toFixed(2)}%`);
  // 7 Volume confirmation.
  const volNow=lastCandle().v; signals.push(volNow>avgVol*1.10 ? (body>0?'BUY':body<0?'SELL':'WAIT'):'WAIT'); reasons.push(`Volume ${(volNow/avgVol).toFixed(2)}x media`);
  // 8 Mean reversion: extreme Bollinger only.
  signals.push(last<lower?'BUY':last>upper?'SELL':'WAIT'); reasons.push(last<lower?'Sotto Bollinger':last>upper?'Sopra Bollinger':'Dentro Bollinger');
  // 9 Structure: two consecutive higher/lower closes plus higher/lower recent swing.
  const p2=a.at(-3),p3=a.at(-4); signals.push(last>prev&&prev>p2&&p2>p3?'BUY':last<prev&&prev<p2&&p2<p3?'SELL':'WAIT'); reasons.push(signals[8]==='BUY'?'Higher highs':signals[8]==='SELL'?'Lower lows':'Struttura mista');

  const votesBuy=signals.filter(x=>x==='BUY').length,votesSell=signals.filter(x=>x==='SELL').length;
  const direction=votesBuy>votesSell?'BUY':votesSell>votesBuy?'SELL':'WAIT';
  const votes=Math.max(votesBuy,votesSell);
  const guardian=guardianCheck(at,last,votes,direction,signals);
  state.agents=signals.map((x,i)=>({name:AGENT_NAMES[i],signal:x,score:scoreFor(x),reason:reasons[i]}));
  state.agents.push({name:'RiskGuardian',signal:guardian.ok?'APPROVED':'BLOCKED',score:guardian.ok?0.75:0,reason:guardian.reason});
  renderAgents();els.consensus.textContent=`${direction} ${votes}/9`;els.consensus.className=direction==='BUY'?'good':direction==='SELL'?'bad':'';els.engineState.title=closed?'Segnale valutato su candela chiusa':'Segnale iniziale; attendo chiusura candela';els.guardian.textContent=guardian.ok?'APPROVED':'BLOCKED';els.guardian.className=guardian.ok?'good':'warn';
  if(closed&&state.running&&state.mode==='DEMO'&&!state.position&&direction!=='WAIT'&&votes>=5&&guardian.ok)openPosition(direction,at,votes,guardian);
  state.lastEvaluation=Date.now();
}
function lastCandle(){return state.candles.at(-1);}
function guardianCheck(at,last,votes,direction,signals){
  if(direction==='WAIT')return {ok:false,reason:'Consenso diviso'};
  if(votes<5)return {ok:false,reason:`Consenso ${votes}/9 < 5`};
  if(!at||at<=0)return {ok:false,reason:'ATR non disponibile'};
  const vol=at/last;
  if(vol>0.007)return {ok:false,reason:`Volatilità alta ${ (vol*100).toFixed(2)}%`};
  if(state.equity<=state.capital*0.85)return {ok:false,reason:'Drawdown limite 15%'};
  const opposing=signals.filter(x=>x!==direction&&x!=='WAIT').length;
  if(opposing>=4)return {ok:false,reason:`Troppi segnali contrari (${opposing})`};
  return {ok:true,reason:`Rischio OK • ${votes}/9 • ATR ${(vol*100).toFixed(2)}%`};
}
function openPosition(side,at,votes,guardian){
  const equity=state.equity,riskCash=Math.max(equity*0.01,0.10),entry=state.price;
  const stopPct=clamp((at/entry)*1.6,0.0025,0.008),targetPct=stopPct*1.8;
  const qty=Math.min(riskCash/(entry*stopPct),(equity*0.95)/entry);
  if(!Number.isFinite(qty)||qty<=0)return;
  state.position={side,entry,qty,sl:side==='BUY'?entry*(1-stopPct):entry*(1+stopPct),tp:side==='BUY'?entry*(1+targetPct):entry*(1-targetPct),votes,reason:guardian.reason,openedAt:Date.now()};
  addEvent(`${side} APERTA @ ${fmt(entry)} • consenso ${votes}/9`,'open');renderPosition();renderStats();
}
function closePosition(reason,exit){
  if(!state.position)return;
  const p=state.position,price=exit||state.price,pnl=(p.side==='BUY'?price-p.entry:p.entry-price)*p.qty;
  state.equity+=pnl;state.peak=Math.max(state.peak,state.equity);state.drawdown=(state.peak-state.equity)/state.peak;
  state.trades.unshift({time:new Date().toLocaleString('it-IT'),side:p.side,entry:p.entry,exit:price,pnl,reason});state.trades=state.trades.slice(0,100);state.position=null;saveHistory();
  addEvent(`${p.side} CHIUSA ${reason} • P&L €${fmt(pnl)}`,pnl>=0?'win':'loss');renderPosition();renderStats();
}
function checkPosition(){
  const p=state.position;if(!p)return;
  if(p.side==='BUY'){if(state.price<=p.sl)closePosition('STOP LOSS',p.sl);else if(state.price>=p.tp)closePosition('TAKE PROFIT',p.tp);}
  else {if(state.price>=p.sl)closePosition('STOP LOSS',p.sl);else if(state.price<=p.tp)closePosition('TAKE PROFIT',p.tp);}
}
function start(){
  if(state.mode!=='DEMO'){addEvent('Seleziona DEMO per avviare il motore','warn');return;}
  if(state.running)return;
  const cap=Math.max(10,Number(els.capital.value)||50);
  if(state.trades.length===0){state.capital=cap;state.equity=cap;state.peak=cap;saveHistory();}
  state.running=true;els.engineState.textContent='ATTIVO';els.engineState.className='good';addEvent('BOT STARTED • DEMO • 9 AGENTI + RISKGUARDIAN','start');evaluate(false);
}
function stop(){if(!state.running)return;state.running=false;els.engineState.textContent='FERMO';els.engineState.className='warn';addEvent('BOT STOPPED','stop');}
async function changeSymbol(){
  stop();disconnect();state.symbol=els.symbol.value;state.candles=[];state.position=null;resetAgents();await loadHistory();connect();
}
function runDiagnostic(){
  const old={candles:state.candles,price:state.price,running:state.running,position:state.position,equity:state.equity,capital:state.capital};
  const candles=[];let p=100;
  for(let i=0;i<120;i++){const drift=i<70?0.0012:0.0007;p*=1+drift+(Math.sin(i*1.7)*0.0003);candles.push({t:i,o:p/(1+drift),h:p*1.0008,l:p*0.9992,c:p,v:1000+(i%9)*100});}
  state.candles=candles;state.price=p;state.running=true;state.position=null;state.equity=50;state.capital=50;evaluate(true);
  const signalState=state.agents.map(a=>a.signal).join(',');const opened=!!state.position;
  if(opened){state.price=state.position.tp;checkPosition();}
  const passed=opened&&state.trades.length===1&&Number.isFinite(state.trades[0].pnl);
  state.candles=old.candles;state.price=old.price;state.running=old.running;state.position=old.position;state.equity=old.equity;state.capital=old.capital;renderAgents();renderPosition();renderStats();
  els.diagnostic.textContent=passed?'ENGINE TEST OK':'ENGINE TEST FALLITO';els.diagnostic.className=passed?'good':'bad';addEvent(passed?'TEST ENGINE OK • segnali → posizione → TP → P&L':'TEST ENGINE FALLITO • controllare logica','test');
  console.log('V4 diagnostic', {passed,signalState});
}

els.start.onclick=start;els.stop.onclick=stop;els.symbol.onchange=changeSymbol;
els.demo.onclick=()=>{state.mode='DEMO';els.demo.classList.add('active');els.read.classList.remove('active');addEvent('MODALITÀ DEMO ATTIVA','info');};
els.read.onclick=()=>{state.mode='LIVE READONLY';els.read.classList.add('active');els.demo.classList.remove('active');stop();addEvent('LIVE READONLY • nessun ordine reale','info');};
els.clear.onclick=()=>{state.trades=[];state.equity=state.capital;state.peak=state.capital;saveHistory();renderStats();renderHistory();addEvent('Storico trade resettato','info');};
if(els.diagnostic)els.diagnostic.onclick=runDiagnostic;
window.addEventListener('resize',renderChart);
loadSaved();
if(new URLSearchParams(location.search).has('selftest')) setTimeout(runDiagnostic,400);resetAgents();renderHistory();renderStats();
(async()=>{const ok=await loadHistory();if(ok)connect();})();
})();
