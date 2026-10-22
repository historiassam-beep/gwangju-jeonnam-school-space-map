import { filterSchools, loadV15Data, openingStatus } from './roster-adapter.mjs';

const COLORS = { '02':'#14976b', '03':'#487bb4', '04':'#e09d35', '05':'#b7678e', '06':'#9b7ab8', '07':'#6f9da7' };
const OPENING_COLORS = { open:'#129869', closed:'#d66e53', none:'#929fa2', unconfirmed:'#a579b6', excluded:'#596c79', mixed:'#526c80' };
const OPENING_LABELS = { open:'개방', closed:'미개방', none:'시설없음', unconfirmed:'미확인', excluded:'공시 제외' };
const FACILITY_NAMES = { playground:'체육장', gym:'체육관', auditorium:'강당' };
const state = { data:null, boundaries:[], filtered:[], tab:'facilities', region:'', type:'', source:'', facility:'playground', openingFilter:'', county:'', selected:null, visibleRows:80, hits:[], view:{zoom:1,panX:0,panY:0}, pointer:null, moved:false };
const $ = (s) => document.querySelector(s);
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (n) => Number(n).toLocaleString('ko-KR');
const inArea = (lon,lat) => Number.isFinite(lon) && Number.isFinite(lat) && lon>=125 && lon<=128 && lat>=33.8 && lat<=35.7;
const pointOf = (s) => inArea(s.longitude,s.latitude) ? [s.longitude,s.latitude] : inArea(s.sourceLongitude,s.sourceLatitude) ? [s.sourceLongitude,s.sourceLatitude] : null;
const isLocated = (s) => pointOf(s)!==null;
const coord = ([lon,lat]) => [(lon-125)*Math.cos(35*Math.PI/180), 36-lat];
const schoolWorld = (s) => coord(pointOf(s));
let geometry, fit, canvas, ctx;

function eachRing(feature, fn) {
  const g = feature.geometry;
  if (!g) return;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  for (const poly of polys) for (const ring of poly) fn(ring);
}
function setupGeometry() {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for (const f of state.boundaries) eachRing(f, ring => { for (const p of ring) { const [x,y]=coord(p); minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y); } });
  for (const s of state.data.schools.filter(isLocated)) { const [x,y]=schoolWorld(s); minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y); }
  geometry={minX,minY,maxX,maxY,cx:(minX+maxX)/2,cy:(minY+maxY)/2};
}
function measure() {
  const box=canvas.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
  canvas.width=Math.max(1,Math.round(box.width*dpr));canvas.height=Math.max(1,Math.round(box.height*dpr));
  ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
  fit={w:box.width,h:box.height,scale:Math.min((box.width-70)/(geometry.maxX-geometry.minX),(box.height-70)/(geometry.maxY-geometry.minY))};
}
function screen(x,y) { const s=fit.scale*state.view.zoom; return [fit.w/2+(x-geometry.cx)*s+state.view.panX,fit.h/2+(y-geometry.cy)*s+state.view.panY]; }
function unscreen(px,py) { const s=fit.scale*state.view.zoom; return [geometry.cx+(px-fit.w/2-state.view.panX)/s,geometry.cy+(py-fit.h/2-state.view.panY)/s]; }
function zoomAt(mult,px=fit.w/2,py=fit.h/2) {
  const [x,y]=unscreen(px,py);
  state.view.zoom=Math.max(.65,Math.min(18,state.view.zoom*mult));
  const s=fit.scale*state.view.zoom;
  state.view.panX=px-fit.w/2-(x-geometry.cx)*s;
  state.view.panY=py-fit.h/2-(y-geometry.cy)*s;
  drawMap();
}
function drawBoundaries() {
  ctx.save();ctx.lineJoin='round';
  for (const f of state.boundaries) {
    const chosen=state.county && f.properties.sigun===state.county;
    const gwangju=f.properties.sigun.startsWith('광주 ');
    ctx.beginPath();
    eachRing(f, ring => { ring.forEach((p,i) => { const [x,y]=screen(...coord(p)); if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y); });ctx.closePath(); });
    ctx.fillStyle=chosen?'#d8eee0':gwangju?'#f2eee1':'#fafbf6';
    ctx.strokeStyle=chosen?'#37865e':'#bdcfc3';
    ctx.lineWidth=chosen?1.7:.8;
    ctx.fill('evenodd');ctx.stroke();
  }
  if(state.view.zoom>1.5) {
    ctx.font='600 10px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
    const groups=new Map();
    for(const s of state.data.schools.filter(isLocated)){const key=s.sigun;const a=groups.get(key)||{x:0,y:0,n:0};const [x,y]=schoolWorld(s);a.x+=x;a.y+=y;a.n++;groups.set(key,a);}
    for(const [name,a] of groups){const [x,y]=screen(a.x/a.n,a.y/a.n);if(x<15||x>fit.w-15||y<15||y>fit.h-15)continue;ctx.fillStyle='#e9f1e9';ctx.fillRect(x-26,y-8,52,16);ctx.fillStyle='#687c6c';ctx.fillText(name.replace(/^광주 /,''),x,y);}
  }
  ctx.restore();
}
function drawSchools() {
  const groups=new Map(), cell=state.view.zoom>=8?12:state.view.zoom>=3?18:25;
  for(const s of state.filtered) {
    if(!isLocated(s))continue;
    const [wx,wy]=schoolWorld(s),[x,y]=screen(wx,wy);
    if(x<-25||x>fit.w+25||y<-25||y>fit.h+25)continue;
    const key=`${Math.floor(x/cell)}:${Math.floor(y/cell)}`;
    const markerStatus=state.tab==='facilities'?openingStatus(s,state.facility):s.schoolTypeCode;
    const g=groups.get(key)||{x:0,y:0,wx:0,wy:0,items:[],type:markerStatus};
    g.x+=x;g.y+=y;g.wx+=wx;g.wy+=wy;g.items.push(s);
    if(g.type!==markerStatus)g.type='mixed';
    groups.set(key,g);
  }
  state.hits=[];
  for(const g of groups.values()) {
    const n=g.items.length,x=g.x/n,y=g.y/n,added=n===1&&g.items[0].sourceMembership==='schoolinfo_only';
    if(n>1) {
      const r=Math.min(17,9+Math.log2(n)*2.2);
      ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=(state.tab==='facilities'?OPENING_COLORS[g.type]:COLORS[g.type])||'#526c80';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();
      ctx.fillStyle='#fff';ctx.font='700 10px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(n),x,y+.5);
      state.hits.push({x,y,r:r+4,items:g.items,wx:g.wx/n,wy:g.wy/n});
    } else {
      ctx.beginPath();ctx.arc(x,y,4.2,0,Math.PI*2);ctx.fillStyle=(state.tab==='facilities'?OPENING_COLORS[g.type]:COLORS[g.type])||'#8d718c';ctx.fill();
      ctx.lineWidth=added?2:1;ctx.strokeStyle=added?'#284d9b':'#fff';ctx.stroke();
      state.hits.push({x,y,r:9,items:g.items,wx:g.wx,wy:g.wy});
    }
  }
}
function drawSelected() {
  const s=state.selected;if(!s||!isLocated(s))return;
  const [x,y]=screen(...schoolWorld(s));if(x<-60||x>fit.w+60||y<-60||y>fit.h+60)return;
  ctx.beginPath();ctx.arc(x,y,11,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.lineWidth=3;ctx.strokeStyle='#1b4e70';ctx.stroke();
  ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fillStyle=state.tab==='facilities'?OPENING_COLORS[openingStatus(s,state.facility)]:COLORS[s.schoolTypeCode];ctx.fill();
  ctx.font='700 12px system-ui';const width=Math.min(190,ctx.measureText(s.schoolName).width+18);
  const bx=Math.max(8,Math.min(fit.w-width-8,x-width/2)),by=Math.max(10,y-37);
  ctx.fillStyle='#fff';ctx.strokeStyle='#c9d8ce';ctx.lineWidth=1;ctx.fillRect(bx,by,width,23);ctx.strokeRect(bx,by,width,23);ctx.fillStyle='#253e43';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(s.schoolName,bx+width/2,by+11.5);
}
function drawMap() {
  if(!fit)return;
  ctx.clearRect(0,0,fit.w,fit.h);ctx.fillStyle='#e5eee9';ctx.fillRect(0,0,fit.w,fit.h);
  drawBoundaries();drawSchools();drawSelected();
  const located=state.filtered.filter(isLocated).length;
  $('#mapStatus').textContent=`지도에 ${fmt(located)}개교 표시${located<state.filtered.length?` · 위치 없음 ${fmt(state.filtered.length-located)}`:''}`;
}
function renderStats() {
  const schools=state.data.schools;
  $('#topStats').innerHTML=`<div class="stat"><strong>${fmt(schools.length)}</strong><span>기준 명부 학교</span></div>${Object.entries(FACILITY_NAMES).map(([field,name])=>`<div class="stat ${field==='playground'?'green':field==='gym'?'blue':'orange'}"><strong>${fmt(schools.filter(s=>openingStatus(s,field)==='open').length)}</strong><span>${name} 공시상 개방</span></div>`).join('')}`;
}
function renderComparison() {
  const s=state.data.summary, map=new Map(s.educationMap.byCombination.map(x=>[`${x.region}:${x.schoolTypeCode}`,x.count]));
  $('#comparisonBox').innerHTML=`<table><thead><tr><th>권역 · 학교급</th><th>교육지도 원본</th><th>확인 명부</th><th>차이</th></tr></thead><tbody>${s.schoolinfo.activeByCombination.map(x=>{const before=map.get(`${x.region}:${x.schoolTypeCode}`)||0,count=state.data.schools.filter(school=>school.region===x.region&&school.schoolTypeCode===x.schoolTypeCode).length,delta=count-before;return `<tr><td>${esc(x.region)} · ${esc(x.schoolType.replace('학교',''))}</td><td>${before}</td><td>${count}</td><td class="${delta?'diff':''}">${delta>0?'+':''}${delta}</td></tr>`}).join('')}</tbody></table>`;
}
function countyOptions() {
  const counties=[...new Set(state.data.schools.filter(s=>!state.region||s.region===state.region).map(s=>s.sigun).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
  $('#county').innerHTML='<option value="">전체 시·군·구</option>'+counties.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  $('#county').value=state.county;if($('#county').value!==state.county)state.county='';
}
function setActive(container,attr,value) {document.querySelectorAll(`#${container} button`).forEach(b=>b.classList.toggle('active',b.dataset[attr]===value));}
function openingBadge(s,field,short=false) {
  const status=openingStatus(s,field),label=OPENING_LABELS[status];
  return `<span class="opening-badge ${status}${field===state.facility?' focused':''}" title="${esc(FACILITY_NAMES[field])}: ${esc(label)}" aria-label="${esc(FACILITY_NAMES[field])} ${esc(label)}"><i></i>${short?esc(FACILITY_NAMES[field]):`${esc(FACILITY_NAMES[field])} ${esc(label)}`}</span>`;
}
function missingDisclosureText(s) {
  if(s.operationStatus==='휴')return '학교기본정보상 휴교이며, 2026년 시설 개방 공시 행이 없습니다. 개방 여부는 미확인입니다.';
  if(s.branch)return '분교장으로서 2026년 시설 개방 공시 행이 없습니다. 본교 통합 공시 여부는 확인되지 않았습니다.';
  return '2026년 시설 개방 공시 행이 없습니다. 누락 사유는 확인되지 않았습니다.';
}
function renderRows() {
  const rows=state.filtered.slice(0,state.visibleRows);
  $('#schoolList').innerHTML=rows.length?rows.map(s=>{
    const active=state.selected?.baselineId===s.baselineId;
    const marker=s.sourceMembership==='schoolinfo_only'?'<span class="pill added">명부 추가</span>':`<span class="pill">${esc(s.schoolType.replace('학교',''))}</span>`;
    const badges=state.tab==='facilities'?`<span class="opening-matrix">${['playground','gym','auditorium'].map(field=>openingBadge(s,field,true)).join('')}</span>`:marker;
    return `<button class="school-row${active?' selected':''}" role="listitem" type="button" data-id="${esc(s.baselineId)}"><span class="school-row-main"><strong>${esc(s.schoolName)}</strong><small>${esc(s.sigun||s.region)} · ${esc(s.schoolType)}${s.operationStatus==='휴'?' · 휴교':s.operationStatus==='신설'?' · 신설':''}${s.sourceMembership==='schoolinfo_only'?' · 명부 추가':''}</small></span><span class="right">${badges}</span></button>`;
  }).join(''):'<div class="empty-list">조건에 맞는 학교가 없습니다.</div>';
  $('#showMore').hidden=state.filtered.length<=state.visibleRows;
  $('#showMore').textContent=`학교 더 보기 · ${fmt(state.filtered.length-state.visibleRows)}개 남음`;
}
function renderCard() {
  const s=state.selected,box=$('#schoolCard');if(!s){box.hidden=true;return;}
  const f=s.facility||{},m=s.match||{},added=s.sourceMembership==='schoolinfo_only';
  const p=pointOf(s),sourceFallback=p&&(!inArea(s.longitude,s.latitude));
  box.innerHTML=`<button class="close-card" aria-label="학교 정보 닫기" type="button">×</button><h2>${esc(s.schoolName)}</h2><div class="card-meta">${esc(s.sigun)} · ${esc(s.schoolType)} · ${added?'학교알리미 명부 추가':'두 명부 연결'}</div><h3>2026년 공시상 시설 개방</h3><div class="card-opening">${['playground','gym','auditorium'].map(field=>openingBadge(s,field)).join('')}</div><div class="card-caption">유=공시상 개방 · 무=공시상 미개방 · 시설없음=해당 항목 없음. ${s.opening?.excluded?`이 학교는 공시 제외: ${esc(s.opening.excludeReason||'사유 미기재')}`:!s.opening?'이 학교의 개방 공시 행은 확인되지 않았습니다.':''} 실제 이용 시간·대상·예약 가능 여부는 학교에 확인하세요.</div><div class="card-grid"><span>학교알리미 코드</span><strong>${esc(s.schoolinfoCode||'–')}</strong><span>KEDI 코드</span><strong>${esc(s.kediCode||'원본에 없음')}</strong><span>주소</span><strong>${esc(s.address||'미제공')}</strong><span>지도 위치</span><strong>${p?`${p[1].toFixed(5)}, ${p[0].toFixed(5)}${sourceFallback?' · 교육지도 좌표 임시 사용':''}`:'좌표 없음'}</strong><span>명부 대조</span><strong>${added?'교육지도 원본에 없음':m.issues?.length?esc(m.issues.join(' · ')):'연결 확인'}</strong><span>체육관 수 원값</span><strong>${f.reportedGymCount??'미확인'}</strong><span>체육집회공간 수 원값</span><strong>${f.reportedAssemblySpaceCount??'미확인'}</strong></div><div class="card-warning">체육관·강당·체육집회공간의 동일 시설 여부는 별도 미확인입니다. 개방 공시의 세 항목을 물리적 시설 수로 합산하지 않습니다.${sourceFallback?' 학교알리미 좌표가 권역 밖이라 지도에는 교육지도 좌표를 임시 사용했습니다.':''}</div><a class="card-source" href="https://www.schoolinfo.go.kr/ng/go/pnnggo_a01_l2.do" target="_blank" rel="noopener noreferrer">학교알리미 공개용 데이터 ↗</a>`;
  if(s.operationStatus==='휴'||s.operationStatus==='신설')box.querySelector('.card-meta').textContent+=` · ${s.operationStatus==='휴'?'휴교':'신설'}`;
  if(s.officialStatusEvidence){
    const note=document.createElement('div');note.className='card-warning';note.textContent=`추가 공식 근거: ${s.officialStatusEvidence.finding}`;
    const link=document.createElement('a');link.className='card-source';link.href=s.officialStatusEvidence.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent=`${s.officialStatusEvidence.sourceTitle} ↗`;
    box.append(note,link);
  }
  box.querySelector('.card-caption').textContent=`유=공시상 개방 · 무=공시상 미개방 · 시설없음=해당 항목 없음. ${s.opening?.excluded?`공시 제외: ${s.opening.excludeReason||'사유 미기재'}.`:!s.opening?missingDisclosureText(s):''} 실제 이용 시간·대상·예약 가능 여부는 학교에 확인하세요.`;
  box.querySelector('.card-warning').textContent=`2026년 공식 지침상 체육관은 체육활동용(강당 겸용 포함), 강당은 집회 전용입니다. ‘체육집회공간’은 둘과 수영장을 포괄하므로 체육관 수와 합산하지 않습니다. 학교별 실제 공간·관리 주체의 동일성은 별도 증빙이 필요합니다.${sourceFallback?' 학교알리미 좌표가 권역 밖이라 지도에는 교육지도 좌표를 임시 사용했습니다.':''}`;
  const manualLink=document.createElement('a');manualLink.className='card-source';manualLink.href='https://www.schoolinfo.go.kr/ng/pd/pnngpd_a01_s0.do?pd_no=00000000000000000000000000000119';manualLink.target='_blank';manualLink.rel='noopener noreferrer';manualLink.textContent='2026 공식 입력지침 ↗';box.append(manualLink);
  box.hidden=false;box.querySelector('.close-card').addEventListener('click',()=>{state.selected=null;renderCard();renderRows();drawMap();});
}
function applyFilters() {
  const filters={query:$('#query').value,region:state.region,schoolTypeCode:state.type,sourceMembership:state.source};
  let result=filterSchools(state.data.schools,filters).filter(s=>!state.county||s.sigun===state.county);
  if(state.tab==='facilities' && state.openingFilter)result=result.filter(s=>openingStatus(s,state.facility)===state.openingFilter);
  const sort=$('#sort').value;
  result.sort((a,b)=>{const primary=sort==='county'?a.sigun.localeCompare(b.sigun,'ko'):sort==='type'?a.schoolTypeCode.localeCompare(b.schoolTypeCode):a.schoolName.localeCompare(b.schoolName,'ko');return primary||a.schoolName.localeCompare(b.schoolName,'ko');});
  state.filtered=result;
  if(state.selected&&!result.includes(state.selected))state.selected=null;
  $('#resultCount').textContent=`목록 ${fmt(result.length)}개교`;
  $('#resultSub').textContent=state.tab==='comparison'?'12개 권역·학교급 조합의 차이 · 교육지도 원본 대비 확인된 폐교 2개교 제외':state.tab==='facilities'?`2026년 ${FACILITY_NAMES[state.facility]} 공시상 개방 · 실시간 이용 가능 여부 아님`:'학교를 선택하면 지도 위치와 원자료를 볼 수 있습니다.';
  $('#listValueTitle').textContent=state.tab==='facilities'?'체육장 · 체육관 · 강당':'학교급 · 출처';
  $('#typeLegend').hidden=state.tab==='facilities';$('#openingLegend').hidden=state.tab!=='facilities';
  renderRows();renderCard();drawMap();
}
function setTab(tab) {state.tab=tab;document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));$('#comparisonBox').hidden=tab!=='comparison';$('#facilityFilters').hidden=tab!=='facilities';$('#facilityNote').hidden=tab!=='facilities';state.visibleRows=80;applyFilters();}
function selectSchool(s,center=true) {state.selected=s;if(center&&isLocated(s)){const [x,y]=schoolWorld(s);state.view.zoom=Math.max(state.view.zoom,4);const scale=fit.scale*state.view.zoom;state.view.panX=-(x-geometry.cx)*scale;state.view.panY=-(y-geometry.cy)*scale;}renderRows();renderCard();drawMap();}
function csvCell(v) {return '"'+String(v??'').replaceAll('"','""')+'"';}
function downloadCsv() {
  const cols=['학교명','권역','시군구','학교급','KEDI코드','학교알리미코드','주소','위도','경도','명부출처','체육장 공시상 개방','체육관 공시상 개방','강당 공시상 개방','체육관 수 원값','체육집회공간 수 원값','시설 동일성 검증'];
  const rows=state.filtered.map(s=>[s.schoolName,s.region,s.sigun,s.schoolType,s.kediCode,s.schoolinfoCode,s.address,s.latitude,s.longitude,s.sourceMembership,...['playground','gym','auditorium'].map(field=>OPENING_LABELS[openingStatus(s,field)]),s.facility?.reportedGymCount,s.facility?.reportedAssemblySpaceCount,'미확인']);
  const footers=[
    ['만든이','히스토리아쌤(광주역사교사모임)'],
    ['출처·기준일','전남광주교육지도 명부: 2026-10-05 자료','https://github.com/historiassam-beep/jn-gj-edu-map'],
    ['출처·기준일','학교알리미 2026 학교기본정보: 2026-10-22 조회','https://www.schoolinfo.go.kr/ng/go/pnnggo_a01_l2.do'],
    ['출처·기준일','학교알리미 2026 학교시설 개방에 관한 사항: 2026-10-23 조회','https://www.schoolinfo.go.kr/ng/go/pnnggo_a01_l2.do'],
    ['해석 주의','2026년 5월 동결본과의 일치 여부는 미확인. 개방은 연례 공시상 상태이며 현재 이용·예약 가능 여부가 아님. 체육관·강당 동일성은 미확인.']
  ];
  const lines=[cols,...rows,...footers].map(r=>Array.from({length:cols.length},(_,i)=>csvCell(r[i])).join(','));
  const blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='gwangju-jeonnam-schools-v1.5-filtered.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function bind() {
  $('#query').addEventListener('input',()=>{state.visibleRows=80;applyFilters();});
  $('#county').addEventListener('change',e=>{state.county=e.target.value;applyFilters();});
  $('#sort').addEventListener('change',applyFilters);
  $('#regionButtons').addEventListener('click',e=>{const b=e.target.closest('button[data-region]');if(!b)return;state.region=b.dataset.region;state.county='';setActive('regionButtons','region',state.region);countyOptions();applyFilters();});
  $('#typeButtons').addEventListener('click',e=>{const b=e.target.closest('button[data-type]');if(!b)return;state.type=b.dataset.type;setActive('typeButtons','type',state.type);applyFilters();});
  $('#sourceButtons').addEventListener('click',e=>{const b=e.target.closest('button[data-source]');if(!b)return;state.source=b.dataset.source;setActive('sourceButtons','source',state.source);applyFilters();});
  $('#facilityButtons').addEventListener('click',e=>{const b=e.target.closest('button[data-facility]');if(!b)return;state.facility=b.dataset.facility;setActive('facilityButtons','facility',state.facility);applyFilters();});
  $('#openingButtons').addEventListener('click',e=>{const b=e.target.closest('button[data-opening]');if(!b)return;state.openingFilter=b.dataset.opening;setActive('openingButtons','opening',state.openingFilter);applyFilters();});
  $('.tabs').addEventListener('click',e=>{const b=e.target.closest('button[data-tab]');if(b)setTab(b.dataset.tab);});
  $('#schoolList').addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(b)selectSchool(state.data.indexes.byBaselineId.get(b.dataset.id));});
  $('#showMore').addEventListener('click',()=>{state.visibleRows+=80;renderRows();});
  $('#downloadCsv').addEventListener('click',downloadCsv);
  $('#helpButton').addEventListener('click',()=>$('#helpDialog').showModal());
  $('#fitMap').addEventListener('click',()=>{state.view={zoom:1,panX:0,panY:0};drawMap();});
  $('#zoomIn').addEventListener('click',()=>zoomAt(1.7));$('#zoomOut').addEventListener('click',()=>zoomAt(1/1.7));
  canvas.addEventListener('wheel',e=>{e.preventDefault();const r=canvas.getBoundingClientRect();zoomAt(e.deltaY<0?1.25:.8,e.clientX-r.left,e.clientY-r.top);},{passive:false});
  canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);state.pointer={x:e.clientX,y:e.clientY,panX:state.view.panX,panY:state.view.panY};state.moved=false;});
  canvas.addEventListener('pointermove',e=>{if(!state.pointer)return;const dx=e.clientX-state.pointer.x,dy=e.clientY-state.pointer.y;if(Math.hypot(dx,dy)>4)state.moved=true;if(state.moved){state.view.panX=state.pointer.panX+dx;state.view.panY=state.pointer.panY+dy;drawMap();}});
  canvas.addEventListener('pointerup',e=>{if(!state.pointer)return;state.pointer=null;if(state.moved)return;const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;const hit=[...state.hits].reverse().find(h=>Math.hypot(h.x-x,h.y-y)<=h.r);if(!hit)return;if(hit.items.length===1)selectSchool(hit.items[0],false);else {const scale=fit.scale*Math.min(18,state.view.zoom*2);state.view.zoom=Math.min(18,state.view.zoom*2);state.view.panX=-(hit.wx-geometry.cx)*scale;state.view.panY=-(hit.wy-geometry.cy)*scale;drawMap();}});
  window.addEventListener('resize',()=>{measure();drawMap();});
}
async function init() {
  try {
    const [data,boundaries]=await Promise.all([loadV15Data('.'),fetch('data/sigun.geojson').then(r=>{if(!r.ok)throw new Error('행정경계를 불러오지 못했습니다.');return r.json();})]);
    state.data=data;state.boundaries=boundaries.features;canvas=$('#map');setupGeometry();measure();renderStats();renderComparison();countyOptions();bind();setTab('facilities');
  } catch(err) {$('#mapStatus').textContent=`데이터 연결 실패: ${err.message}`;$('#resultSub').textContent='원본 자료를 확인해 주세요.';console.error(err);}
}
init();
