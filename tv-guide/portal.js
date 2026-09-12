(() => {
  'use strict';
  const DATA = window.ESG_DATA || {};
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const dateObj = iso => new Date(`${iso}T12:00:00`);
  const localToday = () => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone:'America/New_York', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
    const get = t => parts.find(p => p.type === t)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  };
  const TODAY = localToday();

  const masterGames = league => league === 'college' ? (DATA.college?.clientGames || []) : (DATA.nfl?.games || []);
  const weeks = league => [...new Set(masterGames(league).map(g => Number(g.week)).filter(Number.isFinite))].sort((a,b)=>a-b);
  const datesForWeek = (league, week) => [...new Set(masterGames(league).filter(g => Number(g.week)===Number(week) && g.date).map(g=>g.date))].sort();
  const closestWeek = league => {
    const ws = weeks(league); if (!ws.length) return 1;
    const target = dateObj(TODAY).getTime(); let best=ws[0], bestDist=Infinity;
    for (const w of ws) {
      const ds=datesForWeek(league,w); if (!ds.length) continue;
      const a=dateObj(ds[0]).getTime(), b=dateObj(ds[ds.length-1]).getTime();
      if(target>=a && target<=b) return w;
      const d=Math.min(Math.abs(target-a),Math.abs(target-b)); if(d<bestDist){bestDist=d;best=w;}
    }
    return best;
  };
  const md = iso => new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric'}).format(dateObj(iso));
  const range = (league,week) => { const ds=datesForWeek(league,week); if(!ds.length)return 'Dates TBD'; if(ds.length===1)return md(ds[0]); const a=dateObj(ds[0]),b=dateObj(ds.at(-1)); return a.getMonth()===b.getMonth()?`${new Intl.DateTimeFormat('en-US',{month:'short'}).format(a)} ${a.getDate()}–${b.getDate()}`:`${md(ds[0])}–${md(ds.at(-1))}`; };
  const dayLabel = iso => new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric'}).format(dateObj(iso)).toUpperCase();
  const timeMinutes = raw => {
    const m=String(raw||'').match(/(\d{1,2}):(\d{2})\s*([AP]M)/i); if(!m)return 9999;
    let h=Number(m[1])%12; if(m[3].toUpperCase()==='PM')h+=12; return h*60+Number(m[2]);
  };

  function clientsForGame(league,g){
    if(league==='college'){
      const ids=(g.clientSchools||[]).flatMap(s=>DATA.college?.playersBySchool?.[s]||[]);
      const byId=Object.fromEntries((DATA.college?.players||[]).map(p=>[String(p.id),p]));
      return ids.map(id=>byId[String(id)]).filter(Boolean);
    }
    const names=(g.clientTeams||[]).flatMap(t=>DATA.nfl?.playersByTeam?.[t]||[]);
    const byName=Object.fromEntries((DATA.nfl?.players||[]).map(p=>[p.name,p]));
    return names.map(n=>byName[n]).filter(Boolean);
  }

  function renderSummary(league,prefix){
    const week=closestWeek(league);
    const gs=masterGames(league).filter(g=>Number(g.week)===week && g.date && (league==='college' ? (g.clientSchools||[]).length : (g.clientTeams||[]).length));
    gs.sort((a,b)=>a.date.localeCompare(b.date) || timeMinutes(a.timeET)-timeMinutes(b.timeET));
    const playerSet=new Set(gs.flatMap(g=>clientsForGame(league,g).map(p=>p.id||p.espnId||p.name)));
    const dates=new Set(gs.map(g=>g.date));
    const badge=$(`#${prefix}WeekBadge`); if(badge) badge.textContent=`WEEK ${week} · ${range(league,week).toUpperCase()}`;
    const stats=$(`#${prefix}SummaryStats`); if(stats) stats.innerHTML=[['Client games',gs.length],['Clients in action',playerSet.size],['Game days',dates.size]].map(([l,v])=>`<div><strong>${esc(v)}</strong><span>${esc(l)}</span></div>`).join('');
    const list=$(`#${prefix}SummaryGames`);
    if(list){
      const next=gs.filter(g=>g.date>=TODAY).slice(0,4); const show=next.length?next:gs.slice(-4);
      list.innerHTML=show.length?show.map(g=>{const ps=clientsForGame(league,g);return `<div class="summary-game-row"><div><span>${esc(dayLabel(g.date))} · ${esc(g.timeET||'TBD')} ET</span><b>${esc(g.away)} at ${esc(g.home)}</b><small>${esc(ps.slice(0,3).map(p=>p.name).join(' · '))}${ps.length>3?` +${ps.length-3}`:''}</small></div><em>${ps.length} CLIENT${ps.length===1?'':'S'}</em></div>`}).join(''):'<div class="summary-empty">No dated client games in this week.</div>';
    }
    const link=$(`#${prefix}MoreLink`); if(link) link.href=`/${league==='college'?'college':'nfl'}?week=${week}`;
  }
  renderSummary('college','nil');
  renderSummary('nfl','nfl');
})();
