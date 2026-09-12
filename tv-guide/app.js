(() => {
  'use strict';

  const DATA = window.ESG_DATA || {};
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const dateObj = iso => new Date(`${iso}T12:00:00`);
  const addDays = (iso, n) => { const d = dateObj(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const ymd = iso => iso.replaceAll('-', '');
  const fmtHeading = iso => new Intl.DateTimeFormat('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' }).format(dateObj(iso));
  const fmtPill = iso => ({
    dow: new Intl.DateTimeFormat('en-US', { weekday:'short' }).format(dateObj(iso)),
    date: new Intl.DateTimeFormat('en-US', { month:'short', day:'numeric' }).format(dateObj(iso))
  });
  const localToday = () => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone:'America/New_York', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
    const get = t => parts.find(p => p.type === t)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  };
  const TODAY = localToday();
  const PAGE_LEAGUE = document.body?.dataset?.league;

  const state = {
    league: PAGE_LEAGUE || localStorage.getItem('esg-tv-league-v2') || 'college',
    date: TODAY,
    week: Number(new URLSearchParams(location.search).get('week')) || null,
    filter: 'clients',
    tz: localStorage.getItem('esg-tv-tz-v2') || 'America/New_York',
    search: '',
    games: [],
    sourceMode: '',
    loading: false,
    openGameId: null,
    pffMode: 'pending',
    pffCheckedAt: null,
  };

  const collegePlayersById = Object.fromEntries((DATA.college?.players || []).map(p => [String(p.id), p]));
  const nflPlayersByName = Object.fromEntries((DATA.nfl?.players || []).map(p => [p.name, p]));
  let pffLeaderboardTimer = null;
  let pffLeaderboardMode = 'offense';

  function masterGamesForLeague(league = state.league) {
    return league === 'college' ? (DATA.college?.clientGames || []) : (DATA.nfl?.games || []);
  }

  function weekNumbers(league = state.league) {
    return [...new Set(masterGamesForLeague(league).map(g => Number(g.week)).filter(Number.isFinite))].sort((a,b) => a-b);
  }

  function weekGames(week = state.week, league = state.league) {
    return masterGamesForLeague(league).filter(g => Number(g.week) === Number(week) && g.date);
  }

  function selectedWeekDates(week = state.week, league = state.league) {
    return [...new Set(weekGames(week, league).map(g => g.date).filter(Boolean))].sort();
  }

  function closestWeekForDate(league = state.league, iso = TODAY) {
    const weeks = weekNumbers(league);
    if (!weeks.length) return 1;
    const target = dateObj(iso).getTime();
    let best = weeks[0], bestDist = Infinity;
    for (const w of weeks) {
      const ds = selectedWeekDates(w, league);
      if (!ds.length) continue;
      const first = dateObj(ds[0]).getTime(), last = dateObj(ds[ds.length - 1]).getTime();
      if (target >= first && target <= last) return w;
      const dist = Math.min(Math.abs(target-first), Math.abs(target-last));
      if (dist < bestDist) { bestDist = dist; best = w; }
    }
    return best;
  }

  function monthDay(iso) {
    return new Intl.DateTimeFormat('en-US', { month:'short', day:'numeric' }).format(dateObj(iso));
  }

  function weekRangeLabel(week = state.week, league = state.league) {
    const ds = selectedWeekDates(week, league);
    if (!ds.length) return 'Dates TBD';
    if (ds.length === 1) return monthDay(ds[0]);
    const a = dateObj(ds[0]), b = dateObj(ds[ds.length - 1]);
    const sameMonth = a.getMonth() === b.getMonth();
    if (sameMonth) return `${new Intl.DateTimeFormat('en-US',{month:'short'}).format(a)} ${a.getDate()}–${b.getDate()}`;
    return `${monthDay(ds[0])}–${monthDay(ds[ds.length - 1])}`;
  }

  function weekHeading() {
    return `Week ${state.week} · ${weekRangeLabel()}`;
  }

  function gameDayParts(g) {
    const iso = g.date || (g.startDate || '').slice(0,10);
    if (!iso) return { dow:'DAY TBD', date:'DATE TBD' };
    return {
      dow: new Intl.DateTimeFormat('en-US', {weekday:'short'}).format(dateObj(iso)).toUpperCase(),
      date: new Intl.DateTimeFormat('en-US', {month:'short', day:'numeric'}).format(dateObj(iso)).toUpperCase()
    };
  }

  if (!state.week || !weekNumbers(state.league).includes(state.week)) state.week = closestWeekForDate(state.league, TODAY);
  state.date = selectedWeekDates(state.week, state.league)[0] || TODAY;

  function tzShort(tz) {
    return tz === 'America/New_York' ? 'ET' : tz === 'America/Chicago' ? 'CT' : tz === 'America/Denver' ? 'MT' : tz === 'America/Los_Angeles' ? 'PT' : 'LOCAL';
  }

  function initials(name) {
    return String(name || '?').split(/\s+/).filter(Boolean).map(x => x[0]).join('').slice(0, 2).toUpperCase();
  }

  function namesMatch(a, b) {
    const x = norm(a), y = norm(b);
    return x === y || (x.length > 4 && y.startsWith(x)) || (y.length > 4 && x.startsWith(y));
  }

  function sameMatchup(a, b) {
    return (namesMatch(a.away, b.away) && namesMatch(a.home, b.home)) || (namesMatch(a.away, b.home) && namesMatch(a.home, b.away));
  }

  function parseMasterTimeToDate(dateISO, timeET) {
    if (!timeET || timeET === 'TBD') return null;
    const m = String(timeET).match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
    if (!m) return null;
    let hour = Number(m[1]) % 12;
    if (m[3].toUpperCase() === 'PM') hour += 12;
    const [Y, M, D] = dateISO.split('-').map(Number);
    const wallUtc = Date.UTC(Y, M - 1, D, hour, Number(m[2]));
    const guess = new Date(wallUtc);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone:'America/New_York', timeZoneName:'longOffset', hour:'2-digit' }).formatToParts(guess);
    const z = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT-04:00';
    const om = z.match(/GMT([+-])(\d{2}):(\d{2})/);
    let off = -240;
    if (om) {
      const mins = Number(om[2]) * 60 + Number(om[3]);
      off = (om[1] === '+' ? 1 : -1) * mins;
    }
    return new Date(wallUtc - off * 60000);
  }

  function displayTime(game) {
    if (game.timeET === 'TBD' && !game.startDate) return { time:'TBD', zone:tzShort(state.tz) };
    const d = game.startDate ? new Date(game.startDate) : parseMasterTimeToDate(game.date, game.timeET);
    if (!d) return { time:game.timeET || 'TBD', zone:tzShort(state.tz) };
    const tz = state.tz === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone : state.tz;
    return {
      time: new Intl.DateTimeFormat('en-US', { timeZone:tz, hour:'numeric', minute:'2-digit' }).format(d),
      zone: tzShort(state.tz)
    };
  }

  function hrefByRel(links, needles) {
    const ls = links || [];
    const hit = ls.find(l => {
      const rel = (l.rel || []).join(' ').toLowerCase();
      const text = String(l.text || l.shortText || '').toLowerCase();
      return needles.some(n => rel.includes(n) || text.includes(n));
    });
    return hit?.href || null;
  }

  function teamLinks(team) {
    const links = team?.links || [];
    return {
      overview: hrefByRel(links, ['clubhouse', 'team', 'overview']),
      roster: hrefByRel(links, ['roster']),
      stats: hrefByRel(links, ['stat']),
      schedule: hrefByRel(links, ['schedule']),
    };
  }

  function athleteUrl(athlete) {
    return hrefByRel(athlete?.links || [], ['player', 'athlete', 'profile']) || athlete?.links?.[0]?.href || null;
  }

  function teamLeaderRows(competitor) {
    const priorities = ['passingyards','rushingyards','receivingyards','totaltackles','sacks','interceptions','scoring'];
    const rows = (competitor?.leaders || []).flatMap(group => {
      const lead = group?.leaders?.[0];
      const a = lead?.athlete;
      if (!a) return [];
      return [{
        category: group.shortDisplayName || group.displayName || group.name || 'Leader',
        key: norm(group.name || group.displayName || ''),
        name: a.displayName || a.shortName || 'Team leader',
        value: lead.displayValue || (lead.value != null ? String(lead.value) : ''),
        headshot: a.headshot?.href || null,
        url: athleteUrl(a),
      }];
    });
    return rows.sort((a, b) => {
      const ai = priorities.findIndex(p => a.key.includes(p));
      const bi = priorities.findIndex(p => b.key.includes(p));
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
  }

  function espnVenueWeather(comp = {}, gameInfo = {}) {
    const venue = gameInfo.venue || comp.venue || {};
    const weather = gameInfo.weather || comp.weather || {};
    const location = [venue.address?.city, venue.address?.state].filter(Boolean).join(', ');
    const temperature = weather.temperature != null && weather.temperature !== '' ? Number(weather.temperature) : null;
    const weatherText = weather.displayValue || weather.condition || weather.description || '';
    const weatherLink = weather.link?.href || weather.link || null;
    return {
      venueName: venue.fullName || null,
      venueLocation: location || null,
      venue: [venue.fullName, location].filter(Boolean).join(' · ') || null,
      venueIndoor: venue.indoor === true ? true : venue.indoor === false ? false : null,
      venueCapacity: venue.capacity ?? null,
      neutralSite: comp.neutralSite === true,
      weather: (temperature != null || weatherText) ? {
        temperature: Number.isFinite(temperature) ? temperature : null,
        displayValue: weatherText || null,
        highTemperature: weather.highTemperature ?? null,
        conditionId: weather.conditionId ?? null,
        link: weatherLink,
      } : null,
    };
  }

  function weatherLabel(g) {
    if (g.venueIndoor === true && !g.weather) return 'Indoor';
    const w = g.weather;
    if (!w) return 'Weather not listed by ESPN';
    const parts = [];
    if (w.temperature != null && Number.isFinite(Number(w.temperature))) parts.push(`${Math.round(Number(w.temperature))}°`);
    if (w.displayValue) parts.push(w.displayValue);
    return parts.join(' · ') || 'Weather not listed by ESPN';
  }

  function eventFromEspn(e, league) {
    const comp = e.competitions?.[0] || {};
    const cs = comp.competitors || [];
    const away = cs.find(c => c.homeAway === 'away') || cs[0] || {};
    const home = cs.find(c => c.homeAway === 'home') || cs[1] || {};
    const broadcasts = [...new Set((comp.broadcasts || []).flatMap(b => b.names || []).filter(Boolean))];
    const venueWeather = espnVenueWeather(comp);
    const rank = c => { const r = c.curatedRank?.current; return r && r < 99 ? r : null; };
    const rec = c => (c.records || []).find(r => r.type === 'total')?.summary || (c.records || [])[0]?.summary || '';
    const status = e.status?.type || {};
    const gamePath = league === 'college' ? 'college-football' : 'nfl';

    const makeTeam = c => ({
      id: String(c.team?.id || ''),
      name: c.team?.displayName || c.team?.shortDisplayName || '',
      abbreviation: c.team?.abbreviation || '',
      slug: c.team?.slug || '',
      logo: c.team?.logo || '',
      record: rec(c),
      rank: rank(c),
      score: c.score ?? '',
      links: teamLinks(c.team),
      leaders: teamLeaderRows(c),
    });

    const awayTeam = makeTeam(away), homeTeam = makeTeam(home);
    const g = {
      id: String(e.id),
      date: (e.date || '').slice(0, 10),
      startDate: e.date,
      timeET: null,
      away: awayTeam.name,
      home: homeTeam.name,
      awayId: awayTeam.id,
      homeId: homeTeam.id,
      awayLogo: awayTeam.logo,
      homeLogo: homeTeam.logo,
      rankAway: awayTeam.rank,
      rankHome: homeTeam.rank,
      recordAway: awayTeam.record,
      recordHome: homeTeam.record,
      scoreAway: awayTeam.score,
      scoreHome: homeTeam.score,
      network: broadcasts.length ? broadcasts.join(' / ') : null,
      ...venueWeather,
      statusState: status.state || 'pre',
      statusText: status.shortDetail || status.detail || status.description || 'Scheduled',
      espnUrl: `https://www.espn.com/${gamePath}/game/_/gameId/${e.id}`,
      source: 'espn',
      espnFound: true,
      clientSchools: [],
      clientTeams: [],
      awayEspn: awayTeam,
      homeEspn: homeTeam,
    };

    if (league === 'college') {
      const schools = Object.keys(DATA.college?.playersBySchool || {});
      [g.away, g.home].forEach(teamName => {
        const s = schools.find(x => namesMatch(x, teamName));
        if (s && !g.clientSchools.includes(s)) g.clientSchools.push(s);
      });
    } else {
      const teams = Object.keys(DATA.nfl?.playersByTeam || {});
      [g.away, g.home].forEach(teamName => {
        const t = teams.find(x => namesMatch(x, teamName));
        if (t && !g.clientTeams.includes(t)) g.clientTeams.push(t);
      });
    }
    return g;
  }

  async function fetchJson(url, timeout = 6000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(url, { signal:ctrl.signal, cache:'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally { clearTimeout(timer); }
  }

  async function fetchEspnEndpoint(league, date, group = null) {
    const direct = `https://site.api.espn.com/apis/site/v2/sports/football/${league}/scoreboard?dates=${ymd(date)}&limit=1000${group ? `&groups=${group}` : ''}`;
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      const proxy = `/api/espn?league=${encodeURIComponent(league)}&date=${ymd(date)}${group ? `&group=${group}` : ''}`;
      try { return await fetchJson(proxy, 5500); } catch (_) {}
    }
    return fetchJson(direct, 6000);
  }

  async function fetchEspnSummary(gameId) {
    const league = state.league === 'college' ? 'college-football' : 'nfl';
    const direct = `https://site.api.espn.com/apis/site/v2/sports/football/${league}/summary?event=${encodeURIComponent(gameId)}`;
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      const proxy = `/api/espn-summary?league=${encodeURIComponent(league)}&event=${encodeURIComponent(gameId)}`;
      try { return await fetchJson(proxy, 6000); } catch (_) {}
    }
    return fetchJson(direct, 6500);
  }


  async function fetchPffSchedule() {
    // Week 2 Command Center policy: PFF is manual. Keep the normal PFF display
    // surfaces, but do not make any automatic PFF network request.
    throw new Error('PFF automatic verification disabled by Week 2 manual-only policy');
  }

  function pffTeamVariants(g, side) {
    const team = g[`${side}Espn`] || {};
    const raw = String(g[side] || '').replace(/^#\d+\s*/, '').trim();
    const parts = raw.split(/\s+/).filter(Boolean);
    const variants = [raw, team.abbreviation, team.slug && String(team.slug).replace(/-/g, ' ')];
    if (parts.length > 1) variants.push(parts.slice(0, -1).join(' '), parts[parts.length - 1]);
    return [...new Set(variants.filter(Boolean).map(v => String(v).toLowerCase().replace(/[^a-z0-9+ ]/g, ' ').replace(/\s+/g, ' ').trim()).filter(v => v.length >= 3))]
      .sort((a,b) => b.length - a.length);
  }

  function findVariantIndex(text, variants, start = 0) {
    for (const v of variants) {
      const i = text.indexOf(v, start);
      if (i >= 0) return { index:i, value:v };
    }
    return null;
  }

  function extractPffNetwork(snippet) {
    const patterns = [
      /ESPN\+/i, /NFL\s*NETWORK|NFLN/i, /NETFLIX|NFLX\d*/i, /AMAZON\s*PRIME|PRIME\s*VIDEO|PRIME/i,
      /PEACOCK/i, /CBSSN/i, /CBS(?:\/P\d+)?/i, /NBC(?:\/P\d+)?/i, /ABC(?:\/E\d+)?/i,
      /ESPN2|ESPN(?:\d+)?/i, /FOX(?:\d+)?/i, /FS1|FS2/i, /ACCN/i, /SECN|SEC\s*NETWORK/i,
      /BTN|BIG\s*TEN\s*NETWORK/i, /THE\s*CW|\bCW\b/i
    ];
    for (const rx of patterns) {
      const m = snippet.match(rx);
      if (m) return m[0].replace(/\s+/g, ' ').trim();
    }
    return null;
  }

  function canonicalPffNetwork(raw) {
    const u = String(raw || '').toUpperCase();
    if (!u) return null;
    if (/NFLX|NETFLIX/.test(u)) return 'Netflix';
    if (/AMAZON|PRIME/.test(u)) return 'Prime Video';
    if (/ESPN\+/.test(u)) return 'ESPN+';
    if (/ABC\/E2/.test(u)) return 'ABC / ESPN2';
    if (/ABC/.test(u)) return 'ABC';
    if (/CBSSN/.test(u)) return 'CBSSN';
    if (/CBS/.test(u)) return /P\d/.test(u) ? 'CBS / Paramount+' : 'CBS';
    if (/NBC/.test(u)) return /P\d/.test(u) ? 'NBC / Peacock' : 'NBC';
    if (/PEACOCK/.test(u)) return 'Peacock';
    if (/FOX/.test(u)) return 'FOX';
    if (/FS1/.test(u)) return 'FS1';
    if (/FS2/.test(u)) return 'FS2';
    if (/NFL\s*NETWORK|NFLN/.test(u)) return 'NFL Network';
    if (/ACCN/.test(u)) return 'ACCN';
    if (/SECN|SEC\s*NETWORK/.test(u)) return 'SEC Network';
    if (/BTN|BIG\s*TEN/.test(u)) return 'Big Ten Network';
    if (/CW/.test(u)) return 'The CW';
    if (/ESPN2/.test(u)) return 'ESPN2';
    if (/ESPN/.test(u)) return 'ESPN';
    return raw;
  }

  function tvFamilies(raw) {
    const u = String(raw || '').toUpperCase();
    const out = new Set();
    if (/ESPN\+/.test(u)) out.add('ESPNPLUS');
    if (/ESPN2|\bE2\b|\/E2/.test(u)) out.add('ESPN2');
    if (/\bESPN\b/.test(u) && !/ESPN\+/.test(u)) out.add('ESPN');
    if (/ABC/.test(u)) out.add('ABC');
    if (/FOX/.test(u) && !/FS1|FS2/.test(u)) out.add('FOX');
    if (/FS1/.test(u)) out.add('FS1');
    if (/FS2/.test(u)) out.add('FS2');
    if (/CBS/.test(u) && !/CBSSN/.test(u)) out.add('CBS');
    if (/CBSSN/.test(u)) out.add('CBSSN');
    if (/NBC/.test(u)) out.add('NBC');
    if (/PEACOCK|\/P\d/.test(u)) out.add('PEACOCK');
    if (/PARAMOUNT/.test(u) || (/CBS/.test(u) && /\/P\d/.test(u))) out.add('PARAMOUNT');
    if (/NFL\s*NETWORK|NFLN/.test(u)) out.add('NFLN');
    if (/NETFLIX|NFLX/.test(u)) out.add('NETFLIX');
    if (/PRIME|AMAZON/.test(u)) out.add('PRIME');
    if (/ACCN/.test(u)) out.add('ACCN');
    if (/SECN|SEC\s*NETWORK/.test(u)) out.add('SECN');
    if (/BTN|BIG\s*TEN\s*NETWORK/.test(u)) out.add('BTN');
    if (/THE\s*CW|\bCW\b/.test(u)) out.add('CW');
    return out;
  }

  function networksAgree(espn, pff) {
    const a = tvFamilies(espn), b = tvFamilies(pff);
    if (!a.size || !b.size) return false;
    for (const x of a) if (b.has(x)) return true;
    // PFF shorthand can show an OTA network plus its streaming simulcast.
    if (a.has('CBS') && b.has('PARAMOUNT')) return true;
    if (a.has('NBC') && b.has('PEACOCK')) return true;
    if (a.has('ABC') && b.has('ESPN2')) return true;
    return false;
  }

  function findPffMatchForGame(g, payload) {
    const text = String(payload?.text || '').toLowerCase();
    if (!text) return { status:'unavailable', network:null, raw:null };
    const allHits = variants => {
      const hits = [];
      variants.forEach(v => {
        let i = text.indexOf(v), n = 0;
        while (i >= 0 && n < 24) { hits.push({v,i}); i = text.indexOf(v, i + Math.max(1, v.length)); n++; }
      });
      return hits;
    };
    const awayHits = allHits(pffTeamVariants(g, 'away'));
    const homeHits = allHits(pffTeamVariants(g, 'home'));
    let best = null;
    for (const a of awayHits) {
      for (const h of homeHits) {
        const dist = Math.abs(h.i - a.i);
        if (dist > 520) continue;
        const end = Math.max(a.i + a.v.length, h.i + h.v.length);
        const start = Math.max(0, Math.min(a.i, h.i) - 40);
        const after = text.slice(end, Math.min(text.length, end + 180));
        const around = text.slice(start, Math.min(text.length, end + 220));
        const raw = extractPffNetwork(after) || extractPffNetwork(around);
        const score = dist + (raw ? 0 : 1000);
        if (!best || score < best.score) best = {a,h,score,raw};
      }
    }
    if (!best) return { status:'not_matched', network:null, raw:null };
    const network = canonicalPffNetwork(best.raw);
    if (!network) return { status:'matched_no_tv', network:null, raw:null };
    if (!networkFound(g)) return { status:'pff_only', network, raw:best.raw };
    return { status: networksAgree(g.network, network) ? 'verified' : 'mismatch', network, raw:best.raw };
  }

  function applyPffVerification(games, payload) {
    games.forEach(g => { g.pffTv = findPffMatchForGame(g, payload); });
    state.pffMode = payload?.ok ? 'PFF schedule checked' : 'PFF verification unavailable';
    state.pffCheckedAt = payload?.fetchedAt || null;
  }

  function pffVerificationLabel(g, compact = false) {
    const v = g.pffTv || {status:'unavailable'};
    if (v.status === 'verified') return { cls:'verified', text: compact ? 'PFF ✓' : `PFF VERIFIED${v.network ? ` · ${v.network}` : ''}` };
    if (v.status === 'mismatch') return { cls:'mismatch', text: compact ? 'PFF CHECK' : `PFF CHECK · ${v.network || 'different TV'}` };
    if (v.status === 'pff_only') return { cls:'pff-only', text: compact ? 'PFF TV' : `PFF LISTS · ${v.network}` };
    if (v.status === 'matched_no_tv') return { cls:'not-matched', text: compact ? 'PFF —' : 'PFF MATCHED · TV NOT LISTED' };
    if (v.status === 'not_matched') return { cls:'not-matched', text: compact ? 'PFF —' : 'PFF NOT MATCHED' };
    return { cls:'not-matched', text: compact ? 'PFF —' : 'PFF UNAVAILABLE' };
  }

  function applyEspnSummary(g, data) {
    const comp = data?.header?.competitions?.[0] || {};
    const vw = espnVenueWeather(comp, data?.gameInfo || {});
    Object.assign(g, Object.fromEntries(Object.entries(vw).filter(([, v]) => v != null)));
    g.espnDetailLoaded = true;
    return g;
  }

  async function fetchEspnCollege(date) {
    const rs = await Promise.allSettled([80, 81].map(g => fetchEspnEndpoint('college-football', date, g)));
    const events = [], seen = new Set();
    rs.forEach(r => {
      if (r.status !== 'fulfilled') return;
      (r.value.events || []).forEach(e => {
        const id = String(e.id);
        if (!seen.has(id)) { seen.add(id); events.push(e); }
      });
    });
    if (!events.length) throw new Error('No ESPN college events returned');
    return events.map(e => eventFromEspn(e, 'college'));
  }

  async function fetchEspnNFL(date) {
    const d = await fetchEspnEndpoint('nfl', date);
    if (!(d.events || []).length) throw new Error('No ESPN NFL events returned');
    return (d.events || []).map(e => eventFromEspn(e, 'nfl'));
  }

  function gameKey(g) {
    return String(g.id || '') || `${g.date}|${norm(g.away)}|${norm(g.home)}`;
  }

  function dedupe(gs) {
    const m = new Map();
    gs.forEach(g => { const k = gameKey(g); if (!m.has(k)) m.set(k, g); });
    return [...m.values()];
  }

  function missingEspnPlaceholder(c) {
    return {
      ...c,
      network: null,
      venue: null,
      venueName: null,
      venueLocation: null,
      venueIndoor: null,
      weather: null,
      espnFound: false,
      source: 'client-master-placeholder',
      statusState: 'pre',
      statusText: 'ESPN NOT FOUND',
      awayEspn: null,
      homeEspn: null,
    };
  }

  function mergeCollege(live, date) {
    const clientGames = (DATA.college?.clientGames || []).filter(g => g.date === date);
    const games = [...live];
    clientGames.forEach(c => {
      const g = games.find(x => String(x.id) === String(c.id)) || games.find(x => sameMatchup(x, c));
      if (g) {
        g.clientSchools = [...new Set([...(g.clientSchools || []), ...(c.clientSchools || [])])];
      } else {
        games.push(missingEspnPlaceholder(c));
      }
    });
    return dedupe(games);
  }

  function mergeNFL(live, date) {
    const masterClientGames = (DATA.nfl?.games || []).filter(g => g.date === date && (g.clientTeams || []).length);
    const games = [...live];
    masterClientGames.forEach(c => {
      const g = games.find(x => String(x.id) === String(c.id)) || games.find(x => sameMatchup(x, c));
      if (g) {
        g.clientTeams = [...new Set([...(g.clientTeams || []), ...(c.clientTeams || [])])];
      } else {
        games.push(missingEspnPlaceholder(c));
      }
    });
    return dedupe(games);
  }

  async function loadSchedule(showLoading = true) {
    state.loading = true;
    state.pffMode = 'checking PFF…';
    if (showLoading) renderLoading();
    const dates = selectedWeekDates();
    state.date = dates[0] || TODAY;
    let warning = '';
    const pffPromise = fetchPffSchedule().catch(() => null);
    const fetchOne = async date => {
      try {
        const live = state.league === 'college' ? await fetchEspnCollege(date) : await fetchEspnNFL(date);
        return { date, ok:true, games: state.league === 'college' ? mergeCollege(live, date) : mergeNFL(live, date) };
      } catch (err) {
        return { date, ok:false, games: state.league === 'college' ? mergeCollege([], date) : mergeNFL([], date) };
      }
    };
    const results = await Promise.all(dates.map(fetchOne));
    const failed = results.filter(r => !r.ok);
    state.games = dedupe(results.flatMap(r => r.games));
    state.sourceMode = failed.length ? `ESPN partial week (${dates.length-failed.length}/${dates.length} dates)` : 'ESPN live weekly schedule';
    if (!dates.length) {
      warning = `No dated games are available in the current master for Week ${state.week}.`;
    } else if (failed.length) {
      warning = `ESPN did not return ${failed.length} date${failed.length===1?'':'s'} in Week ${state.week}. Client-game placeholders remain visible for those dates; PFF is never used to replace ESPN schedule or TV fields.`;
    }
    const pffPayload = await pffPromise;
    if (pffPayload?.ok && pffPayload?.text) {
      applyPffVerification(state.games, pffPayload);
    } else {
      state.games.forEach(g => { g.pffTv = {status:'unavailable', network:null}; });
      state.pffMode = 'PFF verification unavailable';
      if (!warning) warning = 'PFF schedule verification is temporarily unavailable. ESPN remains the primary display source and no TV value is being backfilled.';
    }
    state.loading = false;
    $('#sourceBanner').textContent = warning;
    $('#sourceBanner').classList.toggle('hidden', !warning);
    renderAll();
  }

  function clientPlayers(g) {
    if (state.league === 'college') {
      return (g.clientSchools || []).flatMap(s => (DATA.college?.playersBySchool?.[s] || []).map(id => collegePlayersById[String(id)]).filter(Boolean));
    }
    return (g.clientTeams || []).flatMap(t => (DATA.nfl?.playersByTeam?.[t] || []).map(n => nflPlayersByName[n]).filter(Boolean));
  }

  function hasClient(g) { return clientPlayers(g).length > 0; }
  function networkFound(g) { return !!String(g.network || '').trim(); }
  function isStreaming(g) { return /espn\+|\+|peacock|paramount|prime|disney|max|netflix/i.test(g.network || ''); }
  function isRanked(g) { return !!(g.rankAway || g.rankHome); }
  function gameSearchText(g) { return [g.away, g.home, g.network, g.venueName, g.venueLocation, weatherLabel(g), ...clientPlayers(g).map(p => p.name)].join(' ').toLowerCase(); }

  function filteredGames() {
    let gs = [...state.games];
    if (state.filter === 'clients') gs = gs.filter(hasClient);
    if (state.filter === 'tv') gs = gs.filter(networkFound);
    if (state.filter === 'missing') gs = gs.filter(g => !networkFound(g));
    if (state.filter === 'ranked') gs = gs.filter(isRanked);
    if (state.filter === 'streaming') gs = gs.filter(isStreaming);
    if (state.search.trim()) {
      const q = state.search.trim().toLowerCase();
      gs = gs.filter(g => gameSearchText(g).includes(q));
    }
    const order = { in:0, pre:1, post:2 };
    return gs.sort((a, b) => {
      const sa = order[a.statusState] ?? 1, sb = order[b.statusState] ?? 1;
      if (sa !== sb) return sa - sb;
      const da = a.startDate ? new Date(a.startDate) : parseMasterTimeToDate(a.date, a.timeET);
      const db = b.startDate ? new Date(b.startDate) : parseMasterTimeToDate(b.date, b.timeET);
      if (da && db && da - db !== 0) return da - db;
      if (da && !db) return -1;
      if (!da && db) return 1;
      return (a.away || '').localeCompare(b.away || '');
    });
  }

  function pffTone(grade) {
    const g = Number(grade);
    if (g >= 90) return 'elite';
    if (g >= 80) return 'great';
    if (g >= 70) return 'good';
    if (g >= 60) return 'average';
    return 'low';
  }

  function pffClients(g) {
    return clientPlayers(g).filter(p => p.pff?.grade != null).sort((a, b) => Number(b.pff.grade) - Number(a.pff.grade));
  }

  function clientHeadshot(p) {
    if (!p.espnId) return null;
    const sport = state.league === 'college' ? 'college-football' : 'nfl';
    return `https://a.espncdn.com/i/headshots/${sport}/players/full/${p.espnId}.png`;
  }

  function imgOrFallback(src, alt, cls = 'avatar') {
    if (!src) return `<span class="${cls} ${cls}-fallback">${esc(initials(alt))}</span>`;
    return `<span class="${cls}"><img src="${esc(src)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('${cls}-fallback');this.parentElement.textContent='${esc(initials(alt))}'"></span>`;
  }

  function teamBlock(g, side) {
    const e = g[`${side}Espn`];
    const name = g[side];
    const logo = g[`${side}Logo`] || e?.logo || null;
    const rank = g[side === 'away' ? 'rankAway' : 'rankHome'];
    const record = g[side === 'away' ? 'recordAway' : 'recordHome'] || '';
    const score = g[side === 'away' ? 'scoreAway' : 'scoreHome'];
    const clientTeam = state.league === 'college'
      ? (g.clientSchools || []).some(s => namesMatch(s, name))
      : (g.clientTeams || []).some(t => namesMatch(t, name));
    const leader = e?.leaders?.[0];
    const links = e?.links || {};
    const linkHtml = [
      ['Roster', links.roster], ['Statistics', links.stats], ['Schedule', links.schedule]
    ].filter(x => x[1]).map(([label, href]) => `<a href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`).join('<span>·</span>');
    return `<div class="team-block ${clientTeam ? 'client-team-block' : ''}">
      <div class="team-identity">
        <span class="team-logo-box">${logo ? `<img src="${esc(logo)}" alt="" loading="lazy">` : `<span>${esc(initials(name))}</span>`}</span>
        <div class="team-copy"><div class="team-name-line">${rank ? `<span class="rank-no">${esc(rank)}</span>` : ''}<strong>${esc(name)}</strong>${clientTeam ? '<span class="client-team-tag">CLIENT</span>' : ''}</div><div class="team-record">${esc(record || 'Record not listed')}</div></div>
        ${score !== '' && score != null ? `<div class="team-score">${esc(score)}</div>` : ''}
      </div>
      ${leader ? `<div class="team-leader-mini">${imgOrFallback(leader.headshot, leader.name, 'leader-avatar')}<div><strong>${esc(leader.name)}</strong><span>${esc(leader.value)}</span></div></div>` : ''}
      ${linkHtml ? `<div class="espn-inline-links">${linkHtml}</div>` : ''}
    </div>`;
  }

  function clientMini(p) {
    const pff = p.pff?.grade != null ? `<span class="pff-chip ${pffTone(p.pff.grade)}">PFF ${esc(p.pff.grade)}</span>` : '<span class="pff-chip unavailable">PFF —</span>';
    const url = p.espnUrl || '#';
    return `<a class="client-mini" href="${esc(url)}" ${url === '#' ? '' : 'target="_blank" rel="noopener"'}>
      ${imgOrFallback(clientHeadshot(p), p.name, 'client-avatar')}
      <span class="client-mini-copy"><strong>${esc(p.name)}</strong><span>${esc(`${p.position || ''}${p.number != null ? ` #${p.number}` : ''}`)}</span></span>${pff}
    </a>`;
  }

  function pffMiniList(g) {
    const ps = pffClients(g).slice(0, 3);
    if (!ps.length) return '<div class="pff-empty">No completed PFF grade yet</div>';
    return ps.map((p, i) => `<div class="pff-mini-row"><span class="pff-rank">${i + 1}</span><span><strong>${esc(p.name)}</strong><small>${esc(p.school || p.team || '')} · Wk ${esc(p.pff.week)}</small></span><b class="pff-grade ${pffTone(p.pff.grade)}">${esc(p.pff.grade)}</b></div>`).join('');
  }

  function networkFamily(g) {
    const raw = String(g.network || '').trim();
    if (!raw) return { key:'NOT FOUND', label:'NOT FOUND', sub:'ESPN TV / streaming not listed', cls:'net-missing', order:99 };
    const u = raw.toUpperCase();
    const families = [
      [/ABC/, 'ABC', 'ABC', 'ESPN family', 'net-abc', 1],
      [/FOX|FS1|FS2/, 'FOX', 'FOX • FS1 / FS2', 'FOX family', 'net-fox', 2],
      [/CBS|CBSSN/, 'CBS', 'CBS • CBSSN', 'CBS family', 'net-cbs', 3],
      [/NBC|PEACOCK/, 'NBC', 'NBC • Peacock', 'NBC family', 'net-nbc', 4],
      [/PRIME|AMAZON/, 'PRIME', 'AMAZON PRIME', 'Streaming', 'net-prime', 5],
      [/NFL NETWORK|NFLN/, 'NFLN', 'NFL NETWORK', 'NFL Network', 'net-nfln', 6],
      [/ACCN|ESPNU/, 'ACCN', 'ACCN • ESPNU', 'ESPN conference tier', 'net-accn', 7],
      [/SEC NETWORK|SECN/, 'SECN', 'SEC NETWORK', 'ESPN conference tier', 'net-secn', 8],
      [/BIG TEN NETWORK|BTN/, 'BTN', 'BIG TEN NETWORK', 'Linear conference tier', 'net-btn', 9],
      [/ESPN\+/, 'ESPN+', 'ESPN+', 'Streaming', 'net-espnplus', 10],
      [/ESPN2|ESPN/, 'ESPN', 'ESPN • ESPN2', 'ESPN linear', 'net-espn', 11],
      [/CW/, 'CW', 'THE CW', 'Linear', 'net-cw', 12],
    ];
    for (const [rx,key,label,sub,cls,order] of families) if (rx.test(u)) return {key,label,sub,cls,order,raw};
    return { key:`OTHER:${raw}`, label:raw, sub:'ESPN listed carrier', cls:'net-other', order:50, raw };
  }

  function slotKey(g) {
    const t = displayTime(g);
    return `${g.date || 'TBD'}|${t.time}|${t.zone}`;
  }

  function slotSortValue(g) {
    const d = g.startDate ? new Date(g.startDate) : parseMasterTimeToDate(g.date, g.timeET);
    return d ? d.getTime() : Number.MAX_SAFE_INTEGER;
  }

  function windowLabel(g) {
    const d = g.startDate ? new Date(g.startDate) : parseMasterTimeToDate(g.date, g.timeET);
    if (!d) return 'TIME TBD';
    const tz = state.tz === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone : state.tz;
    const h = Number(new Intl.DateTimeFormat('en-US', {timeZone:tz, hour:'numeric', hour12:false}).format(d));
    if (state.league === 'nfl') {
      if (h < 15) return 'EARLY WINDOW';
      if (h < 19) return 'LATE WINDOW';
      return 'PRIMETIME';
    }
    if (h < 14) return 'EARLY WINDOW';
    if (h < 18) return 'AFTERNOON';
    if (h < 22) return 'PRIMETIME';
    return 'LATE WINDOW';
  }

  function timelineLeader(team) {
    const l = team?.leaders?.[0];
    if (!l) return '';
    return `<span class="timeline-leader">${imgOrFallback(l.headshot, l.name, 'timeline-leader-photo')}<span><b>${esc(l.name)}</b><em>${esc(l.value)}</em></span></span>`;
  }

  function compactClientStrip(g) {
    const ps = clientPlayers(g);
    if (!ps.length) return '<span class="timeline-no-client">NO ESG CLIENT</span>';
    const visible = ps.slice(0, 3);
    return `<div class="timeline-client-strip">${visible.map(p => `<a href="${esc(p.espnUrl || '#')}" ${p.espnUrl ? 'target="_blank" rel="noopener"' : ''} title="${esc(p.name)}">${imgOrFallback(clientHeadshot(p), p.name, 'timeline-client-photo')}<span><b>${esc(p.name)}</b><small>${esc(`${p.position || ''}${p.number != null ? ` #${p.number}` : ''}`)}</small></span></a>`).join('')}${ps.length > 3 ? `<span class="more-clients">+${ps.length-3}</span>` : ''}</div>`;
  }

  function timelineGameCard(g) {
    const t = displayTime(g);
    const day = gameDayParts(g);
    const ps = clientPlayers(g);
    const found = networkFound(g);
    const stClass = g.statusState === 'in' ? 'live' : g.statusState === 'post' ? 'final' : '';
    const rankA = g.rankAway ? `<span class="timeline-rank">#${esc(g.rankAway)}</span>` : '';
    const rankH = g.rankHome ? `<span class="timeline-rank">#${esc(g.rankHome)}</span>` : '';
    const pv = pffVerificationLabel(g, true);
    return `<article class="timeline-game ${ps.length ? 'client-game' : ''} ${found ? '' : 'network-missing'} pff-${esc(pv.cls)}" data-game="${esc(g.id)}" tabindex="0" role="button" aria-label="Open ${esc(g.away)} at ${esc(g.home)} client dashboard">
      <div class="timeline-kickoff-line"><span><b>${esc(day.dow)}</b> ${esc(day.date)}</span><strong>${esc(t.time)} ${esc(t.zone)}</strong></div>
      <div class="timeline-game-top"><span class="timeline-network-badge ${found ? '' : 'missing'}">${esc(found ? g.network : 'ESPN NOT FOUND')}</span><span class="pff-tv-badge ${esc(pv.cls)}" title="PFF is secondary verification only">${esc(pv.text)}</span></div>
      <div class="timeline-venue">${esc(g.venueName || (g.espnFound ? 'Stadium not listed by ESPN' : 'ESPN matchup not found'))}</div>
      <div class="timeline-matchup">
        <div>${g.awayLogo ? `<img src="${esc(g.awayLogo)}" alt="">` : ''}<b>${rankA}${esc(g.away)}</b></div>
        <span>AT</span>
        <div>${g.homeLogo ? `<img src="${esc(g.homeLogo)}" alt="">` : ''}<b>${rankH}${esc(g.home)}</b></div>
      </div>
      <div class="timeline-meta"><span>${esc(weatherLabel(g))}</span><span class="status-pill ${stClass}">${esc(g.statusText || 'Scheduled')}</span></div>
      <div class="timeline-intel-row"><div class="timeline-leaders">${timelineLeader(g.awayEspn)}${timelineLeader(g.homeEspn)}</div></div>
      ${compactClientStrip(g)}
      <div class="timeline-card-foot"><span>${ps.length ? `${ps.length} ESG CLIENT${ps.length === 1 ? '' : 'S'}` : 'TEAM INTEL'}</span><b>OPEN DOSSIER →</b></div>
    </article>`;
  }

  function leaguePlayers() {
    return state.league === 'college' ? (DATA.college?.players || []) : (DATA.nfl?.players || []);
  }

  function pffSideLeaders(side) {
    return leaguePlayers()
      .filter(p => p?.pff && p.pff[side] != null)
      .sort((a, b) => Number(b.pff[side]) - Number(a.pff[side]))
      .slice(0, 10);
  }

  function pffLeaderboardRow(p, side, i) {
    const grade = Number(p.pff?.[side]);
    const org = p.school || p.team || '';
    const detail = [p.position || '', org, p.pff?.week != null ? `Wk ${p.pff.week}` : ''].filter(Boolean).join(' · ');
    return `<div class="pff-leaderboard-row">
      <span class="pff-leaderboard-rank">${i + 1}</span>
      ${imgOrFallback(clientHeadshot(p), p.name, 'pff-leaderboard-photo')}
      <div class="pff-leaderboard-copy"><b>${esc(p.name)}</b><span>${esc(detail)}</span></div>
      <em class="pff-grade leaderboard ${pffTone(grade)}">${esc(grade.toFixed(1))}</em>
    </div>`;
  }

  function setPffLeaderboardMode(mode, restart = true) {
    pffLeaderboardMode = mode === 'defense' ? 'defense' : 'offense';
    document.querySelectorAll('[data-pff-pane]').forEach(el => el.classList.toggle('active', el.dataset.pffPane === pffLeaderboardMode));
    document.querySelectorAll('[data-pff-mode]').forEach(el => el.classList.toggle('active', el.dataset.pffMode === pffLeaderboardMode));
    if (restart) startPffLeaderboardCycle();
  }

  function startPffLeaderboardCycle() {
    clearInterval(pffLeaderboardTimer);
    pffLeaderboardTimer = setInterval(() => setPffLeaderboardMode(pffLeaderboardMode === 'offense' ? 'defense' : 'offense', false), 7000);
  }

  function renderPffLeaderboard() {
    const radEl = $('#radarWidget');
    if (!radEl) return;
    const offense = pffSideLeaders('offense');
    const defense = pffSideLeaders('defense');
    const pane = (side, players) => `<div class="pff-leaderboard-pane ${pffLeaderboardMode === side ? 'active' : ''}" data-pff-pane="${side}">
      ${players.length ? `<div class="pff-leaderboard-grid">${players.map((p,i) => pffLeaderboardRow(p, side, i)).join('')}</div>` : `<div class="intel-empty">No completed ${side === 'offense' ? 'offensive' : 'defensive'} PFF grades are available in the current ${state.league === 'college' ? 'college' : 'NFL'} client snapshot.</div>`}
    </div>`;
    radEl.innerHTML = `<div class="pff-leaderboard-stage">${pane('offense', offense)}${pane('defense', defense)}</div>`;
    $$('[data-pff-mode]').forEach(b => b.addEventListener('click', () => setPffLeaderboardMode(b.dataset.pffMode)));
    startPffLeaderboardCycle();
  }

  function renderIntelligence(gs = filteredGames()) {
    const clientGs = state.games.filter(hasClient);
    const pffValue = g => pffClients(g)[0]?.pff?.grade != null ? Number(pffClients(g)[0].pff.grade) : -1;
    const priority = [...clientGs].sort((a,b) => (clientPlayers(b).length-clientPlayers(a).length) || (Number(!!b.rankAway||!!b.rankHome)-Number(!!a.rankAway||!!a.rankHome)) || (pffValue(b)-pffValue(a))).slice(0,4);
    const topEl = $('#topGamesWidget');
    if (topEl) topEl.innerHTML = priority.length ? priority.map(g => { const t=displayTime(g), d=gameDayParts(g), ps=clientPlayers(g); return `<button class="intel-game-row" data-game="${esc(g.id)}"><div><span>${esc(`${d.DOW||d.dow} ${d.date} · ${t.time} ${t.zone}`)} · ${esc(networkFound(g)?g.network:'NOT FOUND')}</span><b>${esc(g.away)} at ${esc(g.home)}</b><small>${esc(g.venueName || 'Stadium not listed by ESPN')}</small></div><em>${ps.length} CLIENT${ps.length===1?'':'S'}</em></button>`; }).join('') : '<div class="intel-empty">No client games in this week.</div>';

    const buckets = {};
    clientGs.forEach(g => { const k=slotKey(g); (buckets[k] ||= []).push(g); });
    const conflicts = Object.entries(buckets).filter(([,v])=>v.length>1).sort((a,b)=>b[1].length-a[1].length).slice(0,4);
    const confEl=$('#conflictsWidget');
    if (confEl) confEl.innerHTML = conflicts.length ? conflicts.map(([k, arr]) => { const first=arr[0], d=gameDayParts(first), t=displayTime(first); return `<div class="conflict-row"><div><span>${esc(`${d.dow} ${d.date} · ${t.time} ${t.zone}`)}</span><b>${arr.length} client games at once</b><small>${esc(arr.map(g=>`${g.away} @ ${g.home}`).join(' · '))}</small></div><em>${arr.reduce((n,g)=>n+clientPlayers(g).length,0)} PLAYERS</em></div>`; }).join('') : '<div class="intel-empty">No overlapping client kickoff windows on this slate.</div>';

    renderPffLeaderboard();
    $$('.intel-game-row').forEach(b=>b.addEventListener('click',()=>openDashboard(b.dataset.game)));
  }

  function renderClientPriorityBoard(gs) {
    if (!gs.length) return '<div class="empty-state"><strong>No client games match this week.</strong><span>Change the week or clear the search.</span></div>';
    const groups = new Map();
    gs.forEach(g => {
      const key = g.date || 'TBD';
      if (!groups.has(key)) groups.set(key, { key, sort:key==='TBD'?Number.MAX_SAFE_INTEGER:dateObj(key).getTime(), games:[] });
      groups.get(key).games.push(g);
    });
    const ordered = [...groups.values()].sort((a,b)=>a.sort-b.sort);
    return `<div class="client-priority-board weekly-client-board">
      <div class="client-priority-intro"><div><span>PRIMARY OPERATING VIEW · WEEK ${esc(state.week)}</span><strong>ESG CLIENT PRIORITY BOARD</strong></div><p>One weekly watch guide. Individual day, date and kickoff are carried on every matchup card; network is secondary to the client workflow.</p></div>
      ${ordered.map(group => { const day = group.key==='TBD'?{dow:'DATE',date:'TBD'}:gameDayParts({date:group.key}); const sorted=[...group.games].sort((a,b)=>slotSortValue(a)-slotSortValue(b)); const players=sorted.reduce((n,g)=>n+clientPlayers(g).length,0); return `<section class="client-day-group"><header><div><span>${esc(day.dow)}</span><strong>${esc(day.date)}</strong></div><em>${sorted.length} GAME${sorted.length===1?'':'S'} · ${players} CLIENT${players===1?'':'S'}</em></header><div class="client-window-grid">${sorted.map(timelineGameCard).join('')}</div></section>`; }).join('')}
    </div>`;
  }

  function renderSchedule() {
    const gs = filteredGames();
    $('#gameCount').textContent = `${gs.length} GAME${gs.length === 1 ? '' : 'S'} SHOWN`;
    renderIntelligence(gs);
    if (!gs.length) {
      $('#schedule').innerHTML = '<div class="empty-state"><strong>No games match this view.</strong><span>Change the week or clear a filter.</span></div>';
      return;
    }

    if (state.filter === 'clients') {
      $('#schedule').innerHTML = renderClientPriorityBoard(gs);
      $$('.timeline-game').forEach(card => {
        card.addEventListener('click', e => { if (e.target.closest('a,button')) return; openDashboard(card.dataset.game); });
        card.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('a,button')) { e.preventDefault(); openDashboard(card.dataset.game); } });
      });
      return;
    }

    const slotMap = new Map();
    gs.forEach(g => { const key=slotKey(g); const cur=slotMap.get(key); const val=slotSortValue(g); const day=gameDayParts(g); if (!cur || val < cur.sort) slotMap.set(key,{key,label:displayTime(g).time,zone:displayTime(g).zone,day:day.dow,date:day.date,window:windowLabel(g),sort:val}); });
    const slots=[...slotMap.values()].sort((a,b)=>a.sort-b.sort || a.label.localeCompare(b.label));
    const famMap=new Map();
    gs.forEach(g=>{ const fam=networkFamily(g); if(!famMap.has(fam.key)) famMap.set(fam.key,{...fam,games:[]}); famMap.get(fam.key).games.push(g); });
    const families=[...famMap.values()].sort((a,b)=>a.order-b.order || a.label.localeCompare(b.label));
    const gridStyle=`grid-template-columns:235px repeat(${Math.max(1,slots.length)},minmax(390px,1fr))`;
    const header=`<div class="matrix-grid matrix-time-header" style="${gridStyle}"><div class="network-sticky-head"><span>ESPN NETWORK</span><b>PFF ✓</b></div>${slots.map(s=>`<div class="time-slot-head"><b>${esc(s.day)} · ${esc(s.date)}</b><strong>${esc(s.label)} ${esc(s.zone)}</strong><span>${esc(s.window)}</span></div>`).join('')}</div>`;
    const rows=families.map(f=>`<div class="matrix-grid matrix-network-row ${esc(f.cls)}" style="${gridStyle}"><div class="network-sticky-cell"><span class="network-monogram">${esc(f.label.replace(/[^A-Za-z0-9+]/g,'').slice(0,5) || 'TV')}</span><div><b>${esc(f.label)}</b><small>${esc(f.sub)}</small></div></div>${slots.map(s=>{ const games=f.games.filter(g=>slotKey(g)===s.key); return `<div class="matrix-slot-cell">${games.map(timelineGameCard).join('')}</div>`; }).join('')}</div>`).join('');
    $('#schedule').innerHTML = `<div class="matrix-scroll"><div class="matrix-canvas">${header}${rows}</div></div>`;
    $$('.timeline-game').forEach(card => {
      card.addEventListener('click', e => { if (e.target.closest('a,button')) return; openDashboard(card.dataset.game); });
      card.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('a,button')) { e.preventDefault(); openDashboard(card.dataset.game); } });
    });
  }

  function renderLoading() {
    $('#schedule').innerHTML = '<div class="matrix-loading"><div class="spinner"></div><strong>SYNCING WEEKLY WATCH GUIDE</strong><span>ESPN primary · PFF TV verification · venue · weather</span></div>';
  }

  function renderMetrics() {
    const clientGames = state.games.filter(hasClient);
    const players = new Set(clientGames.flatMap(clientPlayers).map(p => p.id || p.espnId || p.name));
    const windows = {};
    clientGames.forEach(g => { const k = slotKey(g); (windows[k] ||= []).push(g); });
    const conflicts = Object.values(windows).filter(v => v.length > 1).length;
    const found = clientGames.filter(networkFound).length;
    const missing = clientGames.length - found;
    const pffVerified = clientGames.filter(g => g.pffTv?.status === 'verified').length;
    const pffReview = clientGames.filter(g => ['mismatch','pff_only'].includes(g.pffTv?.status)).length;
    const vals = [
      ['Client games', clientGames.length, 'client'],
      ['Clients in action', players.size, 'client'],
      ['ESPN TV found', found, ''],
      ['ESPN not found', missing, missing ? 'warning' : ''],
      ['PFF verified', pffVerified, 'verified'],
      ['PFF review', pffReview, pffReview ? 'pff-review' : ''],
    ];
    $('#metrics').innerHTML = vals.map(([l, v, c]) => `<div class="metric ${c}"><div class="metric-value">${v}</div><div class="metric-label">${l}</div></div>`).join('');
  }

  function renderDateStrip() {
    const weeks = weekNumbers();
    const strip = $('#weekStrip');
    if (!strip) return;
    strip.innerHTML = weeks.map(w => `<button class="week-pill ${Number(w)===Number(state.week)?'active':''}" data-week="${esc(w)}"><span>WEEK ${esc(w)}</span><small>${esc(weekRangeLabel(w))}</small></button>`).join('');
    $$('.week-pill').forEach(b => b.addEventListener('click', () => setWeek(Number(b.dataset.week))));
    const heading = $('#weekHeading');
    if (heading) heading.textContent = weekHeading();
    const active = strip.querySelector('.week-pill.active');
    if (active) requestAnimationFrame(() => active.scrollIntoView({behavior:'smooth', block:'nearest', inline:'center'}));
  }

  function renderControls() {
    $$('.seg').forEach(b => b.classList.toggle('active', b.dataset.league === state.league));
    $$('.filter-tab').forEach(b => b.classList.toggle('active', b.dataset.filter === state.filter));
    $('#tzSelect').value = state.tz;
    $('#heroSub').textContent = state.league === 'college'
      ? `Week ${state.week} opens client-first. ESPN remains the primary college schedule/TV source, with PFF used only as a secondary TV verification layer.`
      : `Week ${state.week} opens client-first. ESPN remains the primary NFL schedule/TV source, with PFF used only as a secondary TV verification layer.`;
  }

  function renderAll() {
    renderControls();
    renderDateStrip();
    renderMetrics();
    renderSchedule();
    $('#freshness').textContent = `${state.sourceMode || 'ESPN weekly schedule'} · ${state.pffMode || 'PFF check pending'} · Client/PFF snapshot ${new Date(DATA.generatedAt || Date.now()).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric' })}.`;
  }

  async function setWeek(w) {
    const weeks = weekNumbers();
    if (!weeks.includes(Number(w))) return;
    state.week = Number(w);
    state.date = selectedWeekDates()[0] || TODAY;
    const u = new URL(location.href);
    u.searchParams.delete('date');
    u.searchParams.set('week', state.week);
    history.replaceState({}, '', u);
    renderDateStrip();
    await loadSchedule();
  }


  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 1900);
  }

  function linkButton(label, href, cls = '') {
    if (!href) return '';
    return `<a class="dashboard-link ${cls}" href="${esc(href)}" target="_blank" rel="noopener">${esc(label)} <span>↗</span></a>`;
  }

  function dashboardClientCard(p) {
    const pff = p.pff;
    const snapParts = pff ? [pff.primarySnaps != null ? `${pff.primarySnaps} primary snaps` : null, pff.specialTeamsSnaps != null && pff.specialTeamsSnaps > 0 ? `${pff.specialTeamsSnaps} special teams` : null].filter(Boolean).join(' · ') : '';
    return `<div class="dashboard-client-card">
      ${imgOrFallback(clientHeadshot(p), p.name, 'dashboard-client-photo')}
      <div class="dashboard-client-copy">
        <div class="dashboard-client-top"><div><span class="dashboard-eyebrow">ESG CLIENT</span><h3>${esc(p.name)}</h3></div>${pff?.grade != null ? `<span class="dashboard-pff ${pffTone(pff.grade)}"><small>PFF</small>${esc(pff.grade)}</span>` : ''}</div>
        <p>${esc(`${p.position || ''}${p.number != null ? ` #${p.number}` : ''} · ${p.school || p.team || ''}`)}</p>
        ${pff ? `<div class="client-data-line"><span>Latest PFF: Week ${esc(pff.week)}</span>${snapParts ? `<span>${esc(snapParts)}</span>` : ''}</div>` : '<div class="client-data-line"><span>No completed PFF grade yet</span></div>'}
        <div class="dashboard-actions">${linkButton('ESPN player profile', p.espnUrl)}</div>
      </div>
    </div>`;
  }

  function dashboardPff(g) {
    const ps = pffClients(g);
    if (!ps.length) return '<div class="dashboard-empty">No ESG client in this matchup has a completed PFF grade in the current master snapshot.</div>';
    return `<div class="dashboard-pff-list">${ps.map((p, i) => `<div class="dashboard-pff-row"><span class="pff-place">${i + 1}</span><div><strong>${esc(p.name)}</strong><span>${esc(`${p.position || ''} · ${p.school || p.team || ''} · Week ${p.pff.week}`)}</span></div><b class="pff-grade large ${pffTone(p.pff.grade)}">${esc(p.pff.grade)}</b></div>`).join('')}</div>`;
  }

  function dashboardTeam(team, label) {
    if (!team) return `<div class="dashboard-team"><span class="dashboard-eyebrow">${esc(label)}</span><div class="dashboard-empty compact">ESPN team detail was not returned for this matchup.</div></div>`;
    const leaders = (team.leaders || []).slice(0, 3);
    const links = team.links || {};
    return `<div class="dashboard-team">
      <div class="dashboard-team-head"><div><span class="dashboard-eyebrow">${esc(label)}</span><h3>${esc(team.name)}</h3></div>${team.logo ? `<img src="${esc(team.logo)}" alt="">` : ''}</div>
      ${leaders.length ? `<div class="dashboard-leaders">${leaders.map(l => `<div class="dashboard-leader">${imgOrFallback(l.headshot, l.name, 'leader-avatar-lg')}<div><strong>${esc(l.name)}</strong><span>${esc(l.value)}</span></div>${l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener" aria-label="Open ${esc(l.name)} on ESPN">↗</a>` : ''}</div>`).join('')}</div>` : '<div class="dashboard-empty compact">ESPN did not return season leader data in this schedule response.</div>'}
      <div class="dashboard-actions">${linkButton('Roster', links.roster)}${linkButton('Statistics', links.stats)}${linkButton('Schedule', links.schedule)}</div>
    </div>`;
  }

  function renderDashboardContent(g) {
    const t = displayTime(g), ps = clientPlayers(g), found = networkFound(g);
    const pv = pffVerificationLabel(g, false);
    const gameUrl = g.espnFound && g.id ? `https://www.espn.com/${state.league === 'college' ? 'college-football' : 'nfl'}/game/_/gameId/${g.id}` : null;
    $('#gameDrawerContent').innerHTML = `
      <div class="drawer-topline"><div><span class="dashboard-eyebrow">CLIENT GAME DASHBOARD · WEEK ${esc(state.week)}</span><h2>${esc(g.away)} <span>at</span> ${esc(g.home)}</h2></div><div class="drawer-kickoff"><small>${esc(gameDayParts(g).dow)} · ${esc(gameDayParts(g).date)}</small><strong>${esc(t.time)} ${esc(t.zone)}</strong><span class="drawer-network ${found ? '' : 'missing'}">${esc(found ? g.network : 'ESPN TV NOT FOUND')}</span><span class="pff-tv-badge dashboard ${esc(pv.cls)}">${esc(pv.text)}</span></div></div>
      ${!found ? `<div class="drawer-alert">ESPN does not currently list a TV or streaming assignment for this matchup.${g.pffTv?.status === 'pff_only' ? ` PFF's secondary schedule currently lists <strong>${esc(g.pffTv.network)}</strong>, shown for verification only; the ESPN field remains Not Found.` : ' PFF is not used to overwrite the ESPN field.'}</div>` : g.pffTv?.status === 'mismatch' ? `<div class="drawer-alert pff-mismatch-alert">TV CHECK: ESPN lists <strong>${esc(g.network)}</strong>, while PFF's secondary schedule lists <strong>${esc(g.pffTv.network)}</strong>. ESPN remains the display authority until reconciled.</div>` : ''}
      <section class="drawer-section client-first"><div class="drawer-section-head"><div><span class="dashboard-eyebrow">PRIMARY VIEW</span><h3>Clients in this game</h3></div><span>${ps.length} client${ps.length === 1 ? '' : 's'}</span></div><div class="dashboard-client-grid">${ps.length ? ps.map(dashboardClientCard).join('') : '<div class="dashboard-empty">No ESG clients are attached to this game.</div>'}</div></section>
      <section class="drawer-section game-info-wide"><div class="drawer-section-head"><div><span class="dashboard-eyebrow">GAME INFO</span><h3>ESPN matchup details</h3></div>${g.espnFound && !g.espnDetailLoaded ? '<small>ESPN detail loading…</small>' : ''}</div><dl class="game-facts"><div><dt>Day / Date</dt><dd>${esc(`${gameDayParts(g).dow} · ${gameDayParts(g).date}`)}</dd></div><div><dt>Kickoff</dt><dd>${esc(`${t.time} ${t.zone}`)}</dd></div><div><dt>ESPN TV</dt><dd>${esc(found ? g.network : 'Not found')}</dd></div><div><dt>PFF TV check</dt><dd class="fact-pff ${esc(pv.cls)}">${esc(pv.text)}</dd></div><div><dt>Stadium</dt><dd>${esc(g.venueName || 'Not listed by ESPN')}</dd></div><div><dt>Location</dt><dd>${esc(g.venueLocation || 'Not listed by ESPN')}</dd></div><div><dt>Weather</dt><dd>${esc(weatherLabel(g))}</dd></div><div><dt>Status</dt><dd>${esc(g.statusText || 'Scheduled')}</dd></div></dl>${gameUrl ? `<div class="dashboard-actions">${linkButton('ESPN game page', gameUrl, 'primary')}</div>` : ''}</section>
      <section class="drawer-section team-secondary"><div class="drawer-section-head"><div><span class="dashboard-eyebrow">SECONDARY VIEW</span><h3>Team context from ESPN</h3></div><small>Leaders + direct ESPN links</small></div><div class="dashboard-team-grid">${dashboardTeam(g.awayEspn, 'AWAY TEAM')}${dashboardTeam(g.homeEspn, 'HOME TEAM')}</div></section>`;
  }

  async function enrichOpenGameFromEspn(g) {
    if (!g?.espnFound || !g.id || g.espnDetailLoaded) return;
    try {
      const data = await fetchEspnSummary(g.id);
      applyEspnSummary(g, data);
      if (String(state.openGameId) === String(g.id)) renderDashboardContent(g);
    } catch (_) {
      g.espnDetailLoaded = true;
      if (String(state.openGameId) === String(g.id)) renderDashboardContent(g);
    }
  }

  function openDashboard(id) {
    const g = state.games.find(x => String(x.id) === String(id));
    if (!g) return;
    state.openGameId = id;
    renderDashboardContent(g);
    $('#gameDrawer').classList.add('open');
    $('#gameDrawer').setAttribute('aria-hidden', 'false');
    document.body.classList.add('drawer-open');
    $('#closeDrawer').focus();
    void enrichOpenGameFromEspn(g);
  }

  function closeDashboard() {
    $('#gameDrawer').classList.remove('open');
    $('#gameDrawer').setAttribute('aria-hidden', 'true');
    document.body.classList.remove('drawer-open');
    state.openGameId = null;
  }

  function makeICS() {
    const gs = state.games.filter(hasClient);
    if (!gs.length) { toast('No client games in this week'); return; }
    const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//ESG//Football TV Board//EN','CALSCALE:GREGORIAN'];
    const pad = n => String(n).padStart(2,'0');
    const utcStamp = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
    const e = s => String(s || '').replace(/([,;\\])/g,'\\$1').replace(/\n/g,'\\n');
    gs.forEach(g => {
      const start = g.startDate ? new Date(g.startDate) : parseMasterTimeToDate(g.date, g.timeET);
      if (!start) return;
      const end = new Date(start.getTime() + 4*60*60*1000);
      const ps = clientPlayers(g).map(p => p.name).join(', ');
      lines.push('BEGIN:VEVENT',`UID:esg-${g.id}-${g.date}@football-ops`,`DTSTAMP:${utcStamp(new Date())}`,`DTSTART:${utcStamp(start)}`,`DTEND:${utcStamp(end)}`,`SUMMARY:${e(`${g.away} at ${g.home}`)}`,`DESCRIPTION:${e(`ESG clients: ${ps || '—'}\\nESPN TV: ${g.network || 'NOT FOUND'}`)}`,`LOCATION:${e(g.venue || '')}`,'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type:'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ESG-${state.league}-week-${state.week}-client-slate.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Client calendar exported');
  }

  async function copyRundown() {
    const startOf = g => g.startDate ? new Date(g.startDate) : parseMasterTimeToDate(g.date, g.timeET);
    const gs = state.games.filter(hasClient).sort((a,b) => (startOf(a)?.getTime() || 0) - (startOf(b)?.getTime() || 0));
    if (!gs.length) { toast('No client games in this week'); return; }
    const text = [`ESG ${state.league === 'college' ? 'NIL / COLLEGE' : 'NFL'} CLIENT WATCH GUIDE — WEEK ${state.week} · ${weekRangeLabel().toUpperCase()}`, '', ...gs.map(g => {
      const t = displayTime(g), ps = clientPlayers(g).map(p => p.name).join(', ');
      const d=gameDayParts(g); return `${d.dow} ${d.date} · ${t.time} ${t.zone} — ${g.away} at ${g.home} — ${g.network || 'ESPN TV NOT FOUND'}\nClients: ${ps}`;
    })].join('\n');
    try { await navigator.clipboard.writeText(text); toast('Client rundown copied'); }
    catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Client rundown copied'); }
  }

  function bind() {
    if (!PAGE_LEAGUE) {
      $$('.seg').forEach(b => b.addEventListener('click', async () => {
        state.league = b.dataset.league;
        state.week = closestWeekForDate(state.league, TODAY);
        state.date = selectedWeekDates()[0] || TODAY;
        localStorage.setItem('esg-tv-league-v2', state.league);
        renderControls(); renderDateStrip(); await loadSchedule();
      }));
    }
    $$('.filter-tab').forEach(b => b.addEventListener('click', () => {
      state.filter = b.dataset.filter;
      renderControls(); renderSchedule();
    }));
    $('#tzSelect').addEventListener('change', e => { state.tz = e.target.value; localStorage.setItem('esg-tv-tz-v2', state.tz); renderMetrics(); renderSchedule(); });
    $('#searchInput').addEventListener('input', e => { state.search = e.target.value; renderSchedule(); });
    $('#prevWeek').addEventListener('click', () => { const ws=weekNumbers(), i=ws.indexOf(Number(state.week)); if(i>0) setWeek(ws[i-1]); });
    $('#nextWeek').addEventListener('click', () => { const ws=weekNumbers(), i=ws.indexOf(Number(state.week)); if(i>=0 && i<ws.length-1) setWeek(ws[i+1]); });
    $('#refreshBtn').addEventListener('click', () => loadSchedule(false));
    $('#icsBtn').addEventListener('click', makeICS);
    $('#copyBtn').addEventListener('click', copyRundown);
    $('#closeDrawer').addEventListener('click', closeDashboard);
    $('#drawerBackdrop').addEventListener('click', closeDashboard);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.openGameId) closeDashboard(); });
  }

  if (PAGE_LEAGUE) {
    document.documentElement.dataset.calendar = PAGE_LEAGUE;
  }
  bind();
  renderControls();
  renderDateStrip();
  loadSchedule();
})();
