const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.md':'text/markdown; charset=utf-8'};

function send(res, status, body, headers={}) {
  res.writeHead(status, {'Cache-Control':'no-store',...headers});
  res.end(body);
}
async function proxyEspn(req,res,u){
  const league=u.searchParams.get('league');
  const date=u.searchParams.get('date');
  const group=u.searchParams.get('group');
  if(!['college-football','nfl'].includes(league) || !/^\d{8}$/.test(date||'')) return send(res,400,JSON.stringify({error:'Invalid ESPN request'}),{'Content-Type':'application/json'});
  if(group && !['80','81'].includes(group)) return send(res,400,JSON.stringify({error:'Invalid group'}),{'Content-Type':'application/json'});
  const qs=new URLSearchParams({dates:date,limit:'1000'}); if(group)qs.set('groups',group);
  const target=`https://site.api.espn.com/apis/site/v2/sports/football/${league}/scoreboard?${qs}`;
  const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),6500);
  try{
    const r=await fetch(target,{signal:ctrl.signal,headers:{'User-Agent':'ESG-Football-Ops/1.0','Accept':'application/json'}});
    const text=await r.text();
    send(res,r.ok?200:r.status,text,{'Content-Type':'application/json; charset=utf-8'});
  }catch(e){send(res,502,JSON.stringify({error:'ESPN upstream unavailable'}),{'Content-Type':'application/json; charset=utf-8'});}
  finally{clearTimeout(timer)}
}

async function proxyEspnSummary(req,res,u){
  const league=u.searchParams.get('league');
  const event=u.searchParams.get('event');
  if(!['college-football','nfl'].includes(league) || !/^\d{6,20}$/.test(event||'')) return send(res,400,JSON.stringify({error:'Invalid ESPN summary request'}),{'Content-Type':'application/json'});
  const target=`https://site.api.espn.com/apis/site/v2/sports/football/${league}/summary?event=${encodeURIComponent(event)}`;
  const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),7000);
  try{
    const r=await fetch(target,{signal:ctrl.signal,headers:{'User-Agent':'ESG-Football-Ops/1.0','Accept':'application/json'}});
    const text=await r.text();
    send(res,r.ok?200:r.status,text,{'Content-Type':'application/json; charset=utf-8'});
  }catch(e){send(res,502,JSON.stringify({error:'ESPN summary upstream unavailable'}),{'Content-Type':'application/json; charset=utf-8'});}
  finally{clearTimeout(timer)}
}

const PFF_CACHE = new Map();
function htmlEntityDecode(s='') {
  return String(s)
    .replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16)))
    .replace(/\u0026/gi,'&').replace(/\u002b/gi,'+').replace(/\u002f/gi,'/');
}
function pffTextFromHtml(html='') {
  // Keep serialized page data as well as SSR text; both can contain team/network values.
  return htmlEntityDecode(html)
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/\\n|\\r|\\t/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}
async function proxyPffSchedule(req,res,u){
  const league=u.searchParams.get('league');
  if(!['college','nfl'].includes(league)) return send(res,400,JSON.stringify({error:'Invalid PFF league'}),{'Content-Type':'application/json'});
  const target=league==='college'?'https://www.pff.com/ncaa/scores':'https://www.pff.com/nfl/scores';
  const cached=PFF_CACHE.get(league);
  if(cached && Date.now()-cached.ts < 5*60*1000) return send(res,200,JSON.stringify(cached.payload),{'Content-Type':'application/json; charset=utf-8'});
  const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(),6500);
  try{
    const r=await fetch(target,{signal:ctrl.signal,headers:{
      'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/152 Safari/537.36',
      'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language':'en-US,en;q=0.9'
    }});
    const html=await r.text();
    if(!r.ok) return send(res,r.status,JSON.stringify({ok:false,error:`PFF HTTP ${r.status}`}),{'Content-Type':'application/json; charset=utf-8'});
    const text=pffTextFromHtml(html);
    const payload={ok:true,league,url:target,fetchedAt:new Date().toISOString(),text:text.slice(0,1800000)};
    PFF_CACHE.set(league,{ts:Date.now(),payload});
    send(res,200,JSON.stringify(payload),{'Content-Type':'application/json; charset=utf-8'});
  }catch(e){
    send(res,502,JSON.stringify({ok:false,error:'PFF schedule upstream unavailable'}),{'Content-Type':'application/json; charset=utf-8'});
  }finally{clearTimeout(timer)}
}

function serveStatic(req,res,u){
  let pathname=decodeURIComponent(u.pathname);
  if(pathname==='/') pathname='/index.html';
  else if(pathname==='/college' || pathname==='/cfb') pathname='/college.html';
  else if(pathname==='/nfl') pathname='/nfl.html';
  const file=path.normalize(path.join(ROOT,pathname));
  if(!file.startsWith(ROOT))return send(res,403,'Forbidden');
  fs.stat(file,(err,st)=>{
    if(err||!st.isFile())return send(res,404,'Not found');
    const ext=path.extname(file).toLowerCase();
    res.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream','Cache-Control':ext==='.js'||ext==='.css'?'public, max-age=300':'no-cache'});
    fs.createReadStream(file).pipe(res);
  });
}
http.createServer((req,res)=>{
  const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(u.pathname==='/health')return send(res,200,JSON.stringify({ok:true}),{'Content-Type':'application/json'});
  if(u.pathname==='/api/espn')return proxyEspn(req,res,u);
  if(u.pathname==='/api/espn-summary')return proxyEspnSummary(req,res,u);
  if(u.pathname==='/api/pff-schedule')return proxyPffSchedule(req,res,u);
  return serveStatic(req,res,u);
}).listen(PORT,'0.0.0.0',()=>console.log(`ESG Football TV Board listening on ${PORT}`));
