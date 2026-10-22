// ═══════════ AI AGENT ĐĂNG BÀI (Admin) · v2: gọn, mở là hiện ngay ═══════════
// Chỉ đăng bài TỔNG HỢP của FoodSave (Fanpage trung tâm). Không đăng thay từng cửa hàng:
// mỗi cửa hàng tự quản lý Fanpage / Auto-bot ở trang Đối tác. Dữ liệu lấy từ API /marketing/admin/*.
// Cách chạy nhanh: tải dữ liệu sẵn ngay khi đăng nhập, nhớ bản lần trước (localStorage) để hiện liền,
// cập nhật ngầm rồi vẽ lại tại chỗ (không nhấp nháy, không chặn người dùng).
const AG_CK='fs_ag_ov_v2';
const AG={tab:'ov',data:null,at:0,loading:false,err:'',pick:[],pickInit:false,prev:null,prevBusy:false,prevSeq:0,plat:'fb',hf:{q:'',lb:'',st:''},csvP:'week',runBusy:false,timer:null};
function agCacheLoad(){try{const s=JSON.parse(localStorage.getItem(AG_CK)||'null');if(s&&s.d&&Array.isArray(s.d.queue)&&s.d.kpi)return s;}catch(e){}return null;}
function agCacheSave(d){try{localStorage.setItem(AG_CK,JSON.stringify({t:Date.now(),d:d}));}catch(e){}}
function agBadgeSet(){const b=document.getElementById('agBadge');if(b&&AG.data)b.textContent=AG.data.queue.filter(q=>!q.recently_posted).length||'';}
(function(){const s=agCacheLoad();if(s){AG.data=s.d;AG.at=s.t;agBadgeSet();}})();

// ───── Vẽ lại tại chỗ (không dựng lại cả trang)
function agTyping(){const a=document.activeElement,r=document.getElementById('agRoot');return !!(a&&r&&r.contains(a)&&((a.tagName==='INPUT'&&/^(text|search|number)$/.test(a.type))||a.tagName==='SELECT'||a.tagName==='TEXTAREA'));}
function agPaint(force){const r=document.getElementById('agRoot');if(!r||currentPage!=='agent')return;if(!force&&agTyping())return;r.innerHTML=agView();}
function agPaintPrev(){const el=document.getElementById('agPrev');if(el&&AG.data)el.innerHTML=agPreviewHtml(AG.data);}
const agClock=t=>new Date(t).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'});

async function agLoad(silent){
  if(AG.loading)return;
  AG.loading=true;if(!silent){AG.err='';agPaint(true);}
  try{
    const d=await agApi('/admin/overview');
    AG.data=d;AG.err='';AG.at=Date.now();agCacheSave(d);
    if(!AG.pickInit){AG.pick=d.queue.filter(q=>!q.recently_posted).slice(0,3).map(q=>q.product_id);AG.pickInit=true;}
    AG.pick=AG.pick.filter(id=>d.queue.some(q=>q.product_id===id));
    agBadgeSet();
  }catch(e){AG.err=e.message||String(e);}
  AG.loading=false;
  agPaint();
  // chuẩn bị sẵn bản xem trước để mở tab "Hàng chờ đăng" là có ngay
  if(AG.data&&AG.pick.length&&!AG.prev&&!AG.prevBusy)agPreview();
}
function agStartTimer(){if(AG.timer)return;AG.timer=setInterval(()=>{if(currentPage==='agent'&&!document.hidden)agLoad(true);},60000);}

// ───── Trang: có dữ liệu nhớ sẵn thì hiện ngay, cập nhật ngầm phía sau
pg.agent=()=>{
  agStartTimer();
  if(!AG.loading&&(!AG.data||Date.now()-AG.at>20000))agLoad(true);
  return '<div id="agRoot">'+agView()+'</div>';
};
function agTab(t){AG.tab=t;agPaint(true);window.scrollTo(0,0);}
function agSelPl(id){AG.plat=id;agPaint(true);}

function agView(){
  const d=AG.data;
  const tabs=[['ov','Tổng quan'],['q','Hàng chờ đăng'+(d?' <em>'+d.queue.filter(q=>!q.recently_posted).length+'</em>':'')],['h','Lịch sử'],['c','Thiết lập đăng bài']];
  const state=!d?'':!d.auto_enabled?B('b-m','Đã tạm dừng'):d.mode==='none'?B('b-w','Chưa cấu hình'):B('b-ok','<span class="ag-dot"></span>Đang chạy');
  const sync='<span class="ag-sync">'+(AG.loading?'Đang cập nhật…':AG.at?'Cập nhật '+agClock(AG.at):'')+'</span>';
  const top='<div class="ag-top"><div class="ag-tabs">'+tabs.map(t=>'<div class="ag-tab'+(AG.tab===t[0]?' on':'')+'" onclick="agTab(\''+t[0]+'\')">'+t[1]+'</div>').join('')+'</div>'+
    '<div class="ag-top-r">'+state+sync+'<button class="bt" onclick="agLoad()">Làm mới</button><button class="bt bt-p" onclick="agOpenRun()">Chạy thử ngay</button></div></div>';
  let body;
  if(!d)body=AG.err?'<div class="al al-w">'+agE(AG.err)+'<br><button class="bt bt-s" style="margin-top:8px" onclick="agLoad()">Thử lại</button></div>':agSkeleton();
  else body=(AG.err?'<div class="al al-w">'+agE(AG.err)+'</div>':'')+(AG.tab==='q'?agQueue(d):AG.tab==='h'?agHistory(d):AG.tab==='c'?agSettings(d):agOverview(d));
  return top+body;
}
function agSkeleton(){
  const k='<div class="K"><div class="ag-sk" style="height:10px;width:60%"></div><div class="ag-sk" style="height:26px;width:40%;margin-top:12px"></div><div class="ag-sk" style="height:8px;width:75%;margin-top:12px"></div></div>';
  const blk=h=>'<div class="P"><div class="P-b"><div class="ag-sk" style="height:'+h+'px"></div></div></div>';
  return '<div class="G G4">'+k+k+k+k+'</div>'+blk(64)+'<div class="ag-stats">'+blk(180)+blk(180)+'</div>';
}

// ───── Tab 1: Tổng quan (gọn: 4 số chính, Auto-bot, thống kê, hoạt động)
function agOverview(d){
  const k=d.kpi,i=d.integrations,wait=d.queue.filter(q=>!q.recently_posted),red=wait.filter(q=>q.label==='red').length;
  const rate=k.success_rate==null?'—':k.success_rate+'%';
  const chip=(c,t)=>'<span class="ag-chip '+c+'"><i></i>'+t+'</span>';
  const chips=chip(d.central.id?'ok':'w',d.central.id?'Fanpage '+agE(d.central.name):'Chưa có Fanpage')+chip(i.n8n_configured?'ok':'e',i.n8n_configured?'n8n kết nối':'Chưa cấu hình n8n')+chip(i.ai_enabled?'ok':'',i.ai_enabled?'Gemini AI bật':'AI tắt, dùng caption mẫu');
  const mx=Math.max(1,...d.days.map(x=>x.red+x.yellow));
  const bars=d.days.map(x=>{const tot=x.red+x.yellow,h=Math.round(tot/mx*118);return '<div class="ag-bar"><b style="font-size:.7rem">'+tot+'</b><div class="ag-stack" style="height:'+h+'px"><s style="flex:'+x.red+';background:#D94E45"></s><s style="flex:'+x.yellow+';background:#E3A82B"></s></div><small>'+agE(x.label)+'</small></div>';}).join('');
  const tiers=[['AI viết',k.ai_7d||0,'#1C7C45'],['Caption mẫu',k.template_7d||0,'#E3A82B'],['Đăng trực tiếp',k.direct_7d||0,'#8A948C']];
  const tt=tiers.reduce((s,x)=>s+x[1],0);let acc=0;
  const stops=tt?tiers.map(x=>{const a=acc/tt*100;acc+=x[1];return x[2]+' '+a+'% '+(acc/tt*100)+'%';}).join(','):'#E6ECE6 0% 100%';
  const events=d.posts.slice(0,6).map(p=>{const cls=p.status==='failed'?'e':(p.tier==='template'||p.tier==='direct')?'w':'';const how=p.tier==='ai'?'AI viết':p.tier==='template'?'Caption mẫu':p.tier==='direct'?'Đăng trực tiếp':'';
    return '<div class="ag-ev '+cls+'">'+(p.status==='failed'?'Đăng bài '+agDesc(p)+' bị lỗi'+(p.error?': '+agE(p.error):''):'Đã đăng bài '+agDesc(p)+' lên '+agE(d.central.name))+'<small>'+agE(agWhen(p.created_at))+(how?' · '+how:'')+'</small></div>';}).join('');
  return '<div class="G G4">'+
    '<div class="K"><div class="K-l">Hàng chờ đăng</div><div class="K-v">'+wait.length+'</div><div class="K-n">'+red+' nhãn đỏ · '+(wait.length-red)+' nhãn vàng</div></div>'+
    '<div class="K"><div class="K-l">Bài đăng 7 ngày qua</div><div class="K-v">'+(k.tried_7d||0)+'</div><div class="K-n">'+(k.failed_7d?k.failed_7d+' bài lỗi':'không có bài lỗi')+'</div></div>'+
    '<div class="K"><div class="K-l">Bài đăng hôm nay</div><div class="K-v">'+(k.today||0)+'</div><div class="K-n">tối đa '+d.limits.per_day+' bài mỗi ngày</div></div>'+
    '<div class="K"><div class="K-l">Đăng thành công 7 ngày</div><div class="K-v">'+rate+'</div><div class="K-n">'+(k.ok_7d||0)+' / '+(k.tried_7d||0)+' bài lên Fanpage</div></div></div>'+
  '<div class="P"><div class="ag-master"><div><h3>Auto-bot tự đăng bài</h3><p>Hàng nhãn vàng/đỏ của mọi cửa hàng được gom thành bài tổng hợp và đăng lên Fanpage '+agE(d.central.name||'FoodSave')+'.</p><div class="ag-chips">'+chips+'</div></div>'+
    '<label class="ag-sw"><input type="checkbox" '+(d.auto_enabled?'checked':'')+' onchange="agSetting(\'auto_enabled\',this.checked)"><i></i></label></div></div>'+
  '<div class="ag-stats"><div class="P"><div class="P-h"><div class="P-t">Món đưa vào bài<small>7 ngày qua, theo nhãn</small></div></div><div class="P-b"><div class="ag-bars">'+bars+'</div><div class="ag-leg"><span><i style="background:#D94E45"></i>Nhãn đỏ</span><span><i style="background:#E3A82B"></i>Nhãn vàng</span></div></div></div>'+
    '<div class="P"><div class="P-h"><div class="P-t">Cách đăng<small>7 ngày qua</small></div></div><div class="P-b"><div class="ag-don"><div class="ag-donut" style="background:conic-gradient('+stops+')"><i><b>'+tt+'</b><small>bài</small></i></div><div class="ag-dl">'+
      tiers.map(x=>'<div><span><i style="background:'+x[2]+'"></i>'+x[0]+'</span><b>'+x[1]+'</b></div>').join('')+'</div></div></div></div></div>'+
  '<div class="P"><div class="P-h"><div class="P-t">Lịch sử hoạt động</div><div class="P-a"><button class="bt bt-s" onclick="agTab(\'h\')">Xem tất cả</button></div></div><div class="P-b">'+(events?'<div class="ag-tl">'+events+'</div>':'<div class="ag-empty">Chưa có bài tổng hợp nào được đăng.</div>')+'</div></div>';
}

// ───── Tab 2: Hàng chờ đăng + xem trước (chọn tối đa 3 món)
function agQueue(d){
  const rows=d.queue.map(q=>{const on=AG.pick.includes(q.product_id);
    return '<tr class="'+(on?'ag-on':'')+'" onclick="agToggle(\''+q.product_id+'\')"><td style="width:34px"><input type="checkbox" '+(on?'checked':'')+' onclick="event.stopPropagation();agToggle(\''+q.product_id+'\')"></td><td><b>'+agE(q.emoji||'')+' '+agE(q.name)+'</b>'+(q.recently_posted?' <span class="b b-m">Vừa đăng</span>':'')+'<small class="ag-sub">'+agE(q.store_name)+'</small></td><td>'+agLb(q.label)+'</td><td>'+agE(agLeft(q.hours_left))+'</td><td>'+agMoney(q.price_vnd)+'</td></tr>';}).join('');
  return '<div class="ag-split"><div class="P"><div class="P-h"><div class="P-t">Hàng chờ đăng<small>chọn tối đa 3 món cho một bài</small></div><div class="P-a"><button class="bt bt-s" onclick="agPickTop()">Chọn theo ưu tiên</button></div></div>'+
    (d.queue.length?'<div class="W"><table><thead><tr><th></th><th>Sản phẩm</th><th>Nhãn</th><th>Còn lại</th><th>Giá</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<div class="ag-empty">Chưa có hàng nhãn đỏ/vàng nào còn bán.</div>')+'</div>'+
    '<div class="ag-prev"><div class="P"><div class="P-h"><div class="P-t">Xem trước bài<small>'+agE(d.central.name)+'</small></div></div><div class="P-b" id="agPrev">'+agPreviewHtml(d)+'</div></div></div></div>';
}
function agToggle(id){const i=AG.pick.indexOf(id);if(i>=0)AG.pick.splice(i,1);else{if(AG.pick.length>=3){agToast('Mỗi bài tổng hợp gom tối đa 3 món');return;}AG.pick.push(id);}agPaint(true);agPreview();}
function agPickTop(){AG.pick=AG.data.queue.filter(q=>!q.recently_posted).slice(0,3).map(q=>q.product_id);agPaint(true);agPreview();}
async function agPreview(){
  const d=AG.data;if(!d)return;
  if(!AG.pick.length){AG.prevSeq++;AG.prev={empty:true};AG.prevBusy=false;agPaintPrev();return;}
  const my=++AG.prevSeq;AG.prevBusy=true;agPaintPrev();
  let r;try{r=await agApi('/admin/preview',{method:'POST',body:{product_ids:AG.pick}});}catch(e){r={error:e.message};}
  if(my!==AG.prevSeq)return;
  AG.prev=r;AG.prevBusy=false;agPaintPrev();
}
function agPrevSk(){return '<div class="ag-sk" style="height:12px;width:55%"></div><div class="ag-sk" style="height:10px;width:92%;margin-top:12px"></div><div class="ag-sk" style="height:10px;width:80%;margin-top:8px"></div><div class="ag-sk" style="aspect-ratio:1/1;margin-top:14px;border-radius:12px"></div>';}
function agPreviewHtml(d){
  const p=AG.prev;
  if(!AG.pick.length||(p&&p.empty))return '<div class="ag-empty">Chọn ít nhất 1 món ở bảng bên trái để xem bài.</div>';
  if(p&&p.error&&!AG.prevBusy)return '<div class="al al-w">'+agE(p.error)+'</div>';
  if(!p||p.error)return agPrevSk();
  return '<div class="'+(AG.prevBusy?'ag-dim':'')+'"><div class="ag-fb"><div class="ag-fb-h"><div class="ag-av">FS</div><div><b>'+agE(d.central.name)+'</b><small>Vừa xong · 🌐</small></div></div><div class="ag-cap">'+agE(p.message)+'</div>'+agPosterHtml(p)+'<div class="ag-acts"><span>👍 Thích</span><span>💬 Bình luận</span><span>↗ Chia sẻ</span></div></div></div>'+
    '<div class="ag-note">Bản mẫu của hệ thống. Khi AI bật, Gemini viết lại caption nhưng giữ nguyên giá, giờ và tên cửa hàng.</div>'+
    '<div style="display:flex;gap:8px;margin-top:12px"><button class="bt bt-p" onclick="agRunSelected()" '+(AG.runBusy||AG.prevBusy?'disabled':'')+'>Đăng bài này</button></div>';
}

// ───── Tab 3: Lịch sử
function agHistRows(d){
  const f=AG.hf,q=(f.q||'').toLowerCase();
  return d.posts.filter(p=>(!q||((p.items||[]).map(i=>i.name+' '+i.store_name).join(' ')+' '+(p.content||'')).toLowerCase().includes(q))&&(!f.lb||(f.lb==='red'?p.labels&&p.labels.red:p.labels&&p.labels.yellow))&&(!f.st||(f.st==='ok'?(p.status==='sent'||p.status==='posted'):p.status===f.st)));
}
function agHistBody(d){
  const rows=agHistRows(d);
  if(!rows.length)return '<tr><td colspan="5" style="text-align:center;color:var(--t3);padding:24px">'+(d.posts.length?'Không có bài nào phù hợp bộ lọc':'Chưa có bài tổng hợp nào')+'</td></tr>';
  return rows.map(p=>'<tr onclick="agOpenPost(\''+p.id+'\')"><td>'+agE(agWhen(p.created_at))+'</td><td><b>'+agE(agDesc(p))+'</b><small class="ag-sub">'+agStores(p).length+' cửa hàng</small></td><td>'+agMixLabel(p)+'</td><td>'+agTier(p.tier)+'</td><td>'+agSt(p.status)+'</td></tr>').join('');
}
function agHF(k,v){AG.hf[k]=v;const b=document.getElementById('agHBody');if(b)b.innerHTML=agHistBody(AG.data);const c=document.getElementById('agHCount');if(c)c.textContent=agHistRows(AG.data).length+' bài';}
function agHistory(d){
  const f=AG.hf,o=(v,t,c)=>'<option value="'+v+'"'+(c===v?' selected':'')+'>'+t+'</option>';
  const per=[['today','Hôm nay'],['week','Tuần này'],['month','Tháng này'],['quarter','Quý này'],['year','Năm nay'],['all','Tất cả']];
  return '<div class="P"><div class="P-h"><div class="ag-f"><input placeholder="Tìm món, cửa hàng…" value="'+agE(f.q)+'" oninput="agHF(\'q\',this.value)" style="min-width:200px">'+
    '<select onchange="agHF(\'lb\',this.value)">'+o('','Mọi nhãn',f.lb)+o('red','Có hàng đỏ',f.lb)+o('yellow','Có hàng vàng',f.lb)+'</select>'+
    '<select onchange="agHF(\'st\',this.value)">'+o('','Mọi trạng thái',f.st)+o('ok','Đã đăng',f.st)+o('failed','Lỗi',f.st)+o('queued','Đang xử lý',f.st)+'</select></div>'+
    '<div class="P-a"><span style="font-size:.72rem;color:var(--t3)" id="agHCount">'+agHistRows(d).length+' bài</span><select class="ag-sel" onchange="AG.csvP=this.value">'+per.map(x=>o(x[0],x[1],AG.csvP)).join('')+'</select><button class="bt" onclick="agExportCsv()">⬇ Xuất CSV</button></div></div>'+
    '<div class="W"><table><thead><tr><th>Thời gian</th><th>Nội dung bài</th><th>Nhãn</th><th>Cách đăng</th><th>Trạng thái</th></tr></thead><tbody id="agHBody">'+agHistBody(d)+'</tbody></table></div></div>';
}
function agInPeriod(iso,p){
  if(p==='all')return true;const d=new Date(iso);if(isNaN(d))return false;const n=new Date();
  if(p==='today')return d.toDateString()===n.toDateString();
  if(p==='week'){const s=new Date(n.getFullYear(),n.getMonth(),n.getDate()-((n.getDay()+6)%7));return d>=s;}
  if(p==='month')return d.getFullYear()===n.getFullYear()&&d.getMonth()===n.getMonth();
  if(p==='quarter')return d.getFullYear()===n.getFullYear()&&Math.floor(d.getMonth()/3)===Math.floor(n.getMonth()/3);
  if(p==='year')return d.getFullYear()===n.getFullYear();
  return true;
}
function agExportCsv(){
  const list=agHistRows(AG.data).filter(p=>agInPeriod(p.created_at,AG.csvP));
  const tier=t=>t==='ai'?'AI viết':t==='template'?'Caption mẫu':t==='direct'?'Đăng trực tiếp':'';
  const lab=p=>(p.labels&&p.labels.red?'Đỏ':'')+(p.labels&&p.labels.red&&p.labels.yellow?' + ':'')+(p.labels&&p.labels.yellow?'Vàng':'');
  const rows=[['Thời gian','Nội dung','Cửa hàng có hàng','Nhãn','Cách đăng','Trạng thái','Link bài']].concat(list.map(p=>[new Date(p.created_at).toLocaleString('vi-VN'),agDesc(p),agStores(p).join('; '),lab(p),tier(p.tier),p.status==='failed'?'Lỗi':(p.status==='sent'||p.status==='posted')?'Đã đăng':'Đang xử lý',p.external_url||'']));
  const csv='﻿'+rows.map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\r\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='lich-su-ai-agent.csv';a.click();agToast('Đã xuất '+list.length+' bài ra file CSV');
}

// ───── Tab 4: Thiết lập đăng bài
function agSettings(d){
  const i=d.integrations,cur=AG_PLATS.find(p=>p.id===AG.plat)||AG_PLATS[0];
  const cards=AG_PLATS.map(p=>'<div class="ag-pl'+(p.id===cur.id?' sel':'')+'" onclick="agSelPl(\''+p.id+'\')"><div class="ag-pl-h"><div class="ag-lg" style="background:'+p.c+'">'+p.l+'</div><div><b>'+p.n+'</b><small><span class="b '+(p.real&&d.auto_enabled?'b-ok':'b-m')+'" style="margin-top:3px">'+(p.real?(d.auto_enabled?'Đăng tự động':'Đã tạm dừng'):'Nội dung sẵn sàng')+'</span></small></div></div></div>').join('');
  const row=(t,sub,ok,txt)=>'<div class="ag-row"><div class="grow"><b>'+t+'</b><small>'+sub+'</small></div><span class="b '+(ok===true?'b-ok':ok===false?'b-e':'b-m')+'">'+(ok===true?'<span class="ag-dot"></span>':'')+txt+'</span></div>';
  let pane;
  if(cur.id==='fb'){
    pane='<div class="G G2" style="align-items:start"><div class="P"><div class="P-h"><div class="P-t">Kết nối Facebook</div></div><div class="P-b">'+
        row('Fanpage trung tâm',agE(d.central.name)+(d.central.id?' · Page ID '+agE(d.central.id):''),Boolean(d.central.id),d.central.id?'Đã cấu hình':'Thiếu')+
        row('n8n','Webhook nhận lệnh đăng bài',i.n8n_configured,i.n8n_configured?'Đã cấu hình':'Chưa cấu hình')+
        row('Token đăng trực tiếp','Dự phòng khi n8n không gọi được (chỉ hiện có/không)',i.direct_fallback,i.direct_fallback?'Có':'Chưa có')+
        '<div class="ag-opt"><div><b>Gemini AI viết caption và tạo ảnh</b><small>Key nằm trong n8n, không hiển thị ở đây</small></div><label class="ag-sw"><input type="checkbox" '+(i.ai_enabled?'checked':'')+' onchange="agSetting(\'ai_enabled\',this.checked)"><i></i></label></div></div></div>'+
      '<div class="P"><div class="P-h"><div class="P-t">Cách hoạt động</div></div><div class="P-b">'+
        ['Gom tối đa 3 món nhãn đỏ/vàng từ nhiều cửa hàng vào một bài; nhãn đỏ và món sắp hết hạn được ưu tiên.','Poster liệt kê món, cửa hàng bán, % giảm, giờ còn lại. AI chỉ tạo hình nền; giá và giờ nhận luôn do hệ thống chèn.','AI lỗi hoặc quá 20 giây thì tự chuyển sang caption mẫu, rồi đăng trực tiếp nếu n8n không gọi được.'].map(x=>'<div class="ag-bh">'+x+'</div>').join('')+
        '<div class="ag-note">Giới hạn: tối đa '+d.limits.per_run+' bài mỗi lượt, '+d.limits.per_day+' bài mỗi ngày (cố định để tránh spam).</div></div></div></div>';
  }else{
    const t={ig:['Instagram','Tạo sẵn nội dung và poster để đăng thủ công trên Instagram của FoodSave.'],tt:['TikTok','Tạo sẵn kịch bản video ngắn để quay và đăng thủ công.'],zl:['Zalo OA','Tạo sẵn nội dung tin broadcast để gửi thủ công qua Zalo OA.']}[cur.id]||[cur.n,'Tạo sẵn nội dung để đăng thủ công.'];
    pane='<div class="P"><div class="P-h"><div class="P-t">'+t[0]+'</div></div><div class="P-b"><div class="ag-bh">'+t[1]+'</div><div class="ag-note">Hiện chỉ Facebook đăng tự động. Tự đăng cho nền tảng này: sắp ra mắt.</div></div></div>';
  }
  return '<div class="ag-plats">'+cards+'</div>'+pane;
}
