#!/usr/bin/env python3
import argparse, json, re
from collections import defaultdict
from datetime import datetime, date
from pathlib import Path
from openpyxl import load_workbook


def clean_num(v):
    if v is None: return None
    if isinstance(v, float) and v.is_integer(): return int(v)
    return v


def iso_date(v):
    if v is None: return None
    if isinstance(v, datetime): return v.date().isoformat()
    if isinstance(v, date): return v.isoformat()
    s=str(v).strip()
    for fmt in ('%m/%d/%Y %I:%M %p ET','%m/%d/%Y %I:%M %p EST','%m/%d/%Y %I:%M %p CT','%m/%d/%Y','%m/%d/%y'):
        try: return datetime.strptime(s.replace('  ',' '),fmt).date().isoformat()
        except ValueError: pass
    m=re.match(r'^(\d{1,2}/\d{1,2}/\d{4})',s)
    if m:
        try: return datetime.strptime(m.group(1),'%m/%d/%Y').date().isoformat()
        except ValueError: pass
    return None


def time_et(v):
    if v is None or isinstance(v,(datetime,date)): return None
    s=str(v).strip()
    if 'TBD' in s.upper(): return 'TBD'
    m=re.search(r'(\d{1,2}:\d{2}\s*[AP]M)\s*(ET|EST|CT|CST|MT|MST|PT|PST)?',s,re.I)
    if not m: return None
    tm=m.group(1).upper().replace('  ',' ')
    zone=(m.group(2) or 'ET').upper()
    if zone in ('CT','CST'):
        dt=datetime.strptime(tm,'%I:%M %p'); h=(dt.hour+1)%24; suffix='AM' if h<12 else 'PM'; tm=f'{h%12 or 12}:{dt.minute:02d} {suffix}'
    elif zone in ('MT','MST'):
        dt=datetime.strptime(tm,'%I:%M %p'); h=(dt.hour+2)%24; suffix='AM' if h<12 else 'PM'; tm=f'{h%12 or 12}:{dt.minute:02d} {suffix}'
    elif zone in ('PT','PST'):
        dt=datetime.strptime(tm,'%I:%M %p'); h=(dt.hour+3)%24; suffix='AM' if h<12 else 'PM'; tm=f'{h%12 or 12}:{dt.minute:02d} {suffix}'
    return tm


def parse_game_id(url):
    if not url: return None
    m=re.search(r'gameId/(\d+)',str(url))
    return m.group(1) if m else None


def num(v):
    try:
        if v is None or v == '': return None
        return float(v)
    except (ValueError, TypeError): return None


def latest_college_pff(wb):
    """Latest completed PFF row per client Player ID. The workbook currently contains ESG clients, not full rosters."""
    out={}
    if 'PFF Detail' not in wb.sheetnames: return out
    ws=wb['PFF Detail']
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row or not row[0]: continue
        pid=str(row[0]); week=num(row[6]); grade=num(row[10])
        if week is None or grade is None: continue
        prev=out.get(pid)
        if prev and prev['week'] > week: continue
        out[pid]={
            'week':int(week), 'grade':round(grade,1),
            'offense':round(num(row[11]),1) if num(row[11]) is not None else None,
            'defense':round(num(row[12]),1) if num(row[12]) is not None else None,
            'specialTeams':round(num(row[13]),1) if num(row[13]) is not None else None,
            'offenseSnaps':clean_num(row[14]), 'defenseSnaps':clean_num(row[15]),
            'primarySnaps':clean_num(row[16]), 'specialTeamsSnaps':clean_num(row[17]),
            'gameSnaps':clean_num(row[19]),
        }
    return out


def latest_nfl_pff(wb):
    out={}
    if 'PFF Detail' not in wb.sheetnames: return out
    ws=wb['PFF Detail']
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row or (not row[0] and not row[1]): continue
        key=str(row[0]).split('.')[0] if row[0] not in (None,'') else f"name:{str(row[1]).strip().lower()}"
        week=num(row[6]); grade=num(row[15])
        if week is None or grade is None: continue
        prev=out.get(key)
        if prev and prev['week'] > week: continue
        out[key]={
            'week':int(week), 'grade':round(grade,1),
            'offense':round(num(row[16]),1) if num(row[16]) is not None else None,
            'defense':round(num(row[17]),1) if num(row[17]) is not None else None,
            'specialTeams':round(num(row[18]),1) if num(row[18]) is not None else None,
            'offenseSnaps':clean_num(row[19]), 'defenseSnaps':clean_num(row[20]),
            'primarySnaps':clean_num(row[21]), 'specialTeamsSnaps':clean_num(row[22]),
            'gameSnaps':clean_num(row[24]),
        }
    return out


def load_iron_teams(path):
    # Kept only as a local ESPN-ID/name crosswalk for client matching/logos. It is never used for schedule or broadcast data.
    if not path or not Path(path).exists(): return []
    return json.loads(Path(path).read_text())


def norm(s):
    return re.sub(r'[^a-z0-9]','',str(s or '').lower())


def make_team_resolver(teams):
    aliases={}
    for t in teams:
        aliases[norm(t['name'])]=t
        aliases[norm(t.get('slug'))]=t
        for a in t.get('espnNames',[]): aliases[norm(a)]=t
    manual={
        'miamioh':'miamioh','hawaii':'hawaii','ucf':'ucf','umass':'umass','utsa':'utsa',
        'byu':'byu','ulmonroe':'ulmonroe','ulm':'ulmonroe','fiu':'fiu','smu':'smu',
        'tcu':'tcu','ucla':'ucla','utep':'utep','uab':'uab','usc':'usc','lsu':'lsu',
        'ncstate':'ncstate','ncsu':'ncstate','appalachianstate':'appstate','appstate':'appstate',
    }
    def resolve(name):
        k=norm(name)
        if k in aliases: return aliases[k]
        if k in manual and manual[k] in aliases: return aliases[manual[k]]
        hits=[]
        for ak,t in aliases.items():
            if len(ak)>=4 and (k.startswith(ak) or ak.startswith(k)): hits.append((len(ak),t))
        if hits: return max(hits,key=lambda x:x[0])[1]
        return None
    return resolve


def college_data(xlsx, iron_teams=None):
    wb=load_workbook(xlsx,data_only=True,read_only=True)
    pff=latest_college_pff(wb)
    roster=wb['Master Roster']
    players=[]; players_by_school=defaultdict(list)
    for row in roster.iter_rows(min_row=2,values_only=True):
        if not row or not row[1] or str(row[6] or '').strip().lower()!='yes': continue
        p={
            'id':row[0], 'name':row[1], 'position':row[2], 'number':clean_num(row[3]),
            'school':row[4], 'unit':row[5], 'notes':row[7] or '',
            'espnId':clean_num(row[24]), 'espnUrl':row[25] or None,
            'pff':pff.get(str(row[0]))
        }
        players.append(p); players_by_school[p['school']].append(p['id'])

    gl=wb['Game Links']
    games={}
    for row in gl.iter_rows(min_row=2,values_only=True):
        school=row[0]
        if not school or school not in players_by_school: continue
        for week in range(1,17):
            base=1+(week-1)*3
            if base+2>=len(row): continue
            dcell, oppcell, url=row[base],row[base+1],row[base+2]
            opp=str(oppcell or '').strip()
            if not opp or opp.upper()=='BYE': continue
            d=iso_date(dcell)
            if not d: continue
            tm=time_et(dcell) or 'TBD'
            away_marker=opp.startswith('@'); opp_name=opp[1:].strip() if away_marker else opp
            away,home=(school,opp_name) if away_marker else (opp_name,school)
            gid=parse_game_id(url); key=gid or f"{d}|{'|'.join(sorted([norm(away),norm(home)]))}"
            if key not in games:
                games[key]={
                    'id':gid or f'client-{len(games)+1}', 'week':week,'date':d,'timeET':tm,
                    'away':away,'home':home,'network':None,'venue':None,'espnUrl':url or None,
                    'source':'client-master','clientSchools':[], 'espnFound':False,
                }
            g=games[key]
            if school not in g['clientSchools']: g['clientSchools'].append(school)
            if not g.get('espnUrl') and url: g['espnUrl']=url
            if g.get('timeET') in (None,'TBD') and tm!='TBD': g['timeET']=tm

    return {'players':players,'playersBySchool':dict(players_by_school),'clientGames':sorted(games.values(),key=lambda g:(g['date'],g['timeET'] or '',g['away']))}


def nfl_data(xlsx):
    wb=load_workbook(xlsx,data_only=True,read_only=True)
    pff=latest_nfl_pff(wb)
    db=wb['ESPN NFL Database']; abbr_to_team={}
    for row in db.iter_rows(min_row=4,values_only=True):
        if row and len(row)>=3 and row[0] and row[2]: abbr_to_team[str(row[2]).strip().upper()]=str(row[0]).strip()
    abbr_to_team.update({
      'ARI':'Arizona Cardinals','ATL':'Atlanta Falcons','BAL':'Baltimore Ravens','BUF':'Buffalo Bills','CAR':'Carolina Panthers','CHI':'Chicago Bears','CIN':'Cincinnati Bengals','CLE':'Cleveland Browns','DAL':'Dallas Cowboys','DEN':'Denver Broncos','DET':'Detroit Lions','GB':'Green Bay Packers','HOU':'Houston Texans','IND':'Indianapolis Colts','JAX':'Jacksonville Jaguars','KC':'Kansas City Chiefs','LV':'Las Vegas Raiders','LAC':'Los Angeles Chargers','LA':'Los Angeles Rams','LAR':'Los Angeles Rams','MIA':'Miami Dolphins','MIN':'Minnesota Vikings','NE':'New England Patriots','NO':'New Orleans Saints','NYG':'New York Giants','NYJ':'New York Jets','PHI':'Philadelphia Eagles','PIT':'Pittsburgh Steelers','SF':'San Francisco 49ers','SEA':'Seattle Seahawks','TB':'Tampa Bay Buccaneers','TEN':'Tennessee Titans','WSH':'Washington Commanders'
    })

    cm=wb['NFL Client Master']; players=[]; players_by_team=defaultdict(list)
    for row in cm.iter_rows(min_row=3,values_only=True):
        if not row or not row[0]: continue
        abbr=str(row[2] or '').strip().upper(); eid=str(row[1]).split('.')[0] if row[1] not in (None,'') else None
        p={'name':row[0],'espnId':eid,'teamAbbr':abbr,'team':abbr_to_team.get(abbr),'number':clean_num(row[3]),
           'espnUrl':f"https://www.espn.com/nfl/player/_/id/{eid}" if eid else None,
           'pff': pff.get(eid) or pff.get(f"name:{str(row[0]).strip().lower()}")}
        players.append(p)
        if p['team']: players_by_team[p['team']].append(p['name'])

    ws=wb['Master NFL Schedule']; games={}; undated={}
    for row in ws.iter_rows(min_row=2,values_only=True):
        if not row or not row[0] or not row[1]: continue
        team=str(row[0]); week=int(row[1]); d=iso_date(row[2]); opp=str(row[3] or ''); site=str(row[4] or '')
        if not opp: continue
        gid=str(int(row[9])) if isinstance(row[9],(int,float)) else (str(row[9]) if row[9] else None)
        if site.lower()=='away': away,home=team,opp
        else: away,home=opp,team
        if not d:
            if gid and gid not in undated:
                undated[gid]={'id':gid,'week':week,'date':None,'dateLabel':str(row[2] or 'TBD'),'timeET':'TBD','away':away,'home':home,'network':None,'venue':None,'notes':row[8] or '','espnUrl':row[10] or None,'clientTeams':[],'source':'client-master','espnFound':False}
            if gid and gid in undated:
                for n in (undated[gid]['away'],undated[gid]['home']):
                    if n in players_by_team and n not in undated[gid]['clientTeams']: undated[gid]['clientTeams'].append(n)
            continue
        key=gid or f"{d}|{week}|{'|'.join(sorted([norm(away),norm(home)]))}"
        if key not in games:
            games[key]={'id':gid or key,'week':week,'date':d,'timeET':str(row[5] or '').replace(' EST','').strip() or 'TBD','away':away,'home':home,
                        # Schedule/TV is ESPN-only in the UI; master TV/venue are deliberately not exported as fallback data.
                        'network':None,'venue':None,'notes':row[8] or '','espnUrl':row[10] or None,'clientTeams':[],'source':'client-master','espnFound':False}
        for n in (away,home):
            if n in players_by_team and n not in games[key]['clientTeams']: games[key]['clientTeams'].append(n)
    return {'players':players,'playersByTeam':dict(players_by_team),'abbrToTeam':abbr_to_team,'games':sorted(games.values(),key=lambda g:(g['date'],g['timeET'],g['away'])),'undatedGames':sorted(undated.values(),key=lambda g:(g['week'],g['away']))}


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--college-master',required=True); ap.add_argument('--nfl-master',required=True); ap.add_argument('--iron-teams'); ap.add_argument('--out',required=True); args=ap.parse_args()
    data={
        'generatedAt':datetime.now().astimezone().isoformat(timespec='seconds'),
        'sourceLabels':{
            'college':'2026 College Football Client Stats Tracker',
            'nfl':'2026 NFL Client Intelligence Master Sheet',
            'schedule':'ESPN scoreboard only. No third-party TV/network fallback.'
        },
        'college':college_data(args.college_master),
        'nfl':nfl_data(args.nfl_master),
    }
    Path(args.out).write_text('window.ESG_DATA = '+json.dumps(data,separators=(',',':'),ensure_ascii=False)+';\n')
    print('Wrote',args.out)
    print('College players',len(data['college']['players']),'client games',len(data['college']['clientGames']))
    print('NFL players',len(data['nfl']['players']),'games',len(data['nfl']['games']))

if __name__=='__main__': main()
