const $=i=>document.getElementById(i);
const map=L.map('map').setView([36,-117],6),layer=L.layerGroup().addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap'}).addTo(map);
const P=new URLSearchParams(location.search);['s','d','dep'].forEach(k=>{if(P.get(k))$(k).value=P.get(k)});
const LS={get:(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},set:(k,v)=>localStorage.setItem(k,JSON.stringify(v))};
const loadPrices=()=>LS.get('ttp_prices',{}),savePrices=p=>{LS.set('ttp_prices',p);showCount()};
const showCount=()=>{const ids=new Set(Object.keys(loadPrices()));(typeof HIST!=='undefined'?HIST.sessions:[]).forEach(x=>{if(x.price_per_kwh||(x.kwh&&x.cost_usd))ids.add(String(x.site_id))});$('pcount').textContent=`(${ids.size} stations)`};
// ---- Superchargers: bundled list, optional live refresh (supercharge.info sends CORS *)
let SITES=[],HIST={sessions:[]};
async function loadHist(){try{HIST=await (await fetch('history.json',{cache:'no-store'})).json()}catch{}renderHist();showCount()}
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fd=d=>MON[+d.slice(5,7)-1]+' '+(+d.slice(8,10));
const histFor=id=>HIST.sessions.filter(x=>x.site_id==id).sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
const badge=id=>{const h=histFor(id);if(!h.length)return '';const x=h[0];return `<span class="hb">You charged here (${esc(x.period||'off-peak')}) — ${fd(x.date)}, $${x.cost_usd.toFixed(2)}${h.length>1?' · '+h.length+' visits':''}</span>`};
// built-in off-peak / multi-window rates from history.json schedules (else history sessions); localStorage overrides
// When PRICE_PUSH is bumped, stale ttp_prices for PRICE_PUSH_IDS are dropped so the new built-ins take effect on the phone.
const PRICE_PUSH=22,PRICE_PUSH_IDS=['192','8146','9299'];
function applyPricePush(){if(LS.get('ttp_prices_ver',0)>=PRICE_PUSH)return;const p=loadPrices();let ch=false;for(const id of PRICE_PUSH_IDS){if(Object.prototype.hasOwnProperty.call(p,id)){delete p[id];ch=true}}if(ch)savePrices(p);LS.set('ttp_prices_ver',PRICE_PUSH)}
function schedPrice(id){const s=(HIST.schedules||{})[id];if(!s||!Array.isArray(s.bands))return null;const hourly=Array(24).fill(null);
 for(const [a,b,r] of s.bands){for(let i=a%24,n=0;n<24&&(n==0||i!=b%24);i=(i+1)%24,n++)hourly[i]=+r}
 return {name:s.name,hourly,entered:s.entered,source:'built-in schedule ('+(s.source||'entered')+')',builtin:true,schedule:true,congestion:s.congestion_fee_per_min??null}}
const openHrs=id=>{const s=(HIST.schedules||{})[id];return s&&Array.isArray(s.open)&&s.open.length==2?s.open.map(Number):null};
const guessHrs=id=>{const s=(HIST.schedules||{})[id];if(!s||!Array.isArray(s.guess_bands))return null;const g=Array(24).fill(null);for(const [x,y,r] of s.guess_bands){for(let i=Math.floor(x)%24,n=0;n<24&&(n==0||i!=Math.floor(y)%24);i=(i+1)%24,n++)g[i]=+r}return g};
const congFee=id=>{const s=(HIST.schedules||{})[id];return s&&s.congestion_fee_per_min!=null?s.congestion_fee_per_min:null};
const congNote=id=>{const f=congFee(id);return f!=null?`<div class="muted">Congestion fee up to $${(+f).toFixed(2)}/min</div>`:''};
function builtinPrice(id){const sp=schedPrice(id);if(sp)return sp;const h=histFor(id).filter(x=>x.price_per_kwh||(x.kwh&&x.cost_usd));if(!h.length)return null;const x=h[0];
 const rate=x.price_per_kwh||+(x.cost_usd/x.kwh).toFixed(3),op=HIST.default_off_peak||{start:23,end:8},a=x.off_peak_start??op.start,b=x.off_peak_end??op.end;
 const hourly=Array(24).fill(null);for(let i=a;i!=b;i=(i+1)%24)hourly[i]=rate;return {name:x.label,hourly,entered:x.date,source:'built-in (charging history)',builtin:true}}
function renderHist(){const s=[...HIST.sessions].sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
 $('hist').innerHTML=s.map(x=>{const t=x.time.split(':');return `<div class="opt"><b>${esc(x.label)}</b><br>${fd(x.date)}, ${x.date.slice(0,4)} · ${fh(+t[0]+t[1]/60)} · <b>$${x.cost_usd.toFixed(2)}</b> · ${esc(x.period)}${x.kwh?` · ${x.kwh} kWh`:''}${x.price_per_kwh?` · $${(+x.price_per_kwh).toFixed(2)}/kWh`:' · $/kWh not recorded'}</div>`}).join('')||'<div class="muted">No sessions.</div>'}
async function loadSites(){const c=LS.get('ttp_sites',null);
 if(c){SITES=c.sites;$('sinfo').textContent=`${SITES.length} sites, updated ${c.generated}`;return}
 const j=await (await fetch('sites.json')).json();SITES=j.sites;$('sinfo').textContent=`${SITES.length} sites (bundled ${j.generated})`}
$('ref').onclick=async()=>{$('sinfo').textContent='Downloading…';try{
 const a=await (await fetch('https://supercharge.info/service/supercharge/allSites')).json(),C=new Set(['USA','Canada','Mexico']);
 const s=a.filter(x=>x.status==='OPEN'&&x.gps&&C.has(x.address?.country)).map(x=>[x.id,x.name,+x.gps.latitude.toFixed(5),+x.gps.longitude.toFixed(5),x.stallCount,x.powerKilowatt]);
 LS.set('ttp_sites',{generated:new Date().toISOString().slice(0,10),sites:s});await loadSites()}catch(e){$('sinfo').textContent='Update failed ('+e+'); using saved list.';loadSites()}};
// ---- Nominatim: 1 request/sec max, cached, no per-keystroke autocomplete (per usage policy)
let lastGeo=0;const geoCache=LS.get('ttp_geo',{});
const HOME=[34.42,-118.56]; // Valencia (Santa Clarita), CA: bias bare place names toward home
async function geocode(q){q=q.trim();const key='v2:'+q.toLowerCase();if(geoCache[key])return geoCache[key];
 let g=await geocode1(q);if(!/[,\d]/.test(q)){const dh=x=>hav(HOME,[x.lat,x.lon]);if(!g.some(x=>dh(x)<300)){try{g=(await geocode1(q+', CA')).concat(g)}catch{}}
  g=g.map((x,i)=>({x,i})).sort((a,b)=>(dh(a.x)<300?0:1)-(dh(b.x)<300?0:1)||(dh(a.x)<300&&dh(b.x)<300?dh(a.x)-dh(b.x):a.i-b.i)).map(o=>o.x).slice(0,5)}
 geoCache[key]=g;LS.set('ttp_geo',geoCache);return g}
async function geocode1(q){
 const w=1100-(Date.now()-lastGeo);if(w>0)await new Promise(r=>setTimeout(r,w));lastGeo=Date.now();
 const r=await fetch('https://nominatim.openstreetmap.org/search?'+new URLSearchParams({q,format:'json',limit:5,countrycodes:'us,ca,mx'}),{headers:{'Accept-Language':'en'}});
 if(!r.ok)throw 'Address search failed ('+r.status+')';
 return (await r.json()).map(x=>({name:x.display_name,lat:+x.lat,lon:+x.lon}))}
const pick={},debT={};
async function resolve(k){const v=$(k).value;if(pick[k]&&pick[k].q==v)return pick[k];const g=await geocode(v);
 if(!g.length)throw 'Address not found: '+v;showSug(k,g);return pick[k]={...g[0],q:v}}
function showSug(k,g){const el=$(k+'s');el.innerHTML='';if(g.length<2)return;el.append('Not right? Tap:');
 g.slice(1).forEach(x=>{const d=document.createElement('div');d.textContent=x.name;d.onclick=()=>{pick[k]={...x,q:$(k).value};el.innerHTML='';go()};el.append(d)})}
['s','d'].forEach(k=>$(k).addEventListener('input',()=>{clearTimeout(debT[k]);$(k+'s').innerHTML='';
 debT[k]=setTimeout(()=>{if($(k).value.trim().length>3)resolve(k).catch(()=>{})},1500)}));// debounced: one lookup after typing stops
// ---- planning logic (ported 1:1 from v1 server.py)
function hav(a,b){const R=Math.PI/180,la1=a[0]*R,la2=b[0]*R,h=Math.sin((la2-la1)/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin((b[1]-a[1])*R/2)**2;return 2*3958.8*Math.asin(Math.sqrt(h))}
async function plan(p){const a=p.start,b=p.dest,rng=+p.range,batt=+p.battery,kpm=+p.kwh_per_mile||.3,buf=+p.buffer,chg=+p.charge_to,max=+p.max_charge||90;
 const bad=[];const num=(v,lo,hi,nm)=>{if(!isFinite(v)||v<lo||v>hi)bad.push(`${nm} must be ${lo}–${hi}`)};
 num(rng,50,600,'Range at 100%');num(batt,1,100,'Battery now %');num(kpm,0.1,1,'kWh / mile');num(buf,0,50,'Min. battery at each stop %');num(chg,20,100,'Charge to %');
 num(max,50,100,'Max charge at stops %');if(p.finish)num(+p.finish_to,10,100,'Charge there to %');if(bad.length)return {error:bad.join('. ')+'.',sites:[]};
 if(buf>=chg)return {error:`Min. battery at each stop (${buf}%) is too high — it must be below Charge to (${chg}%). Try 10–20%. To charge at your destination, use the Finish at a Supercharger option.`,sites:[]};
 if(buf>=batt)return {error:`Min. battery at each stop (${buf}%) is at or above your current battery (${batt}%). Try 10–20%. To charge at your destination, use the Finish at a Supercharger option.`,sites:[]};
 const n=new Date();let dep=p.depart_hour===''?n.getHours()+n.getMinutes()/60:Planner.parseTime(p.depart_hour);if(dep==null||isNaN(dep))return {error:'Departure time not understood. Try 22:30 or 10:30 PM.',sites:[]};
 const res=await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`);
 if(!res.ok)throw 'Routing failed ('+res.status+')';const r=(await res.json()).routes[0];if(!r)throw 'No route found';
 const coords=r.geometry.coordinates.map(c=>[c[1],c[0]]),total=r.distance/1609.34,speed=total/(r.duration/3600)*Planner.SPEED_F;
 const pts=[],cum=[];let d=0;coords.forEach((c,i)=>{if(i)d+=hav(coords[i-1],c);if(!pts.length||d-cum[cum.length-1]>=.5||i==coords.length-1){pts.push(c);cum.push(d)}});
 let mnLa=1e9,mxLa=-1e9,mnLo=1e9,mxLo=-1e9;pts.forEach(([x,y])=>{mnLa=Math.min(mnLa,x);mxLa=Math.max(mxLa,x);mnLo=Math.min(mnLo,y);mxLo=Math.max(mxLo,y)});
 const prices=loadPrices(),near=[];
 for(const [id,name,lat,lng,stalls,kw] of SITES){if(!(mnLa-.1<lat&&lat<mxLa+.1&&mnLo-.1<lng&&lng<mxLo+.1))continue;
  const k=Math.cos(lat*Math.PI/180);let bi=0,bd=1e18;pts.forEach((q,i)=>{const v=(q[0]-lat)**2+((q[1]-lng)*k)**2;if(v<bd){bd=v;bi=i}});
  const off=hav(pts[bi],[lat,lng]);if(off<=5)near.push({id,name,lat,lon:lng,stalls,kw,mile:+(cum[bi]+off).toFixed(1),off:+off.toFixed(1),price:prices[id]||builtinPrice(id),open:openHrs(id),guess:guessHrs(id),used:histFor(id).length})}
 near.sort((x,y)=>x.mile-y.mile);
 let finish=null;if(p.finish){const cand=[];
  for(const [id,name,lat,lng,stalls,kw] of SITES){const dd=hav([b.lat,b.lon],[lat,lng]);if(dd>10)continue;
   const pr=prices[id]||builtinPrice(id),k=pr?pr.hourly.filter(x=>x!=null):[];cand.push({id,name,lat,lon:lng,stalls,kw,dd,price:pr,open:openHrs(id),guess:guessHrs(id),used:histFor(id).length,min:k.length?Math.min(...k):null})}
  if(!cand.length)return {route:coords,sites:near,error:'No Supercharger found within 10 miles of your destination. Turn off "Finish at a Supercharger".'};
  cand.sort((x,y)=>(!!y.used-!!x.used)||((x.min==null)-(y.min==null))||((x.min??0)-(y.min??0))||x.dd-y.dd);
  const f=cand[0],kk=Math.cos(f.lat*Math.PI/180);let bi=0,bd=1e18;pts.forEach((q,i)=>{const v=(q[0]-f.lat)**2+((q[1]-f.lon)*kk)**2;if(v<bd){bd=v;bi=i}});
  const off=hav(pts[bi],[f.lat,f.lon]);const {dd,min,...site}=f;site.mile=+(cum[bi]+off).toFixed(1);site.off=+off.toFixed(1);
  finish={site,to:+p.finish_to,toDest:dd*1.3}}
 const o={total,speed,rng,batt,kpm,buf,chg,max,dep,finish},R=Planner.optimize(near,o),base={route:coords,sites:near,total_miles:+total.toFixed(1),drive_hours:+(r.duration/3600/Planner.SPEED_F).toFixed(1),dep};
 if(R.error)return {...base,error:R.error};
 const cur={...base,...R,alts:Planner.alternatives(near,R,o)},S=Planner.bestDeparture(near,o,R);
 if(S){const o2={...o,dep:S.hour},R2=Planner.optimize(near,o2);
  if(!R2.error){const best={...base,dep:S.hour,...R2,alts:Planner.alternatives(near,R2,o2)},w=x=>x.stops.filter(s=>s.warn).length;
   if(w(best)<w(cur)||best.total_cost<cur.total_cost-0.005){if(p.depart_hour!=='')return {...cur,suggest:S,other:best,user_time:true};return {...best,suggest:S,other:cur}}}}
 return cur}
// ---- rendering
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fh=h=>{h=((h%24)+24)%24;let t=Math.round(h*60)%1440;const H=Math.floor(t/60),m=t%60;return (H%12||12)+':'+String(m).padStart(2,'0')+(H<12?' AM':' PM')};
const hl=h=>h==0||h==24?'12 AM':h==12?'12 PM':h<12?h+' AM':(h-12)+' PM';
let last=null;
const appleURL=(la,lo,q)=>`https://maps.apple.com/?ll=${(+la).toFixed(6)},${(+lo).toFixed(6)}&q=${encodeURIComponent(q)}`;
const gmURL=(la,lo)=>`https://www.google.com/maps/search/?api=1&query=${(+la).toFixed(6)},${(+lo).toFixed(6)}`;
async function go(){$('msg').textContent='Planning…';$('save').hidden=true;$('out').innerHTML='';$('sum').innerHTML='';try{
 if(!SITES.length)await loadSites();const s=await resolve('s'),d=await resolve('d');
 const r=await plan({start:s,dest:d,range:$('rng').value,battery:$('bat').value,kwh_per_mile:$('kpm').value,buffer:$('buf').value,charge_to:$('to').value,max_charge:$('mx').value,finish:$('fin').checked,finish_to:$('finto').value,depart_hour:$('dep').value.trim()});
 last=r;layer.clearLayers();if(r.route){const pl=L.polyline(r.route,{color:'#3e6ae1',weight:5}).addTo(layer);map.fitBounds(pl.getBounds())}
 const ids=new Set((r.stops||[]).map(x=>x.id));
 r.sites.forEach(x=>L.circleMarker([x.lat,x.lon],{radius:ids.has(x.id)?10:x.used?8:6,color:ids.has(x.id)?'#16a34a':x.used?'#7c3aed':'#e11d48',fillOpacity:.8})
  .bindPopup(`<b>${esc(x.name)}</b><br>${badge(x.id)}${x.used?'<br>':''}${x.stalls} stalls · ${x.kw||'?'} kW · mile ${x.mile}<br>${x.price?'Prices entered '+esc(x.price.entered):'Price unknown'}`).addTo(layer));
 if(r.error){$('msg').textContent=r.error;return}$('msg').textContent='';
 const nwOf=x=>x.stops.filter(t=>t.warn).length,nw=nwOf(r),dest=esc(($('d').value||'destination').split(',')[0]);
 const T=h=>`<b class="tm">${fh(h)}</b>`;
 const head=r.user_time?`<div class="tip big">🕒 <b>Leaving ${fh(r.dep)}</b> (your time) — est. $${r.total_cost.toFixed(2)}, ${nw?nw+' stop(s) outside off-peak':'all stops off-peak'}${r.total_cost-r.other.total_cost>=0.5?`<br>💡 Cheaper: leave ${fh(r.other.dep)} to save about $${(r.total_cost-r.other.total_cost).toFixed(2)} (see below).`:''}</div>`:r.other?`<div class="tip big">💡 <b>Cheapest: leave ${fh(r.dep)}</b> — est. $${r.total_cost.toFixed(2)}, ${nw?nw+' stop(s) outside off-peak':'all stops off-peak'}${r.other.total_cost-r.total_cost>=0.5?` · saves about $${(r.other.total_cost-r.total_cost).toFixed(2)}`:''}</div>`
  :`<div class="tip big">✅ <b>Leave ${fh(r.dep)}</b> — est. $${r.total_cost.toFixed(2)}, ${nw?nw+' stop(s) outside off-peak':'all stops off-peak'}. This is already the cheapest time to leave.</div>`;
 const summ=x=>`${s.name?`From ${esc(String(s.name).split(',').slice(0,2).join(','))}<br>`:''}${x.stops.length} stop(s) · ${x.total_miles} mi · ~${x.drive_hours} h driving<br>Leave ${T(x.dep)} · Arrive ${dest} ~${T(x.arrive_time)} with ~${x.arrive_pct}% battery left`;
 $('sum').innerHTML=`<div class="card">${head}${summ(r)}
 ${nw?`<div class="warnb">⚠️ ${nw} stop(s) arrive outside off-peak hours.</div>`:''}
 ${r.has_est?`<div class="muted">* Includes estimates for stations with unknown prices ($${r.penalty.toFixed(2)}/kWh = your average + 20%).</div>`:''}
 <div class="muted">${r.sites.length} Superchargers within 5 mi of route. Green = planned stop · Purple = you've charged there.</div></div>`;
 const rateTxt=o=>o.rate_est?`<span class="unk">~$${o.rate.toFixed(2)}/kWh (estimate)</span>`:o.rate_outside?`<span class="unk">≥$${o.rate.toFixed(2)}/kWh (your off-peak rate; likely higher now)</span>`:`$${o.rate.toFixed(2)}/kWh`;
 const nav=o=>`<div class="nav"><a class="car" href="${appleURL(o.lat,o.lon,o.name+' Tesla Supercharger')}" target="_blank" rel="noopener">🚗 Send to car</a> <a class="gm" href="${gmURL(o.lat,o.lon)}" target="_blank" rel="noopener">Google Maps</a></div>`;
 const btn=o=>nav(o)+`<button class="sm" data-id="${o.id}" data-name="${esc(o.name)}">${o.price&&!o.price.builtin?'Edit':'Add'} prices</button>`;
 const altLeave=a=>a.eta+Planner.chargeHours(a.kwh,a.arrive_pct,a.target_pct,a.kw);
 const cards=(x,alts)=>x.stops.map((o,i)=>`<div class="card"><div class="opt best"><b>${o.final?'🏁 Final stop':'Stop '+(i+1)}: ${esc(o.name)}</b> (mile ${o.mile}, ${o.off} mi off route)<br>${o.used?badge(o.id)+'<br>':''}
 Arrive ${T(o.eta)} at ${o.arrive_pct}% → charge to ${o.target_pct}% (~${Math.round(o.charge_h*60)} min) · Leave ${T(o.eta_abs+o.charge_h)}<br><b>${o.kwh} kWh</b> · ${rateTxt(o)} · <b>$${o.cost.toFixed(2)}${o.rate_est?' (est.)':''}</b>
 ${o.cap_note?`<div class="warnb">🔋 ${esc(o.cap_note)}</div>`:''}${o.warn?`<div class="warnb">⚠️ ${esc(o.warn)}</div>`:''}${o.open_note?`<div class="muted">🕗 ${esc(o.open_note)}</div>`:''}${congNote(o.id)}${o.price?`<div class="muted">Cheapest window: ${Planner.windows(o.price.hourly.map(v=>v??1e9))[1].join(', ')}</div>`:''}${btn(o)}</div>
 ${alts?`<details><summary>Other stations for this leg (${x.alts[i].length})</summary>${x.alts[i].filter(a=>a.id!=o.id).map(a=>`<div class="opt"><b>${esc(a.name)}</b> (mile ${a.mile}, ${a.off} mi off route)<br>${a.used?badge(a.id)+'<br>':''}
 Arrive ${T(a.eta)} at ${a.arrive_pct}% → ${a.target_pct}% · Leave ${T(altLeave(a))}<br>${a.kwh} kWh · ${rateTxt(a)} · $${a.cost.toFixed(2)}${a.rate_est?' (est.)':''}${a.closed_note?`<div class="warnb">🚫 ${esc(a.closed_note)}</div>`:''}${a.warn&&!a.closed?`<div class="warnb">⚠️ ${esc(a.warn)}</div>`:''}${congNote(a.id)}<br>${btn(a)}</div>`).join('')||'<div class="muted">No other stations in range.</div>'}</details>`:''}</div>`).join('');
 const tot=`<div class="card"><b>Trip total: est. $${r.total_cost.toFixed(2)}${r.has_est?' (includes estimates)':''}</b> · Arrive ${dest} ~${T(r.arrive_time)} with ~${r.arrive_pct}% battery left<div class="muted">Prices are estimates; confirm in the car before charging.</div></div>`;
 let oth='';if(r.other){const x=r.other,n2=nwOf(x),lbl=r.user_time?`at ${fh(x.dep)} (cheapest)`:$('dep').value.trim()?`at ${fh(x.dep)}`:`now (${fh(x.dep)})`;
  oth=`<div class="card"><details><summary>If you leave ${lbl}: est. $${x.total_cost.toFixed(2)}, ${n2?n2+' stop(s) outside off-peak':'all stops off-peak'}</summary><div class="muted">${summ(x)}</div>${cards(x,false)}</details></div>`}
 const hint=`<div class="muted hint">Tap Send to car → Share → Tesla. Send the first stop; add later stops in the car as you go.</div>`;
 const dnav=`<div class="card"><b>Destination: ${dest}</b> · Arrive ${T(r.arrive_time)} at ~${r.arrive_pct}%<div class="nav"><a class="car" href="${appleURL(d.lat,d.lon,($('d').value||'Destination').split(',')[0])}" target="_blank" rel="noopener">🚗 Send destination to car</a> <a class="gm" href="${gmURL(d.lat,d.lon)}" target="_blank" rel="noopener">Google Maps</a></div></div>`;
 $('out').innerHTML=cards(r,true)+hint+dnav+tot+oth;lastPick={s,d};$('save').hidden=false;
 document.title='Tesla Trip Planner – done'}catch(e){$('msg').textContent='Error: '+e}}
$('go').onclick=go;
const finUI=()=>{$('finrow').hidden=!$('fin').checked};$('fin').onchange=finUI;finUI();
$('out').addEventListener('click',e=>{const b=e.target.closest('button[data-id]');if(b)openPrice(+b.dataset.id,b.dataset.name)});
// ---- price form
let cur=null;
const hourSel=(v,end)=>{const s=document.createElement('select');for(let h=end?1:0;h<=(end?24:23);h++)s.add(new Option(hl(h),h,false,h==v));return s};
function addBand(a=0,b=24,p=''){const row=document.createElement('div');row.className='band';const pi=document.createElement('input');
 Object.assign(pi,{type:'number',step:'0.01',min:'0',inputMode:'decimal',placeholder:'$/kWh',value:p});
 const x=document.createElement('button');x.type='button';x.className='x';x.textContent='✕';x.onclick=()=>row.remove();
 row.append(hourSel(a),'→',hourSel(b,true),pi,x);$('bands').append(row)}
function toBands(h){const o=[];let s=0;for(let i=1;i<=24;i++)if(i==24||h[i]!=h[s]){o.push([s,i,h[s]]);s=i}return o}
function openPrice(id,name){cur={id,name};$('pname').textContent=name;$('perr').textContent='';$('bands').innerHTML='';
 const e=loadPrices()[id]||builtinPrice(id);if(e)toBands(e.hourly).forEach(b=>addBand(...b));else{addBand(0,9,'');addBand(9,16,'');addBand(16,21,'');addBand(21,24,'')}
 $('pdel').hidden=!e;$('dlg').showModal()}
$('addb').onclick=()=>addBand();$('pcancel').onclick=()=>$('dlg').close();
$('psave').onclick=()=>{const h=Array(24).fill(null);let err='';
 for(const r of $('bands').children){const [a,b]=[...r.querySelectorAll('select')].map(s=>+s.value),v=r.querySelector('input').value;
  if(v===''||isNaN(+v)||+v<0||+v>3){err='Enter a price ($/kWh) on every row.';break}
  if(b<=a){err=`End must be after start (${hl(a)} → ${hl(b)}).`;break}
  for(let i=a;i<b;i++){if(h[i]!=null){err=`Bands overlap at ${hl(i)}.`;break}h[i]=+v}if(err)break}
 if(!err&&h.includes(null))err=`Missing hours starting at ${hl(h.indexOf(null))}. Cover 12 AM → 12 AM.`;
 if(err){$('perr').textContent=err;return}
 const p=loadPrices();p[cur.id]={name:cur.name,hourly:h,entered:new Date().toISOString().slice(0,10),source:'manual (Tesla app/car)'};savePrices(p);$('dlg').close();if(last)go()};
$('pdel').onclick=()=>{const p=loadPrices();delete p[cur.id];savePrices(p);$('dlg').close();if(last)go()};
// ---- backup
$('exp').onclick=()=>{const b=new Blob([JSON.stringify({app:'Tesla Trip Planner',exported:new Date().toISOString(),prices:loadPrices(),trips:loadTrips()},null,1)],{type:'application/json'});
 const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`tesla-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000)};
$('impb').onclick=()=>$('imp').click();
$('imp').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const j=JSON.parse(await f.text()),inc=j.prices||(j.app?{}:j);let n=0;const p=loadPrices();
 for(const[k,v]of Object.entries(inc))if(Array.isArray(v?.hourly)&&v.hourly.length==24&&v.hourly.every(x=>typeof x=='number')){p[k]=v;n++}
 savePrices(p);let nt=0;if(Array.isArray(j.trips)){const t=loadTrips();for(const x of j.trips)if(x&&x.name&&x.inputs){const i=t.findIndex(y=>y.id==x.id);if(i>=0)t[i]=x;else t.push(x);nt++}saveTrips(t)}alert(`Imported ${n} station price schedule(s) and ${nt} saved trip(s).`);if(last)go()}catch(x){alert('Could not read that file: '+x)}e.target.value=''};

// ---- saved trips (ttp_trips)
let lastPick=null;
const FIELDS=['s','d','rng','bat','kpm','buf','to','mx','dep','finto'],CHK=['fin'];
const loadTrips=()=>{const t=LS.get('ttp_trips',[]);return Array.isArray(t)?t:[]},saveTrips=t=>{LS.set('ttp_trips',t);renderTrips()};
function readInputs(){const o={};FIELDS.forEach(k=>o[k]=$(k).value);CHK.forEach(k=>o[k]=!!$(k).checked);return o}
const geoOf=k=>{const p=pick[k];return p&&p.q==$(k).value?{lat:p.lat,lon:p.lon,name:p.name}:null};
function tripRecord(name,old){const r=last||{};return {id:old?.id||Date.now().toString(36)+Math.random().toString(36).slice(2,6),name,inputs:readInputs(),
 geo:{s:geoOf('s'),d:geoOf('d')},summary:{saved:new Date().toISOString(),stops:(r.stops||[]).map(x=>x.name),total:r.total_cost??null,leave:r.dep!=null?fh(r.dep):null},created:old?.created||new Date().toISOString()}}
const defName=()=>`${($('s').value||'Start').split(',')[0].trim()} → ${($('d').value||'Destination').split(',')[0].trim()}`;
function saveTrip(name){name=(name||'').trim()||defName();const t=loadTrips();const rec=tripRecord(name);t.unshift(rec);saveTrips(t);return rec}
function updateTrip(id){const t=loadTrips(),i=t.findIndex(x=>x.id==id);if(i<0)return null;t[i]=tripRecord(t[i].name,t[i]);saveTrips(t);return t[i]}
function deleteTrip(id){const t=loadTrips().filter(x=>x.id!=id);saveTrips(t)}
function fillTrip(id){const x=loadTrips().find(y=>y.id==id);if(!x)return null;const v=x.inputs||{};
 FIELDS.forEach(k=>{if(v[k]!=null)$(k).value=v[k]});CHK.forEach(k=>{$(k).checked=!!v[k]});finUI();
 ['s','d'].forEach(k=>{$(k+'s').innerHTML='';const g=x.geo&&x.geo[k];if(g)pick[k]={...g,q:$(k).value};else delete pick[k]});return x}
async function loadTrip(id){if(fillTrip(id))await go()}
function renderTrips(){const t=loadTrips(),el=$('trips');$('tcount').textContent=t.length?`(${t.length})`:'';
 if(!t.length){el.innerHTML='<div class="muted">No saved trips yet. Plan a trip, then tap 💾 Save trip.</div>';return}
 el.innerHTML=t.map(x=>{const s=x.summary||{};const d=(s.saved||'').slice(0,10);
  return `<div class="trip"><b>${esc(x.name)}</b><div class="muted">${s.leave?'Leave '+esc(s.leave)+' · ':''}${s.total!=null?'est. $'+(+s.total).toFixed(2)+' · ':''}${(s.stops||[]).length} stop(s)${(s.stops||[]).length?': '+esc(s.stops.map(n=>n.split(',')[0]).join(' → ')):''}<br>Saved ${esc(d)}</div>
  <button class="sm" data-t="load" data-tid="${x.id}">Load</button><button class="sm ghost" data-t="upd" data-tid="${x.id}">Update</button><button class="sm del" data-t="del" data-tid="${x.id}">Delete</button></div>`}).join('')}
$('trips').addEventListener('click',e=>{const b=e.target.closest('button[data-tid]');if(!b)return;const id=b.dataset.tid,x=loadTrips().find(y=>y.id==id);if(!x)return;
 if(b.dataset.t=='load'){loadTrip(id);window.scrollTo&&window.scrollTo(0,0)}
 else if(b.dataset.t=='upd'){if(confirm(`Overwrite "${x.name}" with the current settings${last?' and plan':''}?`))updateTrip(id)}
 else if(b.dataset.t=='del'){if(confirm(`Delete saved trip "${x.name}"?`))deleteTrip(id)}});
$('save').onclick=()=>{const n=prompt('Name this trip',defName());if(n===null)return;const r=saveTrip(n);$('msg').textContent=`Saved "${r.name}".`};
$('rev').onclick=()=>{const a=$('s').value;$('s').value=$('d').value;$('d').value=a;const ps=pick.s;pick.s=pick.d;pick.d=ps;['s','d'].forEach(k=>{if(!pick[k])delete pick[k];$(k+'s').innerHTML=''})};
renderTrips();
applyPricePush();showCount();loadHist();loadSites().then(()=>{if(P.get('auto'))go()});
