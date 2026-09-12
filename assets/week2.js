
(() => {
  'use strict';
  const BASE = window.ESG_WEEK2;
  const BUILD_DATE = BASE.buildDate || '2026-09-12';
  const AUTO_MS = 60000;
  const API_BASE = '/api/v1/college/week2';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const nowIso = () => new Date().toISOString();
  const state = {
    games: BASE.games.map(g => ({...g, runtime:null})),
    stats: new Map(),
    controlled: new Map(),
    lastCheck:null,
    busy:false,
    scheduleDate:'all',
    directMode:false
  };

  function toast(msg, error=false){
    const el=$('#toast'); el.textContent=msg; el.className='toast show'+(error?' error':'');
    clearTimeout(toast.t); toast.t=setTimeout(()=>el.className='toast',4200);
  }
  function progress(p){ $('#progress i').style.width=`${Math.max(0,Math.min(100,p))}%`; if(p>=100)setTimeout(()=>$('#progress i').style.width='0',450); }
  function todayET(){
    try{
      const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
      const get=t=>parts.find(x=>x.type===t)?.value; return `${get('year')}-${get('month')}-${get('day')}`;
    }catch{return BUILD_DATE}
  }
  function focusDate(){ const d=todayET(); return state.games.some(g=>g.date===d)?d:BUILD_DATE; }
  function fmtDate(d){
    const dt=new Date(`${d}T12:00:00-04:00`);
    return new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',month:'short',day:'numeric'}).format(dt).toUpperCase();
  }
  function gameClients(g){
    const ids=[...new Set((g.clientSchools||[]).flatMap(s=>BASE.playersBySchool[s]||[]))];
    return ids.map(id=>BASE.players.find(p=>p.id===id)).filter(Boolean);
  }
  function gameStatus(g){
    const r=g.runtime; if(!r)return 'scheduled';
    const st=norm(r.statusType||r.status||'');
    if(r.completed||st.includes('final')||st==='post')return 'final';
    if(st.includes('in progress')||st.includes('halftime')||st==='in'||st.includes('end period')||r.state==='in')return 'live';
    return 'scheduled';
  }
  function isToday(g){return g.date===focusDate()}
  function gameTimeMs(g){
    if(g.runtime?.date){
      const n=Date.parse(g.runtime.date); if(Number.isFinite(n))return n;
    }
    const t=(g.timeET||'12:00 PM').match(/(\d+):(\d+)\s*([AP]M)/i);
    if(!t)return Date.parse(`${g.date}T12:00:00-04:00`);
    let h=+t[1]%12+(t[3].toUpperCase()==='PM'?12:0);
    return Date.parse(`${g.date}T${String(h).padStart(2,'0')}:${t[2]}:00-04:00`);
  }
  function statusLabel(g){
    const r=g.runtime,s=gameStatus(g);
    if(s==='live')return r?.shortDetail||r?.detail||'LIVE';
    if(s==='final')return r?.shortDetail||'FINAL';
    return g.timeET?`${g.timeET} ET`:'TBD';
  }
  function network(g){return g.runtime?.network || g.network || 'NOT FOUND'}
  function venue(g){return g.runtime?.venue || g.venue || 'Venue not found'}
  function scoreText(g){
    const r=g.runtime;if(!r)return '';
    if(r.awayScore==null&&r.homeScore==null)return '';
    return `${r.awayScore ?? '—'}–${r.homeScore ?? '—'}`;
  }

  function parseEvent(ev){
    const comp=ev?.competitions?.[0]||{};
    const comps=comp.competitors||[];
    const home=comps.find(x=>x.homeAway==='home')||comps[0]||{};
    const away=comps.find(x=>x.homeAway==='away')||comps[1]||{};
    const broadcasts=(comp.broadcasts||[]).flatMap(b=>b.names||[]).filter(Boolean);
    const st=comp.status||ev.status||{};
    return {
      id:String(ev.id||''),
      date:ev.date||comp.date||null,
      away:away.team?.displayName||away.team?.shortDisplayName||'',
      home:home.team?.displayName||home.team?.shortDisplayName||'',
      awayScore:away.score ?? null, homeScore:home.score ?? null,
      statusType:st.type?.description||st.type?.name||'',
      shortDetail:st.type?.shortDetail||st.displayClock||'',
      detail:st.type?.detail||'',
      state:st.type?.state||'',
      completed:!!st.type?.completed,
      network:broadcasts[0]||null,
      venue:comp.venue?.fullName||null,
      weather:comp.weather?.displayValue||null,
      espnUrl:(ev.links||[]).find(l=>(l.rel||[]).includes('summary'))?.href||null
    };
  }

  async function fetchJson(url, fallback){
    try{
      const res=await fetch(url,{cache:'no-store',credentials:'same-origin'});
      if(res.ok)return await res.json();
      if(res.status!==404 && res.status!==401) throw new Error(`${res.status} ${res.statusText}`);
    }catch(e){ if(!fallback)throw e; }
    if(!fallback)throw new Error('No fallback URL');
    state.directMode=true;
    const res=await fetch(fallback,{cache:'no-store'});
    if(!res.ok)throw new Error(`ESPN ${res.status}`);
    return await res.json();
  }
  async function fetchScoreboard(date){
    const d=date.replaceAll('-','');
    const local=`${API_BASE}/scoreboard?date=${encodeURIComponent(date)}`;
    const direct=`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${encodeURIComponent(d)}&limit=1000`;
    return await fetchJson(local,direct);
  }
  async function fetchSummary(id){
    const local=`${API_BASE}/summary/${encodeURIComponent(id)}`;
    const direct=`https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${encodeURIComponent(id)}`;
    return await fetchJson(local,direct);
  }
  function mergeScoreboard(data,date){
    const events=(data?.events||[]).map(parseEvent);
    const byId=new Map(events.map(e=>[String(e.id),e]));
    state.games.forEach(g=>{
      if(g.date!==date)return;
      const r=byId.get(String(g.id));
      if(r)g.runtime=r;
    });
  }

  function n(v){
    if(v==null||v==='')return null;
    const x=parseFloat(String(v).replace(/,/g,''));
    return Number.isFinite(x)?x:null;
  }
  function firstNum(s){const m=String(s??'').match(/-?\d+(?:\.\d+)?/);return m?n(m[0]):null}
  function cleanLabel(s){return norm(s).replace(/\s+/g,' ')}

  function parsePlayerSummary(summary, espnId){
    if(!espnId)return {found:false,reason:'No ESPN Athlete ID',values:{},raw:[]};
    const target=String(espnId), raw=[], v={};
    let found=false;
    const teams=summary?.boxscore?.players||[];
    for(const teamBlock of teams){
      for(const group of (teamBlock.statistics||[])){
        const gname=cleanLabel(group.name||group.displayName||group.shortDisplayName||'');
        const labels=group.labels||group.keys||[];
        for(const row of (group.athletes||[])){
          const aid=String(row?.athlete?.id ?? row?.id ?? '');
          if(aid!==target)continue;
          found=true;
          const stats=row.stats||[];
          raw.push({group:gname,labels:[...labels],stats:[...stats]});
          const at=(label)=>{
            const i=labels.findIndex(x=>cleanLabel(x)===cleanLabel(label));
            return i>=0?stats[i]:null;
          };
          const find=(tests)=>{
            for(let i=0;i<labels.length;i++){
              const L=cleanLabel(labels[i]);
              if(tests.some(t=>typeof t==='string'?L===t:t.test(L)))return stats[i];
            } return null;
          };
          if(gname.includes('passing')){
            const ca=find([/^c att$/, /^cmp att$/, /^completions attempts$/]);
            if(ca&&String(ca).includes('/')){const [a,b]=String(ca).split('/');v.cmp=n(a);v.att=n(b)}
            if(v.cmp==null)v.cmp=n(find(['cmp','completions']));
            if(v.att==null)v.att=n(find(['att','attempts']));
            v.passYds=n(find(['yds','yards','pass yds'])) ?? v.passYds;
            v.passTd=n(find(['td','pass td'])) ?? v.passTd;
            v.passInt=n(find(['int','interceptions'])) ?? v.passInt;
          }else if(gname.includes('rushing')){
            v.car=n(find(['car','att','attempts'])) ?? v.car;
            v.rushYds=n(find(['yds','yards'])) ?? v.rushYds;
            v.rushTd=n(find(['td'])) ?? v.rushTd;
          }else if(gname.includes('receiv')){
            v.rec=n(find(['rec','receptions'])) ?? v.rec;
            v.recYds=n(find(['yds','yards'])) ?? v.recYds;
            v.recTd=n(find(['td'])) ?? v.recTd;
          }else if(gname.includes('defen')||gname.includes('tackl')){
            v.tkls=n(find(['tot','total','tackles','tkl'])) ?? v.tkls;
            v.sack=n(find(['sacks','sack'])) ?? v.sack;
            v.tfl=n(find(['tfl','tackles for loss'])) ?? v.tfl;
            v.pd=n(find(['pd','passes defended','pass deflections'])) ?? v.pd;
            v.qbh=n(find(['qbh','qb hurries','quarterback hurries'])) ?? v.qbh;
            v.defInt=n(find(['int','interceptions'])) ?? v.defInt;
            v.ff=n(find(['ff','forced fumbles'])) ?? v.ff;
            v.fr=n(find(['fr','fumble recoveries'])) ?? v.fr;
          }else if(gname.includes('interception')){
            v.defInt=n(find(['int','interceptions'])) ?? v.defInt;
          }else if(gname.includes('fumble')){
            v.ff=n(find(['ff','forced fumbles'])) ?? v.ff;
            v.fr=n(find(['fr','fumble recoveries','rec'])) ?? v.fr;
          }else if(gname.includes('kick')&&gname.includes('return')){
            v.krYds=n(find(['yds','yards'])) ?? v.krYds;
          }else if(gname.includes('punt')&&gname.includes('return')){
            v.prYds=n(find(['yds','yards'])) ?? v.prYds;
          }
        }
      }
    }
    return {found,values:v,raw,reason:found?'ESPN athlete row found':'No ESPN stat row yet'};
  }
  function statLine(v){
    const a=[];
    if(v.cmp!=null||v.att!=null||v.passYds!=null){ if(v.cmp!=null&&v.att!=null)a.push(`${v.cmp}-${v.att} PASS`); if(v.passYds!=null)a.push(`${v.passYds} PASS YDS`); if(v.passTd!=null&&v.passTd!==0)a.push(`${v.passTd} PASS TD`); if(v.passInt!=null&&v.passInt!==0)a.push(`${v.passInt} INT`)}
    if(v.car!=null&&v.car!==0)a.push(`${v.car} CAR`);if(v.rushYds!=null&&v.rushYds!==0)a.push(`${v.rushYds} RUSH YDS`);if(v.rushTd!=null&&v.rushTd!==0)a.push(`${v.rushTd} RUSH TD`);
    if(v.rec!=null&&v.rec!==0)a.push(`${v.rec} REC`);if(v.recYds!=null&&v.recYds!==0)a.push(`${v.recYds} REC YDS`);if(v.recTd!=null&&v.recTd!==0)a.push(`${v.recTd} REC TD`);
    if(v.tkls!=null&&v.tkls!==0)a.push(`${v.tkls} TKLS`);if(v.sack!=null&&v.sack!==0)a.push(`${v.sack} SACK`);if(v.tfl!=null&&v.tfl!==0)a.push(`${v.tfl} TFL`);if(v.pd!=null&&v.pd!==0)a.push(`${v.pd} PD`);if(v.qbh!=null&&v.qbh!==0)a.push(`${v.qbh} QBH`);if(v.defInt!=null&&v.defInt!==0)a.push(`${v.defInt} DEF INT`);if(v.ff!=null&&v.ff!==0)a.push(`${v.ff} FF`);if(v.fr!=null&&v.fr!==0)a.push(`${v.fr} FR`);
    if(v.krYds!=null&&v.krYds!==0)a.push(`${v.krYds} KR YDS`);if(v.prYds!=null&&v.prYds!==0)a.push(`${v.prYds} PR YDS`);
    return a.join(', ');
  }
  function impact(v){
    const z=x=>Number(x)||0;
    return z(v.passTd)*6+z(v.rushTd)*6+z(v.recTd)*6+z(v.defInt)*5+z(v.sack)*4+z(v.ff)*4+z(v.fr)*4+z(v.tfl)*2+z(v.pd)*1.25+z(v.qbh)*.8+z(v.tkls)*.75+z(v.passYds)*.018+z(v.rushYds)*.045+z(v.recYds)*.045+z(v.krYds)*.02+z(v.prYds)*.02;
  }
  function gameForPlayer(p){return state.games.find(g=>(g.clientSchools||[]).includes(p.school))||null}

  async function applySummary(g, summary, checkedAt){
    const status=gameStatus(g);
    for(const p of gameClients(g)){
      const parsed=parsePlayerSummary(summary,p.espnId);
      state.stats.set(p.id,{
        playerId:p.id,eventId:g.id,status,
        checkedAt,found:parsed.found,reason:parsed.reason,
        values:parsed.values,raw:parsed.raw,line:parsed.found?statLine(parsed.values):''
      });
    }
  }
  async function refreshToday(auto=false){
    if(state.busy)return;
    state.busy=true; $('#refreshNow').disabled=true; progress(8);
    const d=focusDate();
    try{
      const board=await fetchScoreboard(d); mergeScoreboard(board,d); progress(35);
      const relevant=state.games.filter(g=>g.date===d && ['live','final'].includes(gameStatus(g)));
      let done=0;
      for(const g of relevant){
        const cached=[...state.stats.values()].some(x=>x.eventId===g.id&&x.status==='final');
        if(cached&&gameStatus(g)==='final'){done++;continue}
        try{const sum=await fetchSummary(g.id);await applySummary(g,sum,nowIso())}catch(e){console.warn('summary',g.id,e)}
        done++;progress(35+55*(done/Math.max(1,relevant.length)));
      }
      state.lastCheck=new Date();renderAll();progress(100);
      if(!auto)toast(`ESPN check complete · ${relevant.length} live/final client games reviewed.`);
    }catch(e){
      console.error(e);toast('ESPN refresh could not complete. Runtime will retry automatically; the master schedule baseline remains visible.',true);
      $('#autoChip').className='chip warn';$('#autoChip').textContent='ESPN RETRY · 60s';
    }finally{state.busy=false;$('#refreshNow').disabled=false}
  }
  async function refreshAll(){
    if(state.busy)return;
    state.busy=true;$('#manualRefreshAll').disabled=true;progress(2);
    try{
      const dates=[...new Set(state.games.map(g=>g.date))].sort();
      let step=0,total=dates.length;
      for(const d of dates){try{mergeScoreboard(await fetchScoreboard(d),d)}catch(e){console.warn('scoreboard',d,e)}step++;progress(5+20*(step/total))}
      const eligible=state.games.filter(g=>['live','final'].includes(gameStatus(g)));
      let done=0;
      for(const g of eligible){
        try{await applySummary(g,await fetchSummary(g.id),nowIso())}catch(e){console.warn('summary',g.id,e)}
        done++;progress(25+70*(done/Math.max(1,eligible.length)));
      }
      state.lastCheck=new Date();renderAll();progress(100);
      toast(`Manual Week 2 refresh complete · ${eligible.length} live/final games checked; upcoming games left blank.`);
    }catch(e){console.error(e);toast('Manual refresh failed before completion. Existing observations were preserved.',true)}
    finally{state.busy=false;$('#manualRefreshAll').disabled=false}
  }

  async function loadControlledPff(){
    try{
      const res=await fetch('/api/v1/performances?week=2&league=college',{cache:'no-store',credentials:'same-origin'});
      if(!res.ok)throw new Error(String(res.status));
      const payload=await res.json(),rows=Array.isArray(payload)?payload:(payload.items||payload.performances||payload.rows||[]);
      state.controlled.clear();
      for(const r of rows){
        const key=String(r.player_id||r.playerId||'')||norm(r.player||r.name);
        state.controlled.set(key,r);
      }
      renderPff();renderStats();toast(`Controlled Week 2 performance import loaded · ${rows.length} rows.`);
    }catch(e){toast('Controlled Week 2 API is not available in this preview. PFF remains manual and no external PFF request was made.');}
  }
  function controlledFor(p){return state.controlled.get(p.id)||state.controlled.get(norm(p.name))||null}
  function getPffValues(p){
    const r=controlledFor(p)||{};
    return {
      grade:r.pff ?? r.PFF ?? r.pff_grade ?? '',
      extra:r.pff_extra ?? r['PFF Extra'] ?? '',
      snaps:r.snaps ?? r['Snaps (Total, Special Teams)'] ?? ''
    };
  }

  function renderMetrics(){
    const d=focusDate(),todayGames=state.games.filter(g=>g.date===d);
    const todayClients=new Set(todayGames.flatMap(g=>gameClients(g).map(p=>p.id)));
    const liveGames=todayGames.filter(g=>gameStatus(g)==='live');
    const liveClients=new Set(liveGames.flatMap(g=>gameClients(g).map(p=>p.id)));
    $('#mClients').textContent=BASE.players.length;$('#mToday').textContent=todayClients.size;$('#mLive').textContent=liveClients.size;$('#mGames').textContent=state.games.length;
    $('#lastCheck').textContent=state.lastCheck?`Last check ${state.lastCheck.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`:'Last check —';
  }
  function renderGameCard(g){
    const status=gameStatus(g),clients=gameClients(g);
    return `<article class="game-card ${status}">
      <div><div class="status">${esc(statusLabel(g))}</div><div class="matchup">${esc(g.away)} @ ${esc(g.home)}</div>
      <div class="details">${esc(network(g))} · ${esc(venue(g))}</div>
      <div class="clients">${clients.map(p=>`<span class="client-pill">${esc(p.name)} · ${esc(p.position)}</span>`).join('')}</div></div>
      <div class="scorebox">${scoreText(g)?`<div class="score">${esc(scoreText(g))}</div>`:''}<div class="clock">${status==='live'?esc(g.runtime?.shortDetail||'LIVE'):''}</div><div class="network">${esc(network(g))}</div></div>
    </article>`;
  }
  function renderHome(){
    const d=focusDate(),today=state.games.filter(g=>g.date===d).sort((a,b)=>gameTimeMs(a)-gameTimeMs(b));
    const live=today.filter(g=>gameStatus(g)==='live');
    $('#liveGames').innerHTML=live.length?live.map(renderGameCard).join(''):`<div class="empty"><b>No tracked client game is marked LIVE right now.</b>The checker will move a game here as soon as ESPN reports it in progress.</div>`;
    $('#liveMeta').textContent=`${live.length} LIVE GAME${live.length===1?'':'S'} · ${fmtDate(d)}`;

    const upcoming=today.filter(g=>gameStatus(g)==='scheduled').slice(0,8);
    $('#nextUp').innerHTML=upcoming.length?upcoming.map(g=>`<div class="next-row"><div class="next-time">${esc(g.timeET||'TBD')}<span class="sub">ET</span></div><div><strong>${esc(g.away)} @ ${esc(g.home)}</strong><small>${gameClients(g).map(p=>p.name).join(' · ')||'Tracked client school'}</small></div><div class="next-tv">${esc(network(g))}</div></div>`).join(''):`<div class="empty"><b>No remaining scheduled client games today.</b>Completed games remain in the Week 2 master schedule.</div>`;

    const tv=today.filter(g=>network(g)!=='NOT FOUND').slice(0,7);
    $('#tvRail').innerHTML=tv.length?tv.map(g=>`<div class="next-row"><div class="next-time">${esc(g.timeET||'TBD')}</div><div><strong>${esc(g.away)} @ ${esc(g.home)}</strong><small>${gameClients(g).length} client${gameClients(g).length===1?'':'s'}</small></div><div class="next-tv">${esc(network(g))}</div></div>`).join(''):`<div class="empty"><b>TV carrier not populated yet.</b>ESPN runtime enrichment will fill carriers when available.</div>`;

    const perf=[];
    for(const p of BASE.players){
      const g=gameForPlayer(p),s=state.stats.get(p.id);
      if(!g||g.date!==d||!s?.found||!s.line)continue;
      perf.push({p,g,s,score:impact(s.values)});
    }
    perf.sort((a,b)=>b.score-a.score||a.p.name.localeCompare(b.p.name));
    $('#topPerformers').innerHTML=perf.length?perf.slice(0,6).map((x,i)=>`<article class="perf"><div class="rank">#${i+1} · ${esc(x.p.position)}</div><h3>${esc(x.p.name)}</h3><div class="school">${esc(x.p.school)} · #${esc(x.p.number??'—')}</div><div class="statline">${esc(x.s.line)}</div><span class="tag ${gameStatus(x.g)==='final'?'final':''}">${gameStatus(x.g)==='final'?'FINAL SNAPSHOT':'LIVE SNAPSHOT'}</span></article>`).join(''):`<div class="empty"><b>Waiting for ESPN player rows.</b>Top-performer cards appear only from recorded Week 2 stats; the ordering is a dashboard highlight heuristic, not an ESG or PFF grade.</div>`;
  }

  function renderSchedule(){
    const q=norm($('#scheduleSearch')?.value||'');
    let rows=state.games.filter(g=>state.scheduleDate==='all'||g.date===state.scheduleDate);
    if(q)rows=rows.filter(g=>norm(`${g.away} ${g.home} ${network(g)} ${venue(g)} ${gameClients(g).map(p=>p.name).join(' ')}`).includes(q));
    rows.sort((a,b)=>gameTimeMs(a)-gameTimeMs(b));
    $('#scheduleList').innerHTML=rows.length?rows.map(g=>`<div class="schedule-card">
      <div class="date">${esc(fmtDate(g.date))}<span class="sub">${esc(g.timeET||'TBD')} ET</span></div>
      <div class="teams">${esc(g.away)} @ ${esc(g.home)}<span class="sub">${esc(statusLabel(g))}${scoreText(g)?` · ${esc(scoreText(g))}`:''}</span></div>
      <div class="tv">${esc(network(g))}</div><div class="venue">${esc(venue(g))}</div>
      <div class="count">${gameClients(g).length} client${gameClients(g).length===1?'':'s'}<span class="sub"><a href="${esc(g.espnUrl||'#')}" target="_blank" rel="noopener">ESPN ↗</a></span></div>
    </div>`).join(''):`<div class="empty"><b>No matching games.</b>Clear the filter or search.</div>`;
    $('#scheduleMeta').textContent=`${rows.length} OF ${state.games.length} GAMES · ESPN RUNTIME ENRICHMENT`;
  }

  function stateForPlayer(p,g,s){
    if(!g)return {label:'No Week 2 game',cls:''};
    const gs=gameStatus(g);
    if(gs==='live')return {label:s?.found?'Live stats':'Live · waiting',cls:'live'};
    if(gs==='final')return {label:s?.found?'Final snapshot':'Final · no row',cls:'final'};
    return {label:'Upcoming',cls:'upcoming'};
  }
  function renderStats(){
    const q=norm($('#statsSearch')?.value||'');
    let ps=BASE.players.filter(p=>!q||norm(`${p.name} ${p.school} ${p.position}`).includes(q));
    $('#statsBody').innerHTML=ps.map(p=>{
      const g=gameForPlayer(p),s=state.stats.get(p.id),st=stateForPlayer(p,g,s),pf=getPffValues(p);
      const game=g?`${g.away} @ ${g.home}`:'No Week 2 game in baseline';
      const source=s?`ESPN · ${new Date(s.checkedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`:'Not checked';
      return `<tr><td><strong>${esc(p.name)}</strong><span class="sub">${esc(p.id)} · ${esc(p.school)} · ${esc(p.position)} #${esc(p.number??'—')}</span></td>
        <td>${esc(game)}<span class="sub">${g?`${esc(fmtDate(g.date))} · ${esc(g.timeET||'TBD')} ET`:''}</span></td>
        <td><span class="state ${st.cls}">${esc(st.label)}</span></td>
        <td>${s?.found&&s.line?`<strong>${esc(s.line)}</strong>`:`<span class="mono">${esc(s?.reason||'—')}</span>`}</td>
        <td>${pf.grade!==''?`<strong>${esc(pf.grade)}</strong>`:'—'}<span class="sub">manual / controlled</span></td>
        <td>${esc(source)}<span class="sub">${p.espnId?`ESPN ID ${esc(p.espnId)}`:'No ESPN ID'}</span></td></tr>`;
    }).join('');
  }

  function renderPff(){
    const q=norm($('#pffSearch')?.value||'');
    const ps=BASE.players.filter(p=>!q||norm(`${p.name} ${p.school}`).includes(q));
    $('#pffBody').innerHTML=ps.map(p=>{
      const pf=getPffValues(p),last=p.pff;
      return `<tr><td><strong>${esc(p.name)}</strong><span class="sub">${esc(p.id)}</span></td><td>${esc(p.school)}<span class="sub">${esc(p.position)} #${esc(p.number??'—')}</span></td>
        <td>${pf.grade!==''?`<strong>${esc(pf.grade)}</strong>`:'—'}<span class="sub">Week 2 controlled</span></td>
        <td>${pf.extra!==''?esc(pf.extra):'—'}</td><td>${pf.snaps!==''?esc(pf.snaps):'—'}</td>
        <td>${last?.grade!=null?`<strong>${esc(last.grade)}</strong><span class="sub">Week ${esc(last.week||1)} reference · ${esc(last.gameSnaps??'—')} snaps</span>`:'—'}</td></tr>`;
    }).join('');
  }
  function renderAll(){renderMetrics();renderHome();renderSchedule();renderStats();renderPff()}

  function downloadSnapshot(){
    const payload={generatedAt:nowIso(),season:2026,week:2,focusDate:focusDate(),games:state.games,playerObservations:[...state.stats.values()],rules:{blankIsNotZero:true,pffAutomatic:false,matchKey:'ESPN Athlete ID'}};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`ESG_College_Week2_ESPN_Snapshot_${focusDate()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);
  }

  $$('.nav button').forEach(b=>b.addEventListener('click',()=>{
    $$('.nav button').forEach(x=>x.classList.toggle('active',x===b));
    $$('.page').forEach(p=>p.classList.toggle('active',p.dataset.pagePanel===b.dataset.page));
  }));
  $$('.schedule-filter').forEach(b=>b.addEventListener('click',()=>{
    $$('.schedule-filter').forEach(x=>x.classList.toggle('active',x===b));state.scheduleDate=b.dataset.date;renderSchedule();
  }));
  $('#scheduleSearch').addEventListener('input',renderSchedule);
  $('#statsSearch').addEventListener('input',renderStats);
  $('#pffSearch').addEventListener('input',renderPff);
  $('#refreshNow').addEventListener('click',()=>refreshToday(false));
  $('#manualRefreshAll').addEventListener('click',refreshAll);
  $('#downloadSnapshot').addEventListener('click',downloadSnapshot);
  $('#reloadControlledPff').addEventListener('click',loadControlledPff);

  renderAll();
  refreshToday(true);
  loadControlledPff();
  setInterval(()=>refreshToday(true),AUTO_MS);
})();
