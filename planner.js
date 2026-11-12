// Pure trip optimizer (no DOM). Used by app.js; testable in node.
(function(G){
const STOP_PENALTY=5,STOP_HR=15,OVERCAP=0.3,STOP_OVH=0.15,EST_W=0.1,TIME_W=0.25,OUT_W=0.06; // $ per extra stop; $ per hour of trip time; $/kWh ranking nudge for arriving outside a known station's priced hours
const hl=h=>{h=((h%24)+24)%24;return h==0?'12 AM':h==12?'12 PM':h<12?h+' AM':(h-12)+' PM'};
// contiguous runs of hours (wrapping past midnight) -> [[start,end)...]
function runs(hrs){const S=new Set(hrs);if(!S.size)return [];if(S.size==24)return [[0,24]];const out=[];
 for(let i=0;i<24;i++)if(S.has(i)&&!S.has((i+23)%24)){let e=i;while(S.has(e%24))e++;out.push([i,e%24])}return out}
function windows(h){const m=Math.min(...h),hrs=[...Array(24).keys()].filter(i=>h[i]<=m+1e-9);
 return [m,runs(hrs).map(([s,e])=>s==0&&e==24?'All day':`${hl(s)}–${hl(e)}`)]}
// cheapest known window as hour list
function cheapHours(hourly){const k=hourly.filter(v=>v!=null);if(!k.length)return [];const m=Math.min(...k);return [...Array(24).keys()].filter(i=>hourly[i]!=null&&hourly[i]<=m+1e-9)}
function offHours(hourly){const k=hourly.filter(v=>v!=null);if(!k.length)return [];const m=Math.min(...k);return [...Array(24).keys()].filter(i=>hourly[i]!=null&&hourly[i]<=m*1.25+1e-9)}
function knownSpan(hourly){const hrs=[...Array(24).keys()].filter(i=>hourly[i]!=null);if(!hrs.length)return null;
 let s=hrs.find(i=>hourly[(i+23)%24]==null);if(s==null)return [0,24];let e=s;while(hourly[e%24]!=null&&e<s+24)e++;return [s,e%24]}
function penaltyRate(near){const v=[];near.forEach(s=>{if(s.price){const k=s.price.hourly.filter(x=>x!=null);if(k.length)v.push(k.reduce((a,b)=>a+b,0)/k.length)}});
 return v.length?+(v.reduce((a,b)=>a+b,0)/v.length*1.2).toFixed(3):0.45}
// Calibrated to Noel's real sessions (1.5-3.4 kWh/min). Tesla curve: full power to ~50%, tapering to ~45% at 80%, ~15% at 100%.
// kw: site max (V2 150 / V3 250). +3 min per stop for parking/plug-in.
const SPEED_F=1.3; // OSRM demo durations average ~56 mph on I-15; real Tesla trips run ~73 mph
function kwAt(soc,P){return soc<50?P:soc<80?P*(1-.55*(soc-50)/30):P*(.45-.3*(soc-80)/20)}
const CUM=[0];for(let i=0;i<1000;i++)CUM.push(CUM[i]+0.1/kwAt(i/10+.05,1)); // time per (kWh/%) at P=1, 0.1% steps
const cumAt=x=>{x=Math.max(0,Math.min(100,x))*10;const i=Math.min(999,Math.floor(x));return CUM[i]+(CUM[i+1]-CUM[i])*(x-i)};
function chargeHours(kwh,fromPct,toPct,kw){if(kwh<=0||toPct<=fromPct)return 0;const P=Math.min(Math.max(kw||250,150),250)*.85;
 return kwh/(toPct-fromPct)*(cumAt(toPct)-cumAt(fromPct))/P+0.05}
// Known station outside its recorded hours: use its known (cheapest) rate as best estimate, flagged 'outside',
// instead of the generic unknown estimate, so stations from history still beat unknown ones.
function rateAt(s,h,pen){const H=Math.floor(((h%24)+24)%24),v=s.price?s.price.hourly[H]:null;if(v!=null)return {rate:v,est:false};if(s.guess&&s.guess[H]!=null)return {rate:s.guess[H],est:true};
 const k=s.price?s.price.hourly.filter(x=>x!=null):[];return k.length?{rate:Math.min(...k),est:false,outside:true}:{rate:pen,est:true}}
// Opening hours: s.open=[start,end) 24h clock, fractional ok (4.5=4:30), may wrap. Stop allowed only if arrival..departure fits inside.
function isOpen(s,eta,dep){if(!s.open)return true;const a=s.open[0],b=s.open[1],len=a==b?24:((b-a)%24+24)%24,off=((eta-a)%24+24)%24;return off+(dep-eta)<=len+1e-9}
const openTxt=s=>s.open?`${fh(s.open[0])}–${fh(s.open[1])}`:''
// near: [{id,name,mile,kw,price,...}] sorted by mile. o: {total,speed,rng,batt,kpm,buf,chg,dep}
function optimize(near,o){const {total,speed,rng,batt,buf,dep}=o,cap=rng*(o.kpm||.3),fin=o.finish||null,pen=penaltyRate(fin?near.concat([fin.site]):near);
 const goal=fin?fin.site.mile:total;const st=near.filter(s=>s.mile>1&&s.mile<goal-1&&(!fin||s.id!==fin.site.id));const N=st.length,LV=[];const MX=Math.min(100,o.max||90);for(let l=20;l<=MX;l+=10)LV.push(l);if(!LV.includes(MX))LV.push(MX);for(let l=MX+5;l<100;l+=5)LV.push(l);if(MX<100)LV.push(100);
 // state key: node index (-1 start) + depart level. Dijkstra on cost.
 const best=new Map(),H=[];let seq=0;
 const hp=x=>{H.push(x);let i=H.length-1;while(i){const p=(i-1)>>1;if(H[p].score<=H[i].score)break;[H[p],H[i]]=[H[i],H[p]];i=p}};
 const hpop=()=>{const t=H[0],e=H.pop();if(H.length){H[0]=e;let i=0;for(;;){const l=2*i+1,r=l+1;let m=i;if(l<H.length&&H[l].score<H[m].score)m=l;if(r<H.length&&H[r].score<H[m].score)m=r;if(m==i)break;[H[m],H[i]]=[H[i],H[m]];i=m}}return t};
 const push=x=>{const k=x.node+':'+x.lvl;const b=best.get(k);if(b&&b.score<=x.score)return;best.set(k,x);hp(x)};
 push({node:-1,lvl:batt,mile:0,t:dep,cost:0,score:0,n:0,stop:null,par:null,soc:batt});let done=null;
 while(H.length){const x=hpop();
  if(best.get(x.node+':'+x.lvl)!==x)continue;
  if(x.node==='D'){done=x;break}
  const reach=x.mile+(x.soc-buf)/100*rng;
  if(reach>=goal){if(!fin){const tt=x.t+(total-x.mile)/speed;push({node:'D',lvl:0,mile:total,t:tt,cost:x.cost,n:x.n,score:x.score-TIME_W*(x.t-dep)+TIME_W*(tt-dep),stop:null,par:x,soc:x.soc-(total-x.mile)/rng*100});}
   else{const s=fin.site,arr=x.soc-(s.mile-x.mile)/rng*100,eta=x.t+(s.mile-x.mile)/speed,r=rateAt(s,eta,pen),L=Math.max(fin.to,arr),kwh=(L-arr)/100*cap,c=kwh*r.rate,ch=chargeHours(kwh,arr,L,s.kw),t2=eta+ch,tt=t2+fin.toDest/speed;
    if(isOpen(s,eta,t2))push({node:'D',lvl:0,mile:total,t:tt,cost:x.cost+c,n:x.n+1,score:x.score-TIME_W*(x.t-dep)+c+(r.outside?OUT_W*kwh:0)+TIME_W*(tt-dep),par:{par:x,stop:{s,arr,L,kwh,eta,ch,r,c,final:true}},stop:null,soc:L-fin.toDest/rng*100})}}
  for(let j=(x.node===-1?0:x.node+1);j<N;j++){const s=st[j];if(s.mile>reach)break;if(s.mile<=x.mile+1)continue;
   const arr=x.soc-(s.mile-x.mile)/rng*100,eta=x.t+(s.mile-x.mile)/speed,need=buf+(total-s.mile)/rng*100,r=rateAt(s,eta,pen);
   const tg=new Set(LV.filter(l=>l>arr+2));if(need>arr+2&&need<=100)tg.add(Math.ceil(need));
   for(const L of tg){const kwh=(L-arr)/100*cap,c=kwh*r.rate,ch=chargeHours(kwh,arr,L,s.kw),t2=eta+ch;if(!isOpen(s,eta,t2))continue;const cost=x.cost+c,n=x.n+1,score=x.score-TIME_W*(x.t-dep)+c+(r.outside?OUT_W*kwh:0)+(r.est?EST_W*kwh:0)+STOP_PENALTY+STOP_HR*STOP_OVH+OVERCAP*Math.max(0,L-MX)+TIME_W*(t2-dep);
    const k=j+':'+Math.round(L),b=best.get(k);if(b&&b.score<=score)continue;
    push({node:j,lvl:Math.round(L),mile:s.mile,t:t2,cost,n,score,par:x,soc:L,stop:{s,arr,L,kwh,eta,ch,r,c}})}}}
 if(done){const out=[];for(let p=done;p;p=p.par)if(p.stop){const {s,arr,L,kwh,eta,ch,r,c,final}=p.stop;
  out.unshift({...s,final:!!final,arrive_pct:Math.round(arr),target_pct:Math.round(L),kwh:+kwh.toFixed(1),eta:+(eta%24).toFixed(2),eta_abs:eta,charge_h:+ch.toFixed(2),rate:r.rate,rate_est:r.est,rate_outside:!!r.outside,cost:+c.toFixed(2)})}done.stops=out}
 if(!done){const hi=buf>=(o.chg||80)||buf>=batt;return {error:hi?`Min. battery at each stop (${buf}%) is too high${buf>=batt?` (your battery is only ${batt}%)`:''}. Try 10–20%. To charge at your destination, use the Finish at a Supercharger option.`
  :`No charging plan found with a ${buf}% minimum at each stop (gap between Superchargers too large). Try a lower minimum or a higher Range/Battery.`,penalty:pen}}
 done.stops.forEach(s=>{s.warn=offPeakWarn(s);if(s.open)s.open_note=`Open ${openTxt(s)} (arrival to departure fits within these hours).`;if(!s.final&&s.target_pct>MX)s.cap_note=`Charging to ${s.target_pct}% (above your ${MX}% max) to skip an extra stop.`});
 return {stops:done.stops,total_cost:+done.cost.toFixed(2),arrive_pct:Math.round(done.soc),arrive_time:done.t,penalty:pen,has_est:done.stops.some(s=>s.rate_est),has_outside:done.stops.some(s=>s.rate_outside)}}
function fh(h){h=((h%24)+24)%24;let t=Math.round(h*60)%1440;const H=Math.floor(t/60),m=t%60;return (H%12||12)+':'+String(m).padStart(2,'0')+(H<12?' AM':' PM')}
const DEF_OP=[23,8]; // default off-peak 11 PM-8 AM (wraps midnight)
function cheapRun(s,H){const ch=s.price?cheapHours(s.price.hourly):[];const rs=runs(ch);if(!rs.length)return knownSpan(s.price.hourly)||DEF_OP;
 return rs.find(r=>r[0]<=r[1]?false:true)||rs.sort((a,b)=>((b[1]-b[0]+24)%24)-((a[1]-a[0]+24)%24))[0]}
function offPeakWarn(s){if(!s.price)return null;const H=Math.floor(((s.eta%24)+24)%24),ch=offHours(s.price.hourly);
 if(ch.includes(H))return null;const cw=cheapRun(s);
 const known=s.price.hourly[H]!=null;
 return `Arrives ${fh(s.eta)}, outside ${known?'the cheapest window':'off-peak'} (${hl(cw[0])}–${hl(cw[1])}). ${known?'Price may be higher.':`Using your off-peak rate $${Math.min(...s.price.hourly.filter(x=>x!=null)).toFixed(2)}/kWh as a best guess; it is likely higher at this hour.`}`}
// alternatives for each leg: stations between previous stop and next stop/dest, ranked by est cost of the same charge
function alternatives(near,res,o){const pen=res.penalty,cap=o.rng*(o.kpm||.3);let prev={mile:0,t:o.dep,soc:o.batt};
 return res.stops.map((p,i)=>{if(p.final)return [];const nxt=i+1<res.stops.length?res.stops[i+1].mile:o.total,reach=prev.mile+(prev.soc-o.buf)/100*o.rng;
  const alts=near.filter(s=>s.mile>prev.mile+1&&s.mile<=reach&&s.mile<nxt).map(s=>{const arr=prev.soc-(s.mile-prev.mile)/o.rng*100,
   need=o.buf+(nxt-s.mile)/o.rng*100,L=Math.min(Math.min(100,o.max||90),Math.max(need,p.target_pct,arr)),kwh=Math.max(L-arr,0)/100*cap,eta=prev.t+(s.mile-prev.mile)/o.speed,r=rateAt(s,eta,pen);
   const ch=chargeHours(kwh,arr,L,s.kw),a={...s,closed:!isOpen(s,eta,eta+ch),arrive_pct:Math.round(arr),target_pct:Math.round(L),kwh:+kwh.toFixed(1),eta:+(eta%24).toFixed(2),rate:r.rate,rate_est:r.est,rate_outside:!!r.outside,cost:+(kwh*r.rate).toFixed(2)};a.warn=offPeakWarn(a);if(a.closed)a.closed_note=`Closed during this visit (open ${openTxt(s)}); not used in the plan.`;return a}).sort((a,b)=>(a.closed?1:0)-(b.closed?1:0)||(a.cost+(a.rate_outside?OUT_W*a.kwh:0))-(b.cost+(b.rate_outside?OUT_W*b.kwh:0)));
  prev={mile:p.mile,t:p.eta_abs+p.charge_h,soc:p.target_pct};return alts})}
// Search departures in 15-min steps over 24h. Rank: fewest off-peak misses, then cost score (within $0.50),
// then first stop closest after its off-peak start (ideally right at it), then latest departure.
function bestDeparture(near,o,cur){const sc=r=>r.total_cost+r.stops.filter(s=>s.rate_outside||s.rate_est).reduce((a,s)=>a+s.kwh*0.1,0)+r.stops.filter(s=>s.warn).length*2;
 const base=Math.floor(o.dep*4)/4,C=[];
 for(let q=0;q<96;q++){const d=(q/4)%24;const r=optimize(near,{...o,dep:d});if(r.error||!r.stops.length)continue;
  const f=r.stops[0],ws=f.price?cheapRun(f)[0]:DEF_OP[0],lag=((f.eta_abs-ws)%24+24)%24;
  C.push({hour:d,cost:r.total_cost,offpeak:r.stops.filter(s=>!s.warn).length,warns:r.stops.filter(s=>s.warn).length,v:sc(r),lag,first:f.name,first_eta:f.eta,win_start:ws})}
 if(!C.length||cur.error)return null;const G=C,mv=Math.min(...G.map(c=>c.v));
 const ok=G.filter(c=>c.v<=mv+0.5);ok.sort((a,b)=>a.warns-b.warns||a.lag-b.lag||a.v-b.v||b.hour-a.hour);const b=ok[0];
 const same=Math.abs((((o.dep-b.hour)%24)+24)%24)<0.125||Math.abs((((o.dep-b.hour)%24)+24)%24-24)<0.125;if(same)return null;
 const cw=cur.stops.filter(s=>s.warn).length,save=+(cur.total_cost-b.cost).toFixed(2);const {v,...rest}=b;
 return {...rest,save:Math.max(save,0),cur_warns:cw,at_start:b.lag<0.25}}
G.parseTime=function(t){t=String(t||'').trim().toLowerCase().replace(/\./g,'');if(!t)return null;
 const m=t.match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm|a|p)?$/);if(!m)return NaN;let h=+m[1],mi=+(m[2]||0);const ap=m[3];
 if(mi>59)return NaN;if(ap){if(h<1||h>12)return NaN;h=h%12+(ap[0]=='p'?12:0)}else if(h>23)return NaN;return h+mi/60};
G.Planner={isOpen,SPEED_F,chargeHours,parseTime:G.parseTime,runs,cheapRun,optimize,alternatives,bestDeparture,windows,penaltyRate,offPeakWarn,fh,hl};
if(typeof module!=='undefined')module.exports=G.Planner})(typeof window!=='undefined'?window:globalThis);
