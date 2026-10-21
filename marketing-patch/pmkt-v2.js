// ═══ Marketing Studio v3 — thay phần hiển thị của trang Marketing (4 tab). Giữ nguyên các hàm nối dữ liệu:
// mktLoad, mktToggleAuto, mktSaveConn, mktToggleChannel, mktQuickPush, mktExportCsv, mktCopy, mktShareFb, mktDrawPoster, mktPosterDownload, showXaKho, mktXaNgay.
let MKT={settings:null,posts:[],loading:false,studio:null,tab:'overview',connSel:'facebook',hf:{q:'',ch:'',kind:'',st:''}};

const MKT_TABS=[['overview','Tổng quan','ti-layout-dashboard'],['campaign','Hàng cần quảng bá','ti-flame'],['history','Lịch sử','ti-history'],['connect','Thiết lập đăng bài','ti-settings-automation']];
function mktSetTab(t){MKT.tab=t;R();}

function pMkt(){
  if(!MKT.settings)setTimeout(mktLoad,0);
  if(MKT.tab==='report')MKT.tab='history';
  const s=MKT.settings||{},hotN=mktHotList().filter(p=>p.l!=='green').length;
  const nav='<div class="mx-tabs">'+MKT_TABS.map(t=>'<button type="button" class="mx-tab'+(MKT.tab===t[0]?' on':'')+'" onclick="mktSetTab(\''+t[0]+'\')"><i class="ti '+t[2]+'"></i> '+t[1]+(t[0]==='campaign'&&hotN?'<em>'+hotN+'</em>':'')+'</button>').join('')+'</div>';
  const body=MKT.tab==='campaign'?mktCampaign(s):MKT.tab==='history'?mktHistory():MKT.tab==='connect'?mktConnect(s):mktOverview(s);
  return nav+body;
}

// ───── Thẻ Auto-bot (dùng ở Tổng quan và Thiết lập đăng bài)
function mktAutoCard(s){
  return '<div class="card m14"><div class="f ac g12" style="flex-wrap:wrap"><div class="mk-ic"><i class="ti ti-robot"></i></div><div class="f1" style="min-width:220px"><div class="f ac g8" style="flex-wrap:wrap"><span style="font-family:\'Plus Jakarta Sans\';font-size:16px;font-weight:900;color:var(--green-950)">Auto-bot đăng bài</span><span class="tg '+(s.marketing_auto?'tg-g':'tg-y')+'">'+(s.marketing_auto?'Đang bật':'Đang tắt')+'</span></div>'+
    '<div style="font-size:12px;color:var(--muted);font-weight:600;margin-top:2px;line-height:1.55">Khi hàng chuyển nhãn vàng / đỏ, hệ thống tự viết bài và đăng lên các kênh đang dùng. Hàng đỏ còn 2 giờ cuối sẽ có thêm một bài nhắc.</div></div>'+
    '<button type="button" class="mk-sw" role="switch" aria-checked="'+(s.marketing_auto?'true':'false')+'" aria-label="Bật tắt Auto-bot" onclick="mktToggleAuto()"><i></i></button></div></div>';
}

// ───── Số liệu bài đăng (chỉ các nền tảng mạng xã hội, không tính thông báo trong app)
const mktSocial=()=>MKT.posts.filter(x=>x.channel!=='buyers'&&x.channel!=='email');
const mktDay0=(off)=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-off);return d;};
const mktInRange=(x,a,b)=>{const t=new Date(x.created_at);return t>=a&&t<b;};
function mktKpis(){
  const soc=mktSocial(),a7=mktDay0(6),end=mktDay0(-1),t0=mktDay0(0);
  const w=soc.filter(x=>mktInRange(x,a7,end)),today=soc.filter(x=>mktInRange(x,t0,end));
  const ok7=w.filter(mktOk).length,fail7=w.filter(x=>x.status==='failed').length;
  const hot=PRD.filter(p=>(p.l==='red'||p.l==='yellow')&&p.q>0&&!p.blocked&&!p.donated).length;
  return [
    {l:'Sản phẩm cần quảng bá',v:hot,i:'ti-flame',c:'var(--red)',bg:'var(--red-100)',s:'Nhãn vàng / đỏ'},
    {l:'Bài đăng 7 ngày qua',v:w.length,i:'ti-calendar-week',c:'var(--blue)',bg:'var(--blue-100)',s:'Tất cả nền tảng'},
    {l:'Bài đăng hôm nay',v:today.length,i:'ti-send',c:'var(--green-700)',bg:'var(--green-100)',s:'Trong 1 ngày'},
    {l:'Đăng thành công 7 ngày',v:ok7,i:'ti-circle-check',c:'var(--yellow-600)',bg:'var(--yellow-100)',s:fail7?fail7+' lần lỗi':'Không có lỗi'}
  ];
}
const mktSendList=()=>mktEnabled();

// ───── Thống kê 7 ngày: cột xếp chồng theo nhãn + bảng chi tiết theo nhãn và nền tảng
function mktWeek(){
  const names=['CN','T2','T3','T4','T5','T6','T7'],soc=mktSocial(),rows=[];
  for(let i=6;i>=0;i--){
    const d=mktDay0(i),n=mktDay0(i-1),ps=soc.filter(x=>mktInRange(x,d,n));
    const lab=l=>ps.filter(x=>((x.products&&x.products.label)||'')===l).length;
    const r=lab('red'),y=lab('yellow'),g=lab('green'),by=k=>ps.filter(x=>x.channel===k).length;
    rows.push({n:names[d.getDay()],date:d.toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit'}),r,y,g,o:ps.length-r-y-g,t:ps.length,ch:MKT_PLAT.map(p=>by(p.k))});
  }
  return rows;
}
function mktStats(){
  const rows=mktWeek(),mx=Math.max(1,...rows.map(x=>x.t)),tot=rows.reduce((a,x)=>a+x.t,0);
  if(!tot)return '<div class="mk-empty"><i class="ti ti-chart-bar"></i>Chưa có bài đăng nào trong 7 ngày qua.</div>';
  const bars='<div class="mx-bars">'+rows.map(x=>{const h=Math.round(x.t/mx*120);
    return '<div class="mx-bar"><b>'+x.t+'</b><div class="mx-stack" style="height:'+h+'px"><s style="flex:'+x.r+';background:#dc2626"></s><s style="flex:'+x.y+';background:#facc15"></s><s style="flex:'+(x.g+x.o)+';background:#22c55e"></s></div><small>'+x.n+'<br>'+x.date+'</small></div>';}).join('')+'</div>'+
    '<div class="mx-leg"><span><i style="background:#dc2626"></i>Nhãn đỏ</span><span><i style="background:#facc15"></i>Nhãn vàng</span><span><i style="background:#22c55e"></i>Nhãn xanh</span></div>';
  const sum=f=>rows.reduce((a,x)=>a+f(x),0);
  const tbl='<div class="mx-w" style="margin-top:14px"><table class="tbl"><thead><tr><th>Ngày</th><th>Đỏ</th><th>Vàng</th><th>Xanh</th>'+MKT_PLAT.map(p=>'<th><i class="ti '+p.i+'" style="color:'+p.c+'"></i> '+mktEsc(p.n.split(' ')[0])+'</th>').join('')+'<th>Tổng</th></tr></thead><tbody>'+
    rows.slice().reverse().map(x=>'<tr style="cursor:default"><td><b>'+x.n+'</b> '+x.date+'</td><td>'+x.r+'</td><td>'+x.y+'</td><td>'+(x.g+x.o)+'</td>'+x.ch.map(c=>'<td>'+c+'</td>').join('')+'<td><b>'+x.t+'</b></td></tr>').join('')+
    '<tr class="mx-sumrow" style="cursor:default"><td><b>Cộng 7 ngày</b></td><td>'+sum(x=>x.r)+'</td><td>'+sum(x=>x.y)+'</td><td>'+sum(x=>x.g+x.o)+'</td>'+MKT_PLAT.map((p,i)=>'<td>'+sum(x=>x.ch[i])+'</td>').join('')+'<td><b>'+tot+'</b></td></tr></tbody></table></div>';
  const MXC={facebook:'#1877f2',instagram:'#e1306c',tiktok:'#111827',zalo:'#14b8a6'},pc=p=>MXC[p.k]||p.c;
  const pt=MKT_PLAT.map((p,i)=>({p,n:sum(x=>x.ch[i])})),parts=pt.filter(x=>x.n>0);
  let acc=0;const stops=parts.map(x=>{const a=acc/tot*360;acc+=x.n;return pc(x.p)+' '+a+'deg '+(acc/tot*360)+'deg';}).join(',');
  const donut='<div class="mx-donut-w"><div class="mx-donut" style="background:conic-gradient('+stops+')"><div><b>'+tot+'</b><small>bài đăng</small></div></div><div class="mx-dleg">'+
    pt.map(x=>'<div class="mx-dl"><i style="background:'+pc(x.p)+'"></i><span><i class="ti '+x.p.i+'"></i> '+mktEsc(x.p.n.split(' ')[0])+'</span><b>'+x.n+'</b><em>'+Math.round(x.n/tot*100)+'%</em></div>').join('')+'</div></div>';
  return '<div class="mx-stat2"><div><div class="mk-sub" style="margin-top:0">Theo nhãn sản phẩm</div>'+bars+'</div><div><div class="mk-sub" style="margin-top:0">Theo nền tảng đăng bài</div>'+donut+'</div></div>';
}

function mktEventText(x){
  const nm='“'+mktEsc((x.products&&x.products.name)||'Sản phẩm')+'”',p=mktPlat(x.channel).n;
  if(x.status==='failed')return ['e','Đăng '+nm+' lên '+p+' bị lỗi'+(x.error?': '+mktEsc(x.error):'')];
  if(x.status==='ready')return ['w','Nội dung '+nm+' cho '+p+' đã sẵn sàng để bạn đăng'];
  return ['',(x.kind==='auto'?'Auto-bot đã đăng ':'Đã đăng ')+nm+' lên '+p+(x.variant==='reminder'?' (bài nhắc)':'')];
}
function mktOverview(s){
  const kp=mktKpis();
  const ev=mktSocial().slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,8).map(x=>{const e=mktEventText(x);
    return '<div class="mx-ev '+e[0]+'">'+e[1]+'<small>'+new Date(x.created_at).toLocaleString('vi-VN')+'</small></div>';}).join('');
  return '<div class="grid-4 m16">'+kp.map(k=>'<div class="metric" style="cursor:default"><div class="f ac jb"><span class="metric-l">'+k.l+'</span><div class="metric-ic" style="background:'+k.bg+';color:'+k.c+'"><i class="ti '+k.i+'"></i></div></div><div class="metric-v" style="color:'+k.c+'">'+k.v+'</div><div style="font-size:11px;font-weight:800;color:'+k.c+';margin-top:5px">'+k.s+'</div></div>').join('')+'</div>'+
    mktAutoCard(s)+
    '<div class="card m14"><div class="st"><i class="ti ti-chart-bar"></i> Thống kê bài đăng 7 ngày qua</div>'+mktStats()+'</div>'+
    '<div class="card"><div class="st"><i class="ti ti-activity"></i> Lịch sử hoạt động<span class="mk-hint"><a style="color:var(--green-700);cursor:pointer" onclick="mktSetTab(\'history\')">Xem tất cả →</a></span></div>'+
      (ev?'<div class="mx-tl">'+ev+'</div>':'<div class="mk-empty"><i class="ti ti-inbox"></i>Chưa có hoạt động nào.</div>')+'</div>';
}

// ───── Tab 2: Hàng cần quảng bá + xem trước ngay trên trang
function mktCampaign(s){
  const list=mktHotList(),st=MKT.studio;
  const rows=list.map(p=>'<tr class="'+(st&&st.productId===p.id?'sel':'')+'" onclick="mktOpenStudio(\''+p.id+'\')"><td><div class="f ac g10"><span class="mk-emo">'+p.img+'</span><b>'+mktEsc(p.n)+'</b></div></td><td><span class="tg '+lT(p.l)+'">'+lN(p.l)+'</span></td><td><b'+(p.l==='red'?' style="color:var(--red)"':'')+'>'+mktEsc(p.left)+'</b></td><td><b>'+fm(p.p)+'</b></td></tr>').join('');
  return '<div class="mx-split"><div class="card-h"><div class="mx-hd"><div class="st" style="margin:0"><i class="ti ti-flame"></i> Hàng cần quảng bá<span class="mk-hint">đỏ trước, còn ít thời gian lên đầu</span></div></div>'+
    (list.length?'<div class="mx-w"><table class="tbl"><thead><tr><th>Sản phẩm</th><th>Nhãn</th><th>Còn lại</th><th>Giá</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<div class="mk-empty"><i class="ti ti-leaf"></i>Chưa có sản phẩm nào để quảng bá.</div>')+
    '</div>'+
    '<div class="mx-prev">'+mktPreview()+'</div></div>';
}

function mktPreview(){
  const st=MKT.studio,head='<div class="st"><i class="ti ti-eye"></i> Xem trước chiến dịch</div>';
  if(!st)return '<div class="card">'+head+'<div class="mk-empty"><i class="ti ti-pointer"></i>Chọn một sản phẩm ở bảng bên trái để xem bài đăng và poster.</div></div>';
  if(st.loading)return '<div class="card">'+head+'<div class="mk-empty"><i class="ti ti-loader-2"></i>Đang viết bài…</div></div>';
  if(st.error)return '<div class="card">'+head+'<div class="mk-empty" style="color:var(--red)"><i class="ti ti-alert-circle"></i>'+mktEsc(st.error)+'</div></div>';
  const d=st.data,sel=mktEnabled(),editable=sel;
  if(!editable.includes(st.tab))st.tab=editable[0]||'facebook';
  const storeName=(d.store&&d.store.name)||'Cửa hàng',init=storeName.split(' ').slice(0,2).map(w=>(w[0]||'')).join('').toUpperCase();
  const seg=editable.length?'<div class="mx-seg">'+editable.map(k=>{const q=mktPlat(k);return '<button type="button" class="'+(st.tab===k?'on':'')+'" onclick="mktTab(\''+k+'\')"><i class="ti '+q.i+'" style="color:'+q.c+'"></i> '+mktEsc(q.n.split(' ')[0])+'</button>';}).join('')+'</div>':'';
  const showPoster=!editable.length||st.tab==='facebook'||st.tab==='instagram';
  const txt=st.texts[st.tab]||'';
  const post='<div class="mx-fb"><div class="mx-fb-h"><div class="mx-av">'+mktEsc(init)+'</div><div><b>'+mktEsc(storeName)+'</b><small>'+mktEsc(d.product.name)+'</small></div></div>'+
    (editable.length?'<textarea id="mkt-text" class="mx-ta" rows="'+(st.tab==='tiktok'?9:6)+'" oninput="MKT.studio.texts[MKT.studio.tab]=this.value;document.getElementById(\'mkt-cnt\').textContent=this.value.length+\' ký tự\'">'+mktEsc(txt)+'</textarea>':'')+
    (showPoster?'<canvas id="mkt-poster" class="mx-poster"></canvas>':'')+'</div>';
  const tools=editable.length?'<div class="f ac jb" style="margin:8px 0 0;flex-wrap:wrap;gap:8px"><small id="mkt-cnt" style="color:var(--muted);font-weight:700">'+txt.length+' ký tự</small><div class="f g6" style="flex-wrap:wrap"><button class="btn btn-sm btn-o" onclick="mktCopy()"><i class="ti ti-copy"></i> Sao chép</button>'+(st.tab==='facebook'?'<button class="btn btn-sm btn-o" onclick="mktShareFb()"><i class="ti ti-brand-facebook"></i> Chia sẻ</button>':'')+(showPoster?'<button class="btn btn-sm btn-o" onclick="mktPosterDownload()"><i class="ti ti-photo-down"></i> Tải poster</button>':'')+'</div></div>'
    :'<div class="f jc" style="margin-top:8px"><button class="btn btn-sm btn-o" onclick="mktPosterDownload()"><i class="ti ti-photo-down"></i> Tải poster</button></div>';
  const noSoc=editable.length?'':'<div class="mk-note" style="margin:0 0 12px"><i class="ti ti-info-circle"></i> Chưa có nền tảng nào đang dùng. Vào <a style="color:var(--green-700);cursor:pointer;font-weight:800" onclick="mktSetTab(\'connect\')">Thiết lập đăng bài</a> để điền thông tin và bật ít nhất một nền tảng.</div>';
  const res=(st.result&&st.result.length)?'<div class="mx-res">'+st.result.map(r=>'<div class="mx-res-i"><i class="ti '+(r.ok?'ti-circle-check-filled':'ti-alert-circle')+'" style="color:'+(r.ok?'var(--green-700)':'var(--red)')+'"></i><span>'+mktEsc(r.t)+'</span></div>').join('')+'</div>':'';
  const html='<div class="card">'+head+'<div class="mx-ptitle">'+(d.product.emoji||'')+' '+mktEsc(d.product.name)+'</div>'+seg+post+tools+noSoc+
    '<div class="mk-pub" style="margin-top:12px"><div class="mk-pub-t">Sẽ đăng lên</div><div class="mk-chips" style="margin-bottom:12px">'+sel.map(k=>{const p=mktPlat(k);return '<span class="mk-chip on lock" style="--pc:'+p.c+'"><i class="ti '+p.i+'"></i><span>'+mktEsc(p.n)+'</span></span>';}).join('')+'</div>'+
    '<button class="btn btn-primary btn-lg" style="width:100%;justify-content:center" '+(editable.length?'':'disabled ')+'onclick="mktPublish()"><i class="ti ti-send"></i> Phát hành chiến dịch</button>'+res+
    '<div class="mk-note" style="margin-top:10px"><i class="ti ti-info-circle"></i> Facebook được đăng ngay. Instagram, TikTok, Zalo nhận nội dung và poster sẵn sàng để bạn đăng thủ công. Muốn thêm hoặc bớt nền tảng, vào Thiết lập đăng bài.</div></div></div>';
  setTimeout(mktDrawPoster,0);
  return html;
}

async function mktOpenStudio(productId){
  MKT.tab='campaign';MKT.studio={productId,loading:true};R();
  try{
    const data=await window.FS.sync.getMarketingContent(productId),c=data.content;
    MKT.studio={productId,data,tab:'facebook',texts:{facebook:c.facebook,instagram:c.instagram,tiktok:c.tiktok,zalo:c.zalo},result:[]};
  }catch(err){MKT.studio={productId,error:(err&&err.message)||'Không tải được nội dung'};}
  if(pg==='marketing')R();
}
function mktTab(tab){MKT.studio.tab=tab;R();}
async function mktPublish(){
  const st=MKT.studio;if(!st||!st.data)return;
  const sel=mktEnabled();if(!sel.length){tst('Chưa có nền tảng','Hãy bật ít nhất một nền tảng ở Thiết lập đăng bài','info');return;}
  try{
    const res=(await window.FS.sync.promoteProduct(st.productId,{channels:sel,...(sel.includes('facebook')?{facebook_text:st.texts.facebook}:{})})).results||{};
    const out=[];let ok=false;
    Object.keys(res).filter(k=>k!=='buyers').forEach(k=>{const r=res[k],n=mktPlat(k).n;
      if(r.status==='sent'){ok=true;out.push({ok:true,t:'Đã đăng '+n});}
      else if(r.status==='ready'){ok=true;out.push({ok:true,t:n+': nội dung sẵn sàng, bạn đăng thủ công'});}
      else out.push({ok:false,t:n+': '+(r.reason||'chưa gửi được')});});
    st.result=out;
    tst('Kết quả chiến dịch',out.map(o=>o.t).join(' · '),ok?'accept':'info');
  }catch(err){st.result=[{ok:false,t:err&&err.message||'Không phát hành được'}];tst('Không phát hành được',err&&err.message||'Vui lòng thử lại','info');}
  R();mktLoad(true);
}

// ───── Xuất CSV theo kỳ (ngày / tuần / tháng / quý / năm hiện tại)
const MKT_PERIODS=[['day','Hôm nay'],['week','Tuần này'],['month','Tháng này'],['quarter','Quý này'],['year','Năm nay'],['all','Tất cả']];
function mktPeriodStart(k){
  const d=new Date();d.setHours(0,0,0,0);
  if(k==='week')d.setDate(d.getDate()-((d.getDay()+6)%7));
  else if(k==='month')d.setDate(1);
  else if(k==='quarter'){d.setDate(1);d.setMonth(Math.floor(d.getMonth()/3)*3);}
  else if(k==='year'){d.setDate(1);d.setMonth(0);}
  else if(k==='all')return new Date(0);
  return d;
}
function mktExportCsv(){
  const sel=document.getElementById('mkt-exp'),k=sel?sel.value:'month',a=mktPeriodStart(k),lab=(MKT_PERIODS.find(p=>p[0]===k)||[])[1]||'';
  const list=mktSocial().filter(x=>new Date(x.created_at)>=a).sort((x,y)=>new Date(y.created_at)-new Date(x.created_at));
  if(!list.length){tst('Không có dữ liệu','Không có bài đăng nào trong kỳ "'+lab+'"','info');return;}
  const rows=[['Thời gian','Sản phẩm','Nhãn','Nền tảng','Loại','Trạng thái']].concat(list.map(x=>[new Date(x.created_at).toLocaleString('vi-VN'),(x.products&&x.products.name)||'',x.products&&x.products.label?lN(x.products.label):'',MKT_CHANNEL[x.channel]||x.channel,MKT_KIND(x),(MKT_STATUS[x.status]||[x.status])[0]]));
  const csv='﻿'+rows.map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\r\n');
  const el=document.createElement('a');el.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));el.download='bao-cao-marketing-'+k+'.csv';el.click();
  tst('Đã xuất CSV',list.length+' bài đăng · '+lab,'accept');
}

// ───── Tab 3: Lịch sử (gộp Báo cáo cũ)
const MKT_KIND=x=>x.variant==='reminder'?'Nhắc lại':x.kind==='auto'?'Auto-bot':'Thủ công';
function mktHistList(){
  const f=MKT.hf,q=(f.q||'').toLowerCase();
  return mktSocial().filter(x=>(!q||((x.products&&x.products.name)||'').toLowerCase().includes(q))&&(!f.ch||x.channel===f.ch)&&(!f.kind||MKT_KIND(x)===f.kind)&&(!f.st||(f.st==='ok'?mktOk(x):x.status===f.st)))
    .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
}
function mktHistBody(){
  const h=mktHistList();
  if(!h.length)return '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:26px;font-weight:700">'+(mktSocial().length?'Không có mục nào phù hợp bộ lọc':'Chưa có chiến dịch nào. Hãy tạo chiến dịch đầu tiên ở tab Hàng cần quảng bá.')+'</td></tr>';
  return h.slice(0,100).map(x=>{const st=MKT_STATUS[x.status]||[x.status,'tg-y'],p=mktPlat(x.channel),l=x.products&&x.products.label;
    return '<tr onclick="mktHistOpen(\''+x.id+'\')"><td style="white-space:nowrap;color:var(--muted)">'+new Date(x.created_at).toLocaleString('vi-VN')+'</td><td><b>'+mktEsc((x.products&&x.products.name)||'Sản phẩm')+'</b></td><td><span class="mx-pill"><i class="ti '+p.i+'" style="color:'+p.c+'"></i>'+mktEsc(p.n.split(' ')[0])+'</span></td><td>'+(l?'<span class="tg '+lT(l)+'">'+lN(l)+'</span>':'—')+'</td><td>'+MKT_KIND(x)+'</td><td><span class="tg '+st[1]+'">'+st[0]+'</span></td></tr>';}).join('');
}
function mktDrawHist(){
  const b=document.getElementById('mkt-hbody'),c=document.getElementById('mkt-hcount');
  if(b)b.innerHTML=mktHistBody();if(c)c.textContent=Math.min(mktHistList().length,100)+' mục';
}
function mktHF(k,v){MKT.hf[k]=v;mktDrawHist();}
function mktHistory(){
  const f=MKT.hf,opt=(v,t,cur)=>'<option value="'+v+'"'+(cur===v?' selected':'')+'>'+t+'</option>';
  const soc=mktSocial(),ok=soc.filter(mktOk).length,fail=soc.filter(x=>x.status==='failed').length,auto=soc.filter(x=>x.kind==='auto').length;
  return '<div class="mx-sum"><div><b>'+ok+'</b><small>Đã gửi / đăng</small></div><div><b>'+auto+'</b><small>Do Auto-bot</small></div><div><b>'+fail+'</b><small>Lỗi</small></div></div>'+
    '<div class="card-h"><div class="mx-hd"><div class="mx-filters">'+
      '<input class="inp" placeholder="Tìm sản phẩm…" value="'+mktEsc(f.q)+'" oninput="mktHF(\'q\',this.value)">'+
      '<select class="inp" onchange="mktHF(\'ch\',this.value)">'+opt('','Mọi kênh',f.ch)+MKT_PLAT.map(p=>p.k).map(k=>opt(k,mktEsc(mktPlat(k).n),f.ch)).join('')+'</select>'+
      '<select class="inp" onchange="mktHF(\'kind\',this.value)">'+opt('','Mọi loại',f.kind)+['Auto-bot','Thủ công','Nhắc lại'].map(k=>opt(k,k,f.kind)).join('')+'</select>'+
      '<select class="inp" onchange="mktHF(\'st\',this.value)">'+opt('','Mọi trạng thái',f.st)+opt('ok','Đã gửi / đăng',f.st)+opt('ready','Nội dung sẵn sàng',f.st)+opt('failed','Lỗi',f.st)+'</select></div>'+
      '<div class="f ac g10"><small id="mkt-hcount" style="color:var(--muted);font-weight:700">'+Math.min(mktHistList().length,100)+' mục</small><select class="inp" id="mkt-exp" style="width:auto;padding:8px 10px;font-size:12.5px">'+MKT_PERIODS.map(p=>'<option value="'+p[0]+'"'+(p[0]==='month'?' selected':'')+'>'+p[1]+'</option>').join('')+'</select><button class="btn btn-sm btn-o" onclick="mktExportCsv()"><i class="ti ti-file-spreadsheet"></i> Xuất CSV</button></div></div>'+
    '<div class="mx-w"><table class="tbl"><thead><tr><th>Thời gian</th><th>Sản phẩm</th><th>Kênh</th><th>Nhãn</th><th>Loại</th><th>Trạng thái</th></tr></thead><tbody id="mkt-hbody">'+mktHistBody()+'</tbody></table></div></div>';
}
function mktDrawerOpen(title,html){
  let el=document.getElementById('mk-dp');if(!el){el=document.createElement('div');el.id='mk-dp';document.body.appendChild(el);}
  el.className='';el.innerHTML='<div class="mk-dpo" onclick="mktDrawerClose()"></div><aside class="mk-dpp"><div class="mk-dph"><h3>'+title+'</h3><button class="btn btn-sm btn-o" onclick="mktDrawerClose()">Đóng</button></div><div class="mk-dpb">'+html+'</div></aside>';
  requestAnimationFrame(()=>el.classList.add('open'));
}
function mktDrawerClose(){const el=document.getElementById('mk-dp');if(!el)return;el.classList.remove('open');setTimeout(()=>{if(!el.classList.contains('open'))el.remove();},260);}
function mktHistOpen(id){
  const x=MKT.posts.find(p=>p.id===id);if(!x)return;
  const st=MKT_STATUS[x.status]||[x.status,'tg-y'],p=mktPlat(x.channel),l=x.products&&x.products.label;
  const r=(a,b)=>'<div class="mk-dr"><div class="mk-dl">'+a+'</div><div class="mk-dv">'+b+'</div></div>';
  mktDrawerOpen('Chi tiết chiến dịch',
    r('Sản phẩm','<b>'+mktEsc((x.products&&x.products.name)||'Sản phẩm')+'</b>')+r('Kênh',mktEsc(MKT_CHANNEL[x.channel]||x.channel))+r('Nhãn / Loại',(l?'<span class="tg '+lT(l)+'">'+lN(l)+'</span> · ':'')+MKT_KIND(x))+
    r('Thời gian',new Date(x.created_at).toLocaleString('vi-VN'))+r('Trạng thái','<span class="tg '+st[1]+'">'+st[0]+'</span>'+(x.status==='ready'?' · kênh chưa tự đăng, hãy đăng thủ công':'')+(x.error?'<div style="color:var(--red);margin-top:4px">'+mktEsc(x.error)+'</div>':''))+
    (x.external_url?r('Liên kết','<a href="'+mktEsc(x.external_url)+'" target="_blank" rel="noopener" style="color:var(--green-700);font-weight:800">Mở bài đăng</a>'):'')+
    '<div class="mk-dsec">Nội dung</div><div class="mk-dtxt">'+(x.content?mktEsc(x.content):'<span style="color:var(--muted)">Không lưu nội dung.</span>')+'</div>'+
    (x.content?'<div style="padding:0 20px 20px"><button class="btn btn-sm btn-primary" onclick="mktCopyPost(\''+x.id+'\')"><i class="ti ti-copy"></i> Sao chép nội dung</button></div>':''));
}
function mktCopyPost(id){
  const x=MKT.posts.find(p=>p.id===id);if(!x||!x.content)return;
  (navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(x.content):Promise.reject()).then(()=>tst('Đã sao chép','Dán vào bài đăng của bạn','accept')).catch(()=>tst('Không sao chép được','Hãy bôi đen và sao chép thủ công','info'));
}

// ───── Tab 4: Thiết lập đăng bài (chọn nền tảng + kết nối + hành vi)
const MKT_BEHAVIOR={
  facebook:['Tự đăng lên Fanpage qua n8n; n8n không gọi được thì đăng trực tiếp (nếu có token dự phòng).','Hàng nhãn vàng / đỏ: tự đăng khi đổi nhãn (cần bật Auto-bot).','Hàng đỏ còn 2 giờ cuối: thêm một bài nhắc, mỗi sản phẩm một lần.','Nội dung theo nhóm hàng và nhãn, không ghi số lượng còn lại. Kèm poster.'],
  instagram:['Hiện tạo sẵn nội dung và poster 1080×1350 (trạng thái “Nội dung sẵn sàng”), bạn đăng thủ công. Tự đăng sắp ra mắt.','Caption ngắn kèm hashtag theo nhãn và nhóm hàng.'],
  tiktok:['Hiện tạo sẵn kịch bản video 15 giây (trạng thái “Nội dung sẵn sàng”), bạn tự quay và đăng. Tự đăng sắp ra mắt.','Kịch bản theo từng cảnh: mở đầu, giới thiệu món, giá và giờ nhận, kêu gọi.'],
  zalo:['Hiện tạo sẵn tin nhắn ngắn cho nhóm khách quen (trạng thái “Nội dung sẵn sàng”), bạn gửi thủ công. Tự gửi sắp ra mắt.']
};
function mktConnPick(k){MKT.connSel=k;R();}
function mktConnect(s){
  s=s||{};
  const cur=MKT_PLAT.find(p=>p.k===MKT.connSel)||MKT_PLAT[0],ch=mktCh(cur.k);
  const cards=MKT_PLAT.map(p=>{const c=mktCh(p.k),st=c.enabled?['Đang dùng','tg-g']:c.connected?['Đã tắt','tg-y']:['Chưa điền','tg-o'];
    return '<div class="mx-pl'+(p.k===cur.k?' sel':'')+'" onclick="mktConnPick(\''+p.k+'\')"><div class="mx-pl-h"><span class="mk-pic" style="background:'+p.c+'"><i class="ti '+p.i+'"></i></span><div class="f1" style="min-width:0"><b>'+mktEsc(p.n)+'</b><small>'+mktEsc(p.d)+'</small></div></div>'+
      '<div class="mx-pl-f"><span class="tg '+st[1]+'">'+st[0]+'</span><button type="button" class="mk-sw sm" role="switch" aria-checked="'+(c.enabled?'true':'false')+'" aria-label="Dùng kênh này" '+(c.connected?'':'disabled title="Hãy điền thông tin bắt buộc và lưu trước" ')+'onclick="event.stopPropagation();mktToggleChannel(\''+p.k+'\')"><i></i></button></div></div>';}).join('');
  const fields='<div class="mk-form">'+(MKT_FIELDS[cur.k]||[]).map(f=>'<div class="field" style="margin:0"><label>'+f[1]+(f[3]?' <span style="color:var(--red)">*</span>':'')+'</label><input id="mkc-'+cur.k+'-'+f[0]+'" class="inp" value="'+mktEsc((ch.info&&ch.info[f[0]])||'')+'" placeholder="'+mktEsc(f[2])+'"></div>').join('')+'</div>';
  const hint=cur.k==='facebook'?'Token truy cập Fanpage không nhập ở đây, chỉ cấu hình trong n8n để bảo mật.':'Tự đăng cho kênh này: sắp ra mắt. Hiện hệ thống tạo sẵn nội dung và poster để bạn đăng.';
  return mktAutoCard(s)+
    '<div class="mk-conn" style="margin:0 0 14px"><span class="mk-dot '+(s.n8n_configured?'ok':'warn')+'"></span>'+(s.n8n_configured?'Đã kết nối n8n':(s.fallback_configured?'Chưa kết nối n8n · đang dùng đăng trực tiếp dự phòng':'Chưa kết nối n8n (cần cấu hình N8N_WEBHOOK_URL)'))+'</div>'+
    '<div class="st" style="margin:6px 0 10px"><i class="ti ti-apps"></i> Chọn nền tảng đăng bài<span class="mk-hint">'+MKT_PLAT.filter(p=>mktCh(p.k).enabled).length+' / '+MKT_PLAT.length+' đang dùng</span></div>'+
    '<div class="mx-plats">'+cards+'</div>'+(s.error?'<div class="card m14" style="color:var(--red);font-weight:700;font-size:12.5px">'+mktEsc(s.error)+'</div>':'')+
    '<div class="mx-2col" style="align-items:start"><div class="card"><div class="f ac g10 m12" style="flex-wrap:wrap"><span class="mk-pic" style="background:'+cur.c+'"><i class="ti '+cur.i+'"></i></span><div class="f1" style="min-width:0"><b style="font-size:15px">Kết nối '+mktEsc(cur.n)+'</b><small style="display:block;color:var(--muted);font-weight:600;font-size:12px">Trường có dấu <span style="color:var(--red)">*</span> là bắt buộc</small></div></div>'+
      fields+'<div class="mk-hintline"><i class="ti ti-info-circle"></i> '+hint+'</div><button class="btn btn-primary" style="margin-top:14px" onclick="mktSaveConn(\''+cur.k+'\')"><i class="ti ti-device-floppy"></i> Lưu thông tin '+mktEsc(cur.n)+'</button></div>'+
    '<div class="card"><div class="st"><i class="ti ti-list-check"></i> Cách '+mktEsc(cur.n)+' hoạt động</div>'+(MKT_BEHAVIOR[cur.k]||[]).map(t=>'<div class="mx-bh"><i class="ti ti-circle-check-filled"></i><span>'+t+'</span></div>').join('')+'</div></div>';
}
