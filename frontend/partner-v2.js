
/* ═════════ FOODSAVE PARTNER · UI v2 ═════════
   Lớp giao diện mới đặt SAU mã cũ: ghi đè các hàm vẽ trang, giữ nguyên các hàm nghiệp vụ (API, đăng nhập, live-data).
   ?demo=1  → vào thẳng cổng cửa hàng với dữ liệu mẫu (không cần đăng nhập, không gọi API ghi).
   Chế độ thường: Tổng quan, Đơn hàng, Chi tiết đơn, Nhận hàng · QR và Chat dùng dữ liệu thật từ Backend.
   Ví (Đợt 2), Khiếu nại (Đợt 3), Khách hàng và Khuyến mãi (Đợt 4b) là dữ liệu thật; Nhận hàng · QR có thêm quét camera. Dữ liệu mẫu chỉ hiện ở ?demo=1.        */
(function(){
'use strict';
var DEMO=/[?&]demo=1/.test(location.search);
var NOW=Date.now(), MIN=60000, HOUR=3600000;
document.body.classList.add('v2-on');

/* ---------- tiện ích ---------- */
var $=function(s,r){return (r||document).querySelector(s)};
var money=function(n){return Number(n||0).toLocaleString('vi-VN')+'đ'};
var short=function(n){n=Number(n||0);return n>=1e6?(n/1e6).toFixed(n>=1e7?1:2).replace('.',',')+'tr':n>=1e3?Math.round(n/1e3)+'K':String(n)};
var esc=function(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})};
var sample=function(t){return DEMO?'<span class="v2-tag">Mẫu</span>':''};
function fmtCd(ms){var s=Math.max(0,Math.floor(ms/1000));var h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;
  return (h?h+':':'')+String(m).padStart(2,'0')+':'+String(x).padStart(2,'0')}
function cd(ts,label,warnMin,badMin){
  if(!ts)return '';
  return '<span class="v2-cd" data-cd="'+ts+'" data-w="'+(warnMin||30)+'" data-b="'+(badMin||10)+'"><i class="ti ti-clock"></i>'+(label?esc(label)+' ':'')+'<span class="t">--:--</span></span>';
}
function tickCd(){
  document.querySelectorAll('[data-cd]').forEach(function(el){
    var left=Number(el.dataset.cd)-Date.now(),t=el.querySelector('.t');
    if(left<=0){el.className='v2-cd off';if(t)t.textContent='Đã hết hạn';return;}
    var w=Number(el.dataset.w)*MIN,b=Number(el.dataset.b)*MIN;
    el.className='v2-cd '+(left<=b?'bad':left<=w?'warn':'ok');
    if(t)t.textContent=fmtCd(left);
  });
}
setInterval(tickCd,1000);

/* ---------- trạng thái đơn mới (theo luồng trả trước) ---------- */
try{
  stM.awaiting_payment='Chờ thanh toán';stC.awaiting_payment='tg-y';
  stM.no_show='Vắng mặt';stC.no_show='tg-r';
}catch(e){}

/* ---------- dữ liệu mẫu ---------- */
function seed(){
  var mk=function(o){return Object.assign({subtotal:o.p,discount:0,fee:2000,donation:0,note:'',voucher:'',email:'',accountName:o.c,rating:null,cancelReason:'',createdIso:new Date(NOW-20*MIN).toISOString(),payLabel:'MoMo'},o)};
  var L=function(n,q,p,e){return{name:n,qty:q,price:p,emoji:e||'🍞'}};
  ORD.length=0;
  [
   mk({id:'FS2401',uuid:'d1',st:'new',l:'red',items:'Bánh mì ngọt × 3',lines:[L('Bánh mì ngọt',3,11667)],c:'Nguyễn Minh T.',ph:'0912 345 678',slot:'17:30–18:00',mt:'MoMo · Nhận 17:30–18:00',time:'17:41 · 28/10',p:35000,pay:'Đã thanh toán',code:'FS-2401',paidAt:NOW-3*MIN,pickupDeadline:NOW+55*MIN}),
   mk({id:'FS2402',uuid:'d2',st:'confirmed',l:'yellow',items:'Cơm gà xối mỡ × 2',lines:[L('Cơm gà xối mỡ',2,35000,'🍗')],c:'Lê Văn H.',ph:'0933 222 111',slot:'18:00–18:30',mt:'MoMo · Nhận 18:00–18:30',time:'17:20 · 28/10',p:70000,pay:'Đã thanh toán',code:'FS-2402',paidAt:NOW-25*MIN,pickupDeadline:NOW+65*MIN}),
   mk({id:'FS2403',uuid:'d3',st:'ready',l:'red',items:'Sushi combo × 1',lines:[L('Sushi combo',1,55000,'🍣')],c:'Trần Thu H.',ph:'0977 123 456',slot:'17:30–18:00',mt:'VNPay · Nhận 17:30–18:00',time:'17:05 · 28/10',p:55000,pay:'Đã thanh toán',code:'FS-2403',paidAt:NOW-40*MIN,pickupDeadline:NOW+12*MIN}),
   mk({id:'FS2404',uuid:'d4',st:'awaiting_payment',l:'yellow',items:'Sandwich × 4',lines:[L('Sandwich',4,15000,'🥪')],c:'Phạm Anh Q.',ph:'0905 888 999',slot:'18:30–19:00',mt:'MoMo · Chờ thanh toán',time:'17:44 · 28/10',p:60000,pay:'Chưa thanh toán',code:'FS-2404',payDeadline:NOW+6*MIN}),
   mk({id:'FS2405',uuid:'d5',st:'done',l:'green',items:'Croissant × 2',lines:[L('Croissant',2,16000,'🥐')],c:'Hoàng Gia B.',ph:'0988 111 222',slot:'16:00–16:30',mt:'MoMo · Nhận 16:00–16:30',time:'15:52 · 28/10',p:32000,pay:'Đã thanh toán',code:'FS-2405',rating:5}),
   mk({id:'FS2406',uuid:'d6',st:'done',l:'yellow',items:'Bánh su kem × 6',lines:[L('Bánh su kem',6,9500,'🧁')],c:'Đỗ Thảo V.',ph:'0966 555 444',slot:'15:00–15:30',mt:'ZaloPay · Nhận 15:00–15:30',time:'14:30 · 28/10',p:57000,pay:'Đã thanh toán',code:'FS-2406',rating:4}),
   mk({id:'FS2407',uuid:'d7',st:'no_show',l:'red',items:'Bánh mì thịt × 2',lines:[L('Bánh mì thịt',2,12500)],c:'Vũ Hải N.',ph:'0944 777 000',slot:'14:00–14:30',mt:'MoMo · Quá hạn nhận',time:'12:10 · 28/10',p:25000,pay:'Đã thanh toán',code:'FS-2407',cancelReason:'Khách không đến trong hạn lấy hàng'}),
   mk({id:'FS2408',uuid:'d8',st:'cancelled',l:'green',items:'Bánh flan × 3',lines:[L('Bánh flan',3,8000,'🍮')],c:'Ngô Mai A.',ph:'0933 666 777',slot:'13:00–13:30',mt:'MoMo · Khách hủy sớm',time:'11:20 · 28/10',p:24000,pay:'Đã hoàn tiền',code:'FS-2408',cancelReason:'Khách hủy trong thời gian miễn phí · hoàn 100%'})
  ].forEach(function(o){ORD.push(o)});
  PRD=[
   {id:1,n:'Croissant bơ',img:'🥐',cat:'Bánh ngọt',sku:'CR-001',mfg:'28/10 05:00',exp:'28/10 20:00',left:'1h 20p',leftMin:80,p:12000,po:30000,q:8,l:'red',serverLabel:true,sync:'ok'},
   {id:2,n:'Bánh mì ngọt',img:'🍞',cat:'Bánh mì',sku:'BM-014',mfg:'28/10 05:30',exp:'28/10 21:00',left:'2h 05p',leftMin:125,p:11667,po:20000,q:12,l:'red',serverLabel:true,sync:'ok'},
   {id:3,n:'Sushi combo',img:'🍣',cat:'Đồ nấu chín',sku:'SU-120',mfg:'28/10 09:00',exp:'29/10 00:30',left:'5h 50p',leftMin:350,p:55000,po:110000,q:5,l:'yellow',serverLabel:true,sync:'ok'},
   {id:4,n:'Sandwich trứng',img:'🥪',cat:'Đồ ăn nhanh',sku:'SW-033',mfg:'28/10 08:00',exp:'29/10 06:00',left:'12h',leftMin:720,p:15000,po:30000,q:14,l:'yellow',serverLabel:true,sync:'ok'},
   {id:5,n:'Bánh su kem',img:'🧁',cat:'Bánh ngọt',sku:'SK-210',mfg:'27/10 18:00',exp:'31/10 18:00',left:'3 ngày',leftMin:4300,p:9500,po:12000,q:30,l:'green',serverLabel:true,sync:'ok'},
   {id:6,n:'Cơm gà xối mỡ',img:'🍗',cat:'Đồ nấu chín',sku:'CG-007',mfg:'28/10 11:00',exp:'28/10 21:30',left:'2h 35p',leftMin:155,p:35000,po:70000,q:6,l:'red',serverLabel:true,sync:'conflict'}
  ];
  COMPLAINTS.length=0;
  [
   {id:'KN-A1',code:'KN-A1',img:'🍣',user:'Trần Thu H.',product:'Sushi combo · FS2398',time:'Hôm nay 16:40',issue:'Cơm sushi bị khô, có mùi lạ khi mở hộp.',st:'open',priority:'high',respondBy:NOW+7*HOUR,photos:3,amount:55000,order:'FS2398',reason:'Chất lượng'},
   {id:'KN-A2',code:'KN-A2',img:'🍗',user:'Lê Văn H.',product:'Cơm gà xối mỡ · FS2391',time:'Hôm nay 12:15',issue:'Thiếu 1 phần nước mắm và rau đi kèm.',st:'open',priority:'medium',respondBy:NOW+1.5*HOUR,photos:1,amount:35000,order:'FS2391',reason:'Thiếu hàng'},
   {id:'KN-A3',code:'KN-A3',img:'🥐',user:'Đỗ Thảo V.',product:'Croissant · FS2377',time:'Hôm qua 18:00',issue:'Bánh bị bẹp, không đúng hình.',st:'in-review',priority:'low',respondBy:0,photos:2,amount:16000,order:'FS2377',reason:'Hình thức',resolution:'Cửa hàng không đồng ý – đã chuyển FoodSave quyết định.'},
   {id:'KN-A4',code:'KN-A4',img:'🍞',user:'Phạm Anh Q.',product:'Bánh mì ngọt · FS2350',time:'26/10',issue:'Bánh mì ngọt hơi nguội.',st:'resolved',priority:'low',respondBy:0,photos:1,amount:11667,order:'FS2350',reason:'Chất lượng',resolution:'Admin: hoàn 50% (6.000đ) và nhắc cửa hàng giữ nhiệt.'}
  ].forEach(function(c){COMPLAINTS.push(c)});
  VIOLATIONS.length=0;
  try{partnerStoreProfile=Object.assign({},currentPartnerStoreProfile(),{name:'ABC Bakery',id:'FS-1833',address:'12 Nguyễn Trãi, Q.1, TP.HCM'});window.partnerStoreProfile=partnerStoreProfile}catch(e){}
}

/* ---------- số liệu mẫu cho phần chưa có API (ví, uy tín, doanh thu 7 ngày) ---------- */
var WAL={avail:4850000,escrow:310000,pendingW:1200000,withdrawn:3500000,bank:'Vietcombank ••••6789',
  tx:[
   {t:'Doanh thu đơn',o:'FS2405',a:30000,s:'Đã vào ví',d:'15:52',k:'in'},
   {t:'Doanh thu đơn',o:'FS2406',a:55000,s:'Đã vào ví',d:'15:00',k:'in'},
   {t:'Giữ chờ (escrow)',o:'FS2403',a:53000,s:'Chờ nhận hàng',d:'17:05',k:'hold'},
   {t:'Không đến nhận – chuyển cửa hàng',o:'FS2407',a:23000,s:'Đã vào ví',d:'14:35',k:'in'},
   {t:'Phí nền tảng 2.000đ/đơn',o:'FS2407',a:-2000,s:'Đã trừ',d:'14:35',k:'out'},
   {t:'Hoàn tiền khiếu nại',o:'FS2350',a:-6000,s:'Admin quyết định',d:'26/10',k:'out'},
   {t:'Rút về Vietcombank ••••6789',o:'RT-0042',a:-1200000,s:'Chờ duyệt',d:'27/10',k:'out'}
  ]};
var REP={score:92,tier:'Vàng',onTime:96,complaint:1.2,streak:'6 ngày không vi phạm'};
var WEEK=[['T2',2.1],['T3',2.9],['T4',2.4],['T5',3.6],['T6',3.3],['T7',4.6],['CN',4.1]];

/* ---------- trang: TỔNG QUAN ---------- */
function greet(){var h=new Date().getHours();return h<11?'Chào buổi sáng':h<18?'Chào buổi chiều':'Chào buổi tối'}
function storeName(){try{return currentPartnerStoreProfile().name||'Cửa hàng của bạn'}catch(e){return 'Cửa hàng của bạn'}}
function kpi(l,v,n,c,ic,go){return '<div class="v2-k" onclick="go(\''+go+'\')"><div class="l"><span>'+l+'</span><i class="ti '+ic+'" style="color:'+c+';font-size:17px"></i></div><div class="v" style="color:'+c+'">'+v+'</div><div class="n">'+n+'</div></div>'}
function isSameDay(a,b){var x=new Date(a),y=new Date(b);return x.getFullYear()===y.getFullYear()&&x.getMonth()===y.getMonth()&&x.getDate()===y.getDate()}
function realWeek(){
  var names=['CN','T2','T3','T4','T5','T6','T7'],out=[];
  for(var i=6;i>=0;i--){
    var day=Date.now()-i*24*HOUR;
    var sum=ORD.filter(function(o){return o.st==='done'&&o.completedAt&&isSameDay(o.completedAt,day)}).reduce(function(t,o){return t+o.p},0);
    out.push([names[new Date(day).getDay()],sum/1e6]);
  }
  return out;
}
function pDashV2(){
  if(!DEMO)walletEnsure(false);
  var rev=ORD.filter(function(o){return o.st==='done'}).reduce(function(s,o){return s+o.p},0);
  var act=ORD.filter(function(o){return ['new','confirmed','ready','preparing'].indexOf(o.st)>=0});
  var wait=ORD.filter(function(o){return o.st==='ready'});
  var ap=activePRD(),red=ap.filter(function(p){return p.l==='red'}),yel=ap.filter(function(p){return p.l==='yellow'});
  var conf=PRD.filter(function(p){return p.sync==='conflict'&&!p.donated}).length;
  var blocked=PRD.filter(function(p){return p.blocked&&!p.donated});
  var cOpen=COMPLAINTS.filter(function(c){return c.st==='open'});
  var late=ORD.filter(function(o){return o.pickupDeadline&&['new','confirmed','ready'].indexOf(o.st)>=0&&o.pickupDeadline-Date.now()<15*MIN}).length;
  var week=DEMO?WEEK:realWeek();
  var max=Math.max.apply(null,week.map(function(w){return w[1]}))||1;
  var todayRev=DEMO?rev:ORD.filter(function(o){return o.st==='done'&&o.completedAt&&isSameDay(o.completedAt,Date.now())}).reduce(function(t,o){return t+o.p},0);
  var held=ORD.filter(function(o){return ['new','confirmed','ready'].indexOf(o.st)>=0&&o.pay==='Đã thanh toán'}).reduce(function(t,o){return t+o.p},0);
  var urgent='';
  ORD.filter(function(o){return o.pickupDeadline&&['new','confirmed','ready'].indexOf(o.st)>=0}).sort(function(a,b){return a.pickupDeadline-b.pickupDeadline}).slice(0,3).forEach(function(o){
    var i=ORD.indexOf(o);
    urgent+='<div class="v2-row" onclick="selO='+i+';oP=\''+o.st+'\';go(\'orders\');selO='+i+';oP=\''+o.st+'\';R()"><div class="v2-ic" style="background:'+lB(o.l)+'">'+(o.lines&&o.lines[0]?o.lines[0].emoji:'🍱')+'</div><div><div class="t">#'+o.id+' · '+esc(o.c)+'</div><div class="s">'+esc(o.items)+' · nhận '+esc(o.slot)+'</div></div><div class="r">'+cd(o.pickupDeadline,'Hạn lấy',30,15)+'</div></div>';
  });
  cOpen.slice(0,2).forEach(function(c){
    urgent+='<div class="v2-row" onclick="go(\'complaints\')"><div class="v2-ic" style="background:#fde4e2;color:#b3261e"><i class="ti ti-message-report"></i></div><div><div class="t">'+esc(c.code||c.id)+' · '+esc(c.user)+'</div><div class="s">'+esc(String(c.issue).slice(0,60))+'</div></div><div class="r">'+(c.respondBy?cd(c.respondBy,'Phản hồi',180,60):'<span class="v2-pill r">Chờ xử lý</span>')+'</div></div>';
  });
  if(!urgent)urgent='<div class="v2-pb" style="color:#6b7a70;font-size:12.5px;text-align:center;padding:26px">Không có việc gấp. Mọi đơn đang ở trạng thái an toàn.</div>';
  var alerts='';
  if(late)alerts+='<div class="v2-al r"><i class="ti ti-alarm" style="font-size:22px"></i><div><b>'+late+' đơn sắp hết hạn lấy hàng</b> — nhắc khách đến nhận hoặc chuẩn bị đánh dấu vắng mặt.</div><span class="v2-btn go" onclick="go(\'orders\')">Xem đơn</span></div>';
  if(blocked.length)alerts+='<div class="v2-al y"><i class="ti ti-ban" style="font-size:22px"></i><div><b>Chặn tự động '+blocked.length+' sản phẩm</b> — hệ thống gỡ khỏi app trước hạn sử dụng 30–45 phút để loại bỏ rủi ro ngộ độc thực phẩm.</div></div>';
  if(!alerts&&red.length)alerts='<div class="v2-al y"><i class="ti ti-flame" style="font-size:22px"></i><div><b>'+red.length+' sản phẩm nhãn đỏ</b> sắp hết hạn — nên đẩy bán hoặc chuyển tặng từ thiện.</div><span class="v2-btn go" onclick="go(\'inv\')">Kho hàng</span></div>';
  var repTile=DEMO?'<div class="v2-chip"><i class="ti ti-shield-check"></i> Uy tín '+REP.score+'/100 · hạng '+REP.tier+'</div>':'';
  return ''+
  '<div class="v2-hero"><div style="position:relative;z-index:1"><h2>'+greet()+', '+esc(storeName())+' 👋</h2><p>'+new Date().toLocaleDateString('vi-VN',{weekday:'long',day:'numeric',month:'numeric',year:'numeric'})+' · Bạn đang có '+act.length+' đơn cần xử lý</p>'+
  '<div class="v2-chips">'+(DEMO?'<div class="v2-chip"><i class="ti ti-leaf"></i> Đã cứu 328kg thực phẩm</div>':'')+repTile+'<div class="v2-chip"><i class="ti ti-percentage"></i> Phí nền tảng 2.000đ/đơn</div></div></div>'+
  '<div class="rv"><small>Doanh thu hôm nay</small><b>'+money(todayRev)+'</b>'+(DEMO?'<br><em>↗ +18% so với hôm qua'+sample()+'</em>':'')+'</div></div>'+
  alerts+
  '<div class="v2-g v2-g5 v2-m">'+
   kpi('Đơn cần xử lý',act.length,wait.length+' đơn chờ khách đến nhận','var(--blue)','ti-shopping-bag','orders')+
   kpi('SP cảnh báo HSD',red.length+yel.length,red.length+' đỏ · '+yel.length+' vàng','#d97706','ti-alert-triangle','inv')+
   kpi('Xung đột tồn kho',conf,conf?'Cần đồng bộ':'Đồng bộ OK',conf?'var(--red)':'var(--green-700)','ti-refresh','inv')+
   kpi('Khiếu nại chờ',cOpen.length,cOpen.length?'Phản hồi trong 12 giờ':'Không có',cOpen.length?'var(--red)':'var(--green-700)','ti-message-report','complaints')+
   (DEMO?kpi('Số dư khả dụng',short(WAL.avail),'Đang giữ chờ '+short(WAL.escrow),'var(--green-700)','ti-wallet','wallet'):(WALLET.data?kpi('Số dư khả dụng',short(WALLET.data.available),'Đang giữ chờ '+short(WALLET.data.held),'var(--green-700)','ti-wallet','wallet'):kpi('Tiền đang giữ chờ',short(held),'Đơn đã thanh toán, chờ khách nhận','var(--green-700)','ti-lock','orders')))+
  '</div>'+
  '<div class="v2-g v2-g21 v2-m">'+
   '<div class="v2-p"><div class="v2-ph"><div class="v2-pt"><i class="ti ti-bolt" style="color:#e6a700"></i>Cần xử lý ngay</div><span class="v2-link" onclick="go(\'orders\')">Tất cả đơn →</span></div>'+urgent+'</div>'+
   '<div class="v2-p"><div class="v2-ph"><div class="v2-pt"><i class="ti ti-chart-bar" style="color:#1c7c45"></i>Doanh thu 7 ngày'+sample()+'</div><span class="v2-link" onclick="go(\'ana\')">Chi tiết →</span></div><div class="v2-pb"><div class="v2-chart">'+
   week.map(function(w,i){return '<div class="v2-bar'+(w[1]===max&&w[1]>0?' top':'')+'"><em>'+(w[1]?w[1].toFixed(1).replace('.',',')+'tr':'')+'</em><i style="height:'+(w[1]?Math.max(4,Math.round(w[1]/max*100)):0)+'%"></i><span>'+w[0]+'</span></div>'}).join('')+
   '</div></div></div>'+
  '</div>'+
  '<div class="v2-g v2-g2">'+
   '<div class="v2-p"><div class="v2-ph"><div class="v2-pt"><i class="ti ti-clock-exclamation" style="color:#d94e45"></i>Cảnh báo hạn sử dụng</div><span class="v2-link" onclick="go(\'inv\')">Kho hàng →</span></div>'+
    (red.concat(yel).slice(0,4).map(function(p){return '<div class="v2-row" onclick="go(\'inv\')"><div class="v2-ic" style="background:'+lB(p.l)+'">'+p.img+'</div><div><div class="t">'+esc(p.n)+'</div><div class="s">SL '+p.q+' · còn '+esc(p.left)+'</div></div><div class="r"><span class="v2-pill '+(p.l==='red'?'r':'y')+'">'+lN(p.l)+' · '+lD(p.l)+'</span></div></div>'}).join('')||'<div class="v2-pb" style="color:#6b7a70;text-align:center">Chưa có sản phẩm cận hạn.</div>')+'</div>'+
   '<div class="v2-p"><div class="v2-ph"><div class="v2-pt"><i class="ti ti-receipt" style="color:#0b6aa6"></i>Đơn hàng gần đây</div><span class="v2-link" onclick="go(\'orders\')">Xem tất cả →</span></div>'+
    (ORD.slice(0,5).map(function(o,i){return '<div class="v2-row" onclick="selO='+i+';oP=\''+o.st+'\';go(\'orders\');selO='+i+';oP=\''+o.st+'\';R()"><div class="v2-ic" style="background:'+lB(o.l)+'"><span class="sdot '+o.l[0]+'"></span></div><div><div class="t">#'+o.id+' <span class="v2-pill '+({new:'y',confirmed:'b',ready:'g',done:'g',cancelled:'r',no_show:'r',awaiting_payment:'m'}[o.st]||'m')+'">'+(stM[o.st]||o.st)+'</span></div><div class="s">'+esc(o.items)+' · '+esc(o.c)+'</div></div><div class="r">'+money(o.p)+'</div></div>'}).join('')||'<div class="v2-pb" style="color:#6b7a70;text-align:center">Chưa có đơn hàng.</div>')+'</div>'+
  '</div>';
}

/* ---------- trang: ĐƠN HÀNG (danh sách mới, chi tiết cũ + khối hạn lấy hàng) ---------- */
function pOrdersV2(){
  if(selO!==null)return ordDetail();
  var tabs=[['all','Tất cả']].concat(DEMO?[['awaiting_payment','Chờ thanh toán']]:[]).concat([['new','Mới'],['confirmed','Đã nhận'],['ready','Sẵn sàng'],['done','Hoàn thành'],['no_show','Vắng mặt'],['cancelled','Đã hủy']]);
  var count=function(k){return k==='all'?ORD.length:ORD.filter(function(o){return o.st===k}).length};
  var list=oLab==='all'?ORD:ORD.filter(function(o){return o.st===oLab});
  var pillC={new:'y',confirmed:'b',ready:'g',done:'g',cancelled:'r',no_show:'r',awaiting_payment:'m',preparing:'b',warning:'r'};
  return '<div class="v2-g v2-g21"><div>'+
   '<div class="f ac jb m14" style="margin-bottom:12px;gap:10px;flex-wrap:wrap"><div class="v2-tabs" style="margin:0">'+tabs.map(function(t){return '<span class="v2-tab '+(oLab===t[0]?'on':'')+'" onclick="oLab=\''+t[0]+'\';R()">'+t[1]+' ('+count(t[0])+')</span>'}).join('')+'</div>'+
   '<button class="btn btn-primary" onclick="showPOSModal()"><i class="ti ti-plus"></i> Đơn POS</button></div>'+
   '<div class="v2-p">'+(list.length?list.map(function(o){var i=ORD.indexOf(o);
     var timer=o.st==='awaiting_payment'&&o.payDeadline?cd(o.payDeadline,'Hạn thanh toán',5,2):(['new','confirmed','ready'].indexOf(o.st)>=0&&o.pickupDeadline?cd(o.pickupDeadline,'Hạn lấy',30,15):'');
     return '<div class="v2-row" style="align-items:flex-start" onclick="selO='+i+';oP=\''+o.st+'\';R()"><div class="v2-ic" style="background:'+lB(o.l)+'">'+(o.lines&&o.lines[0]?o.lines[0].emoji:'🍱')+'</div><div style="min-width:0;flex:1"><div class="t">#'+o.id+' <span class="v2-pill '+(pillC[o.st]||'m')+'">'+(stM[o.st]||o.st)+'</span> <span class="v2-pill '+({green:'g',yellow:'y',red:'r'}[o.l])+'">Nhãn '+lN(o.l)+'</span></div><div class="s">'+esc(o.items)+' · '+esc(o.c)+'</div><div class="s" style="margin-top:3px">'+esc(o.mt)+' · '+esc(o.time)+'</div>'+(timer?'<div style="margin-top:6px">'+timer+'</div>':'')+(chatOpen(o)?'<div style="margin-top:6px"><span class="v2-pill b"><i class="ti ti-messages"></i> Chat với khách'+(UNREAD[o.uuid]?' <b class="v2-dot">'+UNREAD[o.uuid]+'</b>':'')+'</span></div>':'')+'</div><div class="r">'+money(o.p)+'<div class="s" style="font-weight:700">'+esc(o.pay)+'</div></div></div>'}).join(''):'<div class="v2-pb" style="text-align:center;color:#6b7a70;padding:46px"><i class="ti ti-package-off" style="font-size:44px;display:block;opacity:.4;margin-bottom:8px"></i>Không có đơn nào trong mục này.</div>')+'</div></div>'+
   '<div><div class="v2-p"><div class="v2-ph"><div class="v2-pt"><i class="ti ti-info-circle" style="color:#0b6aa6"></i>Quy tắc đơn trả trước</div></div><div class="v2-pb" style="display:grid;gap:10px;font-size:12px;font-weight:600;color:#33523f">'+
   '<div class="v2-note"><b>Thời hạn theo nhãn</b><br>Xanh: trả 10p · lấy 120p · hủy miễn phí 30p<br>Vàng: 10p · 90p · 20p<br>Đỏ: 5p · 60p · 15p</div>'+
   '<div class="v2-note"><b>Hủy sớm</b> trong thời gian miễn phí → hoàn 100%. Sau đó không hoàn tiền (tiền chuyển cho cửa hàng, trừ phí 2.000đ).</div>'+
   '<div class="v2-note"><b>Khách vắng mặt</b> quá hạn lấy hàng → đơn chuyển “Vắng mặt”, không hoàn tiền, khách bị trừ 15 điểm uy tín.</div></div></div></div></div>';
}

/* khối bổ sung trong chi tiết đơn: hạn lấy hàng + thanh toán */
function orderExtra(){
  if(pg!=='orders'||selO===null||!ORD[selO])return;
  var o=ORD[selO],host=$('.pos-r > div:nth-child(2)');
  if(!host||host.querySelector('.v2-ox'))return;
  var steps=[['Thanh toán',['new','confirmed','ready','done'].indexOf(o.st)>=0||o.pay==='Đã thanh toán'],['Cửa hàng nhận',['confirmed','ready','done'].indexOf(o.st)>=0],['Sẵn sàng',['ready','done'].indexOf(o.st)>=0],['Khách nhận',o.st==='done']];
  var bad=o.st==='no_show'||o.st==='cancelled';
  var h='<div class="v2-ox v2-note" style="background:#fff;border-color:#e3e9e4"><div style="font-weight:800;color:#111512;margin-bottom:6px"><i class="ti ti-timeline"></i> Tiến trình & hạn xử lý</div>'+
   '<div class="v2-tl">'+steps.map(function(s){return '<div class="'+(bad?'bad':s[1]?'on':'')+'">'+s[0]+'</div>'}).join('')+'</div>';
  if(o.payDeadline&&o.st==='awaiting_payment')h+='<div style="margin-top:6px">'+cd(o.payDeadline,'Hạn thanh toán',5,2)+' <span style="color:#6b7a70">Quá hạn đơn tự hủy, hàng được trả về kho.</span></div>';
  if(o.pickupDeadline&&['new','confirmed','ready'].indexOf(o.st)>=0)h+='<div style="margin-top:6px">'+cd(o.pickupDeadline,'Hạn lấy hàng',30,15)+'<div style="margin-top:5px;color:#6b7a70">Hạn lấy = nhỏ nhất giữa (giờ thanh toán + thời hạn nhãn) và hạn sử dụng sản phẩm.</div></div>';
  if(o.st==='no_show')h+='<div style="margin-top:6px;color:#b3261e;font-weight:800">Khách không đến nhận · không hoàn tiền · tiền đã chuyển cho cửa hàng (trừ phí 2.000đ).</div>';
  h+='<div style="margin-top:8px;color:#6b7a70">Thanh toán: <b style="color:#111512">'+esc(o.pay)+'</b> · '+esc(o.payLabel||'')+(DEMO?' <span class="v2-tag">Mô phỏng ví</span>':'')+'</div></div>';
  host.insertAdjacentHTML('afterbegin',h+chatHtml(o));
  var hd=$('.pos-l > .f');if(hd&&!hd.querySelector('.v2-chatbtn')){chatSeed(o);var n=DEMO?(CHAT[o.id]||[]).filter(function(x){return x.f==='c'}).length:(UNREAD[o.uuid]||0);
    hd.insertAdjacentHTML('beforeend','<span class="v2-btn p v2-chatbtn" style="margin-left:auto" onclick="var c=document.querySelector(\'.v2-chat\');if(c){c.scrollIntoView({behavior:\'smooth\',block:\'center\'});c.classList.add(\'flash\');setTimeout(function(){c.classList.remove(\'flash\')},1500)}"><i class="ti ti-messages"></i> Nhắn tin cho khách'+(n?' <b class="v2-dot">'+n+'</b>':'')+'</span>');}
  tickCd();
  chatFetch(o);
}


/* ---------- khung chat theo đơn (cửa hàng nhắn tin trao đổi với khách) ---------- */
var CHAT={},CHATOK={},UNREAD={};
function chatTime(iso){return new Date(iso).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})}
function chatSeed(o){
  if(CHAT[o.id])return;
  var t=function(m){return new Date(NOW-m*MIN).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})};
  CHAT[o.id]=DEMO?[{f:'sys',m:'Cuộc trò chuyện được mở sau khi khách thanh toán.',t:t(30)},{f:'c',m:'Mình sẽ đến khoảng 17:45 nhé.',t:t(12)},{f:'s',m:'Dạ cửa hàng đã giữ hàng cho bạn rồi ạ.',t:t(10)}]:[];
}
function chatOpen(o){
  if(!DEMO&&CHATOK[o.id]!==undefined)return CHATOK[o.id];
  return ['confirmed','ready','new'].indexOf(o.st)>=0;
}
function chatHtml(o){
  chatSeed(o);var open=chatOpen(o),L=CHAT[o.id];
  var quick=['Hàng đã sẵn sàng, mời bạn đến nhận','Bạn còn bao lâu nữa đến ạ?','Cửa hàng sắp đóng cửa, mong bạn đến sớm'];
  return '<div class="v2-ox v2-chat"><div style="font-weight:800;color:#111512;margin-bottom:8px"><i class="ti ti-messages"></i> Trao đổi với '+esc(o.c)+(DEMO?' <span class="v2-tag">Mô phỏng</span>':'')+'</div>'+
   '<div class="v2-msgs" id="v2msgs">'+(L.length?L.map(function(x){return x.f==='sys'?'<div class="v2-sys">'+esc(x.m)+'</div>':'<div class="v2-b '+(x.f==='s'?'me':'')+'"><div>'+esc(x.m)+'</div><small>'+x.t+'</small></div>'}).join(''):'<div class="v2-sys">Chưa có tin nhắn.</div>')+'</div>'+
   (open?'<div class="v2-qk">'+quick.map(function(q){return '<span onclick="v2Say(\''+o.id+'\',this.textContent)">'+q+'</span>'}).join('')+'</div><div class="v2-inp"><input id="v2ci" maxlength="500" placeholder="Nhập tin nhắn…" onkeydown="if(event.key===\'Enter\')v2Say(\''+o.id+'\')"><span class="v2-btn p" onclick="v2Say(\''+o.id+'\')"><i class="ti ti-send"></i></span></div>':'<div class="v2-sys">Đơn đã kết thúc – cuộc trò chuyện chỉ còn xem lại (admin xem được khi có khiếu nại).</div>')+'</div>';
}
function chatRepaint(o){
  var h=$('.v2-chat');if(!h)return;
  var keep=($('#v2ci')||{}).value||'';
  h.outerHTML=chatHtml(o);
  var s=$('#v2msgs');if(s)s.scrollTop=s.scrollHeight;
  var inp=$('#v2ci');if(inp&&keep)inp.value=keep;
}
var chatSig={};
function chatFetch(o){
  if(DEMO||!o||!o.uuid||typeof partnerApiRequest!=='function')return;
  partnerApiRequest('/orders/'+o.uuid+'/messages').then(function(data){
    var msgs=(data&&data.messages)||[];
    var list=msgs.map(function(m){return{f:m.sender_role==='partner'?'s':m.sender_role==='customer'?'c':'sys',m:m.body,t:chatTime(m.created_at)}});
    var sig=msgs.map(function(m){return m.id}).join(',')+'|'+(data&&data.can_send);
    CHATOK[o.id]=!!(data&&data.can_send);
    if(chatSig[o.id]===sig)return;
    chatSig[o.id]=sig;CHAT[o.id]=list;
    if(pg==='orders'&&selO!==null&&ORD[selO]===o)chatRepaint(o);
    partnerApiRequest('/orders/'+o.uuid+'/messages/read',{method:'POST'}).catch(function(){});
    if(UNREAD[o.uuid]){delete UNREAD[o.uuid]}
  }).catch(function(){});
}
window.v2Say=function(id,txt){
  var inp=$('#v2ci'),m=(txt||(inp&&inp.value)||'').trim();if(!m)return;
  var o=ORD.filter(function(x){return x.id===id})[0];
  if(DEMO||!o){
    CHAT[id]=CHAT[id]||[];CHAT[id].push({f:'s',m:m,t:new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})});
    if(DEMO)tst('Đã gửi tin nhắn','Khách sẽ nhận thông báo đẩy','info');
    var h=$('.v2-chat');if(h){h.outerHTML=chatHtml(ORD[selO]);var s=$('#v2msgs');if(s)s.scrollTop=s.scrollHeight;}
    return;
  }
  if(inp)inp.value='';
  partnerApiRequest('/orders/'+o.uuid+'/messages',{method:'POST',body:{body:m}}).then(function(){chatSig[o.id]='';chatFetch(o)}).catch(function(e){
    if(inp)inp.value=m;
    tst('Chưa gửi được tin nhắn',(e&&e.message)||'Vui lòng thử lại','info');
  });
};
// Cập nhật chat đang mở mỗi 6 giây (Realtime Supabase sẽ thay bằng đẩy tức thì ở bước sau)
if(!DEMO)setInterval(function(){
  if(document.hidden||pg!=='orders'||selO===null||!ORD[selO])return;
  chatFetch(ORD[selO]);
},6000);

/* ---------- trang: KHIẾU NẠI (luồng phản hồi 12 giờ) ---------- */
function pComplaintsV2(){
  var open=COMPLAINTS.filter(function(c){return c.st==='open'}),rev=COMPLAINTS.filter(function(c){return c.st==='in-review'}),done=COMPLAINTS.filter(function(c){return c.st==='resolved'});
  var card=function(c){var late=c.respondBy&&c.respondBy-Date.now()<2*HOUR;
   return '<div class="v2-cp '+(late?'late':'')+'"><div class="f ac jb" style="gap:12px;flex-wrap:wrap"><div class="f ac g12"><div class="v2-ph-img">'+(c.img||'📦')+'</div><div><div style="font-weight:900;font-size:13.5px">'+esc(c.code||c.id)+' · '+esc(c.user)+' <span class="v2-pill '+(c.priority==='high'?'r':c.priority==='medium'?'y':'m')+'">'+(c.priority==='high'?'Ưu tiên cao':c.priority==='medium'?'Trung bình':'Thấp')+'</span></div><div style="font-size:11.5px;color:#6b7a70;font-weight:600">'+esc(c.product)+' · '+esc(c.time)+'</div></div></div>'+(c.respondBy?'<div>'+cd(c.respondBy,'Hạn phản hồi',180,60)+'</div>':'')+'</div>'+
   '<div class="v2-note" style="margin:12px 0"><b>'+esc(c.reason||'Vấn đề')+':</b> '+esc(c.issue)+(c.photos?'<div style="margin-top:6px;color:#14683b"><i class="ti ti-photo"></i> '+c.photos+' ảnh minh chứng từ người mua</div>'+(c.photoUrls&&c.photoUrls.length?'<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">'+c.photoUrls.map(function(u){return '<a href="'+esc(u)+'" target="_blank" rel="noopener"><img src="'+esc(u)+'" alt="Ảnh minh chứng" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid #dcebe0"></a>'}).join('')+'</div>':''):'')+(c.amount?'<div style="margin-top:4px">Giá trị đơn: <b>'+money(c.amount)+'</b></div>':'')+'</div>'+
   (c.reasonCode&&!DEMO
     ?'<div class="f g8" style="flex-wrap:wrap"><span class="v2-btn p" onclick="v2CpAccept(\''+c.id+'\')"><i class="ti ti-receipt-refund"></i> Đồng ý hoàn tiền 100%</span><span class="v2-btn d" onclick="v2CpDispute(\''+c.id+'\')"><i class="ti ti-gavel"></i> Không đồng ý · chuyển Admin</span></div></div>'
     :'<div class="f g8" style="flex-wrap:wrap"><span class="v2-btn p" onclick="resolveComplaint(\''+c.id+'\',\'refund\')"><i class="ti ti-receipt-refund"></i> Đồng ý hoàn tiền</span><span class="v2-btn" onclick="resolveComplaint(\''+c.id+'\',\'voucher\')"><i class="ti ti-gift"></i> Bồi thường voucher</span><span class="v2-btn" onclick="resolveComplaint(\''+c.id+'\',\'explain\')"><i class="ti ti-message"></i> Giải thích</span><span class="v2-btn d" onclick="resolveComplaint(\''+c.id+'\',\'escalate\')"><i class="ti ti-gavel"></i> Không đồng ý · chuyển Admin</span></div></div>')};
  return '<div class="v2-g v2-g4 v2-m">'+kpi('Tổng khiếu nại',COMPLAINTS.length,'30 ngày gần nhất','#111512','ti-message-report','complaints')+kpi('Chờ phản hồi',open.length,'Phản hồi trong 12 giờ','var(--red)','ti-exclamation-circle','complaints')+kpi('Admin đang xem',rev.length,'Cửa hàng không đồng ý','#d97706','ti-gavel','complaints')+kpi('Đã giải quyết',done.length,'Kết quả do admin chốt','var(--green-700)','ti-circle-check','complaints')+'</div>'+
  '<div class="v2-note v2-m"><b>Quy trình:</b> Người mua gửi khiếu nại kèm ảnh (trong 12 giờ với đồ nấu chín, 24 giờ với hàng còn lại sau khi nhận) → bạn có <b>12 giờ</b> để đồng ý hoàn tiền hoặc không đồng ý. Không đồng ý hoặc quá hạn → <b>Admin</b> quyết định hoàn đủ / một phần / bác bỏ. Khiếu nại đúng sẽ trừ <b>15 điểm uy tín</b> cửa hàng.</div>'+
  (open.length?'<div class="v2-pt" style="margin:6px 0 10px"><i class="ti ti-alert-circle" style="color:#d94e45"></i>Cần phản hồi ('+open.length+')</div>'+open.map(card).join(''):'<div class="v2-p v2-m"><div class="v2-pb" style="text-align:center;color:#14683b;font-weight:800;padding:30px"><i class="ti ti-shield-check" style="font-size:40px;display:block"></i>Không có khiếu nại nào cần phản hồi.</div></div>')+
  (rev.length?'<div class="v2-p v2-m"><div class="v2-ph"><div class="v2-pt"><i class="ti ti-gavel"></i>Đang chờ Admin quyết định</div></div>'+rev.map(function(c){return '<div class="v2-row"><div class="v2-ic" style="background:#fff3cd">'+(c.img||'📦')+'</div><div><div class="t">'+esc(c.code||c.id)+' · '+esc(c.user)+'</div><div class="s">'+esc(c.issue)+'</div>'+(c.storeResponse?'<div class="s" style="color:#8a5a00">Bạn đã phản hồi: '+esc(c.storeResponse)+'</div>':'')+'</div><div class="r"><span class="v2-pill y">Đang xem xét</span></div></div>'}).join('')+'</div>':'')+
  (done.length?'<div class="v2-p"><div class="v2-ph"><div class="v2-pt"><i class="ti ti-circle-check" style="color:#1c7c45"></i>Đã giải quyết</div></div>'+done.map(function(c){return '<div class="v2-row"><div class="v2-ic" style="background:#e3f6ea">'+(c.img||'📦')+'</div><div><div class="t">'+esc(c.code||c.id)+' · '+esc(c.user)+'</div><div class="s">'+esc(c.issue)+'</div><div class="s" style="color:#14683b;font-weight:700">'+esc(c.resolution||'')+(c.refund?' · hoàn '+money(c.refund):'')+'</div></div><div class="r"><span class="v2-pill '+(c.apiStatus==='rejected'?'m':'g')+'">'+(c.apiStatus==='rejected'?'Bị bác bỏ':'Đã xong')+'</span></div></div>'}).join('')+'</div>':'');
}

/* ---------- trang: VÍ · ĐỐI SOÁT (sổ cái mô phỏng + rút tiền) ---------- */
function pWalletV2(){
  var kc={in:'#14683b',hold:'#8a5a00',out:'#b3261e'};
  return '<div class="v2-g v2-g21 v2-m"><div class="v2-wal"><small>Số dư khả dụng'+sample()+'</small><div class="big">'+money(WAL.avail)+'</div><div style="display:flex;gap:10px;flex-wrap:wrap"><span class="btnw" onclick="v2Withdraw()"><i class="ti ti-arrow-up-right"></i> Rút tiền</span><span class="btnw o"><i class="ti ti-building-bank"></i> '+WAL.bank+'</span></div><div style="margin-top:14px;font-size:11.5px;color:#cfeedd;font-weight:600">Chỉ lưu 4 số cuối tài khoản. Rút tối thiểu 50.000đ · duyệt trong 1 ngày làm việc.</div></div>'+
   '<div class="v2-p"><div class="v2-ph"><div class="v2-pt"><i class="ti ti-scale"></i>Cách tính tiền về ví</div></div><div class="v2-pb" style="display:grid;gap:8px;font-size:12px;font-weight:600;color:#33523f"><div class="v2-note">① Khách trả tiền → <b>tiền giữ chờ (escrow)</b>.</div><div class="v2-note">② Khách nhận hàng → tiền vào ví cửa hàng, trừ <b>phí 2.000đ/đơn</b>.</div><div class="v2-note">③ Hủy sớm: hoàn 100% khách · hủy muộn / vắng mặt: <b>chuyển cho cửa hàng</b>.</div></div></div></div>'+
  '<div class="v2-g v2-g4 v2-m">'+kpi('Đang giữ chờ',money(WAL.escrow),'Chờ khách nhận hàng','#8a5a00','ti-lock','wallet')+kpi('Chờ duyệt rút',money(WAL.pendingW),'1 yêu cầu','#0b6aa6','ti-hourglass','wallet')+kpi('Đã rút (30 ngày)',money(WAL.withdrawn),'3 lần','#111512','ti-cash','wallet')+kpi('Phí nền tảng',money(14000),'7 đơn × 2.000đ','#b3261e','ti-percentage','wallet')+'</div>'+
  '<div class="v2-p"><div class="v2-ph"><div class="v2-pt"><i class="ti ti-list-details"></i>Sổ giao dịch'+sample()+'</div></div><div style="overflow:auto"><table class="v2-t"><thead><tr><th>Loại</th><th>Đơn / Mã</th><th>Thời gian</th><th>Trạng thái</th><th style="text-align:right">Số tiền</th></tr></thead><tbody>'+
   WAL.tx.map(function(t){return '<tr><td>'+esc(t.t)+'</td><td>'+esc(t.o)+'</td><td>'+esc(t.d)+'</td><td><span class="v2-pill '+(t.k==='hold'?'y':t.k==='in'?'g':'m')+'">'+esc(t.s)+'</span></td><td style="text-align:right;font-weight:900;color:'+kc[t.k]+'">'+(t.a>0?'+':'')+money(t.a)+'</td></tr>'}).join('')+'</tbody></table></div></div>';
}

/* ---------- VÍ · ĐỐI SOÁT (dữ liệu thật: GET /partner/wallet) ---------- */
var WALLET={data:null,loading:false,err:'',at:0};
function walletEnsure(force){
  if(DEMO||WALLET.loading||typeof partnerApiRequest!=='function')return;
  // Chống gọi dồn dập: có dữ liệu mới (<15 giây) hoặc vừa lỗi (<15 giây) thì không gọi lại; chỉ nút Thử lại / làm mới mới ép gọi
  if(!force&&(WALLET.err||WALLET.data)&&Date.now()-WALLET.at<15000)return;
  WALLET.loading=true;
  partnerApiRequest('/partner/wallet').then(function(d){WALLET.data=d;WALLET.err='';WALLET.at=Date.now()})
    .catch(function(e){WALLET.err=(e&&e.message)||'Không tải được ví.';WALLET.at=Date.now()})
    .then(function(){WALLET.loading=false;if(pg==='wallet'||pg==='dash')R()});
}
var ENTRY_LABEL={release:{completed:'Doanh thu đơn',late_cancel:'Khách hủy muộn – chuyển cho cửa hàng',no_show:'Khách không đến nhận – chuyển cho cửa hàng'},refund_clawback:'Hoàn tiền sau khi đã nhận (khiếu nại)',withdraw:'Rút tiền về ngân hàng',adjustment:'Điều chỉnh'};
var WD_PILL={requested:['y','Chờ duyệt'],approved:['b','Đã duyệt · chờ chi'],processing:['b','Đang chi'],paid:['g','Đã chi'],rejected:['r','Bị từ chối'],failed:['r','Chi thất bại']};
var ACC_PILL={pending_verification:['y','Chờ admin xác minh'],verified:['g','Đã xác minh'],rejected:['r','Bị từ chối'],replaced:['m','Đã thay']};
function entryLabel(e){var m=ENTRY_LABEL[e.type];return typeof m==='object'?(m[e.reason]||m.completed):(m||e.type)}
function bankHint(){
  try{
    var f=(currentPartnerStoreProfile()||{}).finance||{};
    var digits=String(f.bank_account_number||'').replace(/\D/g,'');
    return{bank:String(f.bank_name||'').trim(),last4:digits.length>=4?digits.slice(-4):''};
  }catch(e){return{bank:'',last4:''}}
}
function pWalletReal(){
  walletEnsure(false);
  var d=WALLET.data;
  if(!d)return '<div class="v2-p"><div class="v2-pb" style="text-align:center;color:#6b7a70;padding:46px">'+(WALLET.err?esc(WALLET.err)+' <span class="v2-btn" onclick="WALLET.err=\'\';walletEnsure(true)">Thử lại</span>':'Đang tải ví…')+'</div></div>';
  var acc=d.payout_account,ap=acc?(ACC_PILL[acc.status]||['m',acc.status]):null;
  var bankText=acc?acc.bank_name+' ••••'+acc.account_last4:'Chưa có tài khoản nhận tiền';
  var accNote=!acc?'<div style="margin-top:10px;font-size:12px;color:#ffe9a8;font-weight:700">Hãy thêm tài khoản nhận tiền để rút tiền (admin sẽ xác minh).</div>'
    :acc.status==='pending_verification'?'<div style="margin-top:10px;font-size:12px;color:#ffe9a8;font-weight:700">Tài khoản đang chờ admin xác minh, chưa tạo được lệnh rút.</div>'
    :acc.status==='rejected'?'<div style="margin-top:10px;font-size:12px;color:#ffc9c4;font-weight:700">Tài khoản bị từ chối'+(acc.admin_note?': '+esc(acc.admin_note):'')+'. Hãy gửi lại tài khoản khác.</div>':'';
  return '<div class="v2-g v2-g21 v2-m"><div class="v2-wal"><small>Số dư khả dụng</small><div class="big">'+money(d.available)+'</div><div style="display:flex;gap:10px;flex-wrap:wrap"><span class="btnw" onclick="v2Withdraw()"><i class="ti ti-arrow-up-right"></i> Rút tiền</span><span class="btnw o" onclick="editFinance()" title="Đổi tài khoản nhận tiền"><i class="ti ti-building-bank"></i> '+esc(bankText)+(ap?' · '+ap[1]:'')+'</span></div>'+accNote+'<div style="margin-top:14px;font-size:11.5px;color:#cfeedd;font-weight:600">Số tài khoản được mã hóa, chỉ hiện 4 số cuối. Rút tối thiểu 50.000đ · admin duyệt và chi trong 1 ngày làm việc.</div></div>'+
   '<div class="v2-p"><div class="v2-ph"><div class="v2-pt"><i class="ti ti-scale"></i>Cách tính tiền về ví</div></div><div class="v2-pb" style="display:grid;gap:8px;font-size:12px;font-weight:600;color:#33523f"><div class="v2-note">① Khách trả tiền → <b>tiền giữ chờ (escrow)</b>.</div><div class="v2-note">② Khách nhận hàng → tiền vào ví cửa hàng, trừ <b>phí 2.000đ/đơn</b>.</div><div class="v2-note">③ Hủy sớm: hoàn 100% khách · hủy muộn / vắng mặt: <b>chuyển cho cửa hàng</b>.</div></div></div></div>'+
  '<div class="v2-g v2-g4 v2-m">'+kpi('Đang giữ chờ',money(d.held),d.held_orders+' đơn chờ khách nhận','#8a5a00','ti-lock','wallet')+kpi('Chờ duyệt rút',money(d.pending_withdrawals),'Đã trừ khỏi số dư khả dụng','#0b6aa6','ti-hourglass','wallet')+kpi('Đã rút',money(d.withdrawn),'Tổng các lệnh đã chi','#111512','ti-cash','wallet')+kpi('Số dư ví',money(d.balance),'Gồm cả phần đang chờ duyệt rút','var(--green-700)','ti-wallet','wallet')+'</div>'+
  '<div class="v2-p v2-m"><div class="v2-ph"><div class="v2-pt"><i class="ti ti-list-details"></i>Sổ giao dịch</div><span class="v2-link" onclick="walletEnsure(true)">Làm mới →</span></div><div style="overflow:auto"><table class="v2-t"><thead><tr><th>Loại</th><th>Đơn / Mã</th><th>Thời gian</th><th style="text-align:right">Số tiền</th></tr></thead><tbody>'+
   ((d.entries||[]).map(function(e){var inn=e.amount>0;return '<tr><td>'+esc(entryLabel(e))+'</td><td>'+esc(e.order_number||'')+'</td><td>'+new Date(e.created_at).toLocaleString('vi-VN',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'})+'</td><td style="text-align:right;font-weight:900;color:'+(inn?'#14683b':'#b3261e')+'">'+(inn?'+':'')+money(e.amount)+'</td></tr>'}).join('')||'<tr><td colspan="4" style="text-align:center;color:#6b7a70;padding:26px">Chưa có giao dịch nào.</td></tr>')+'</tbody></table></div></div>'+
  '<div class="v2-p"><div class="v2-ph"><div class="v2-pt"><i class="ti ti-arrow-up-right"></i>Lệnh rút tiền</div></div><div style="overflow:auto"><table class="v2-t"><thead><tr><th>Ngày gửi</th><th>Tài khoản</th><th>Trạng thái</th><th>Ghi chú / mã giao dịch</th><th style="text-align:right">Số tiền</th></tr></thead><tbody>'+
   ((d.withdrawals||[]).map(function(w){var p=WD_PILL[w.status]||['m',w.status];return '<tr><td>'+new Date(w.requested_at).toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+'</td><td>'+esc(w.bank_name)+' ••••'+esc(w.account_last4)+'</td><td><span class="v2-pill '+p[0]+'">'+p[1]+'</span></td><td>'+esc(w.failure_reason||w.admin_note||'')+(w.bank_txn_ref?' <small style="color:#6b7a70">· mã GD '+esc(w.bank_txn_ref)+'</small>':'')+'</td><td style="text-align:right;font-weight:900">'+money(w.amount_cents)+'</td></tr>'}).join('')||'<tr><td colspan="5" style="text-align:center;color:#6b7a70;padding:26px">Chưa có lệnh rút nào.</td></tr>')+'</tbody></table></div></div>';
}
var _demoWithdraw=null;
window.v2Withdraw=function(){
  if(DEMO){
    modal('Rút tiền về tài khoản','<div class="field"><label>Số tiền (đ)</label><input id="v2wa" class="inp" value="'+WAL.avail+'" style="font-size:20px;font-weight:900"></div><div class="v2-note" style="margin:10px 0">Rút về <b>'+WAL.bank+'</b>. Yêu cầu sẽ ở trạng thái <b>Chờ duyệt</b>, admin duyệt trong 1 ngày làm việc.</div><button class="btn btn-primary btn-lg" style="width:100%;justify-content:center" onclick="closeM();tst(\'Đã gửi yêu cầu rút tiền\',\'Chờ admin duyệt\',\'info\')"><i class="ti ti-send"></i> Gửi yêu cầu rút</button>');
    return;
  }
  var d=WALLET.data;if(!d){tst('Chưa tải xong ví','Vui lòng đợi một chút','info');return;}
  var acc=d.payout_account;
  if(!acc){editFinance();return;}
  if(acc.status!=='verified'){tst('Chưa rút được','Tài khoản nhận tiền chưa được admin xác minh','info');return;}
  modal('Rút tiền về tài khoản','<div class="field"><label>Số tiền (đ) · khả dụng '+money(d.available)+'</label><input id="v2wa" class="inp" inputmode="numeric" value="'+Math.max(0,d.available)+'" style="font-size:20px;font-weight:900"></div>'+
   '<div class="v2-note" style="margin:10px 0">Rút về <b>'+esc(acc.bank_name)+' ••••'+esc(acc.account_last4)+'</b> ('+esc(acc.account_holder_name)+'). Tối thiểu <b>50.000đ</b>. Lệnh ở trạng thái <b>Chờ duyệt</b> và số tiền được giữ lại ngay; sau khi admin duyệt và chuyển khoản, trạng thái chuyển thành <b>Đã chi</b>.</div>'+
   '<button id="v2wsend" class="btn btn-primary btn-lg" style="width:100%;justify-content:center" onclick="v2WithdrawSend()"><i class="ti ti-send"></i> Gửi yêu cầu rút</button>');
};
window.v2WithdrawSend=function(){
  var amount=Math.round(Number(String(($('#v2wa')||{}).value||'').replace(/\D/g,'')));
  if(!(amount>=50000)){tst('Số tiền chưa hợp lệ','Rút tối thiểu 50.000đ','info');return;}
  var btn=$('#v2wsend');if(btn)btn.disabled=true;
  partnerApiRequest('/partner/withdrawals',{method:'POST',body:{amount_cents:amount}}).then(function(){
    closeM();tst('Đã gửi yêu cầu rút tiền','Chờ admin duyệt · '+money(amount),'payout');walletEnsure(true);
  }).catch(function(e){
    if(btn)btn.disabled=false;
    tst('Chưa gửi được lệnh rút',(e&&e.message)||'Vui lòng thử lại','info');
  });
};


/* ---------- KHIẾU NẠI THẬT: phản hồi trong 12 giờ (POST /orders/complaints/:id/respond) ---------- */
var cpBusy=false;
function cpFind(id){return COMPLAINTS.filter(function(x){return x.id===id})[0]}
function cpDone(){cpBusy=false;try{if(window.FS&&window.FS.sync&&window.FS.sync.refresh)window.FS.sync.refresh().catch(function(){})}catch(e){}R()}
window.v2CpAccept=function(id){
  var c=cpFind(id);if(!c||cpBusy)return;
  modal('Đồng ý hoàn tiền','<p style="font-size:13.5px;line-height:1.7;margin-bottom:14px">Bạn đồng ý <b>hoàn 100%</b> cho đơn <b>'+esc(c.order)+'</b> ('+money(c.amount)+'). Số tiền được trừ vào ví cửa hàng và <b>cửa hàng bị trừ 15 điểm uy tín</b>. Khiếu nại sẽ kết thúc.</p><button id="cp-ok" class="btn btn-r btn-lg" style="width:100%;justify-content:center" onclick="v2CpAcceptSend(\''+id+'\')"><i class="ti ti-receipt-refund"></i> Xác nhận hoàn tiền</button>');
};
window.v2CpAcceptSend=function(id){
  if(cpBusy)return;cpBusy=true;var b=$('#cp-ok');if(b)b.disabled=true;
  partnerApiRequest('/orders/complaints/'+encodeURIComponent(id)+'/respond',{method:'POST',body:{action:'accept'}}).then(function(){closeM();tst('Đã đồng ý hoàn tiền','Khách được hoàn 100%','payout');cpDone()})
    .catch(function(e){cpBusy=false;if(b)b.disabled=false;tst('Chưa xử lý được',(e&&e.message)||'Vui lòng thử lại','info')});
};
var cpDisputeFiles=[];
window.v2CpDispute=function(id){
  var c=cpFind(id);if(!c||cpBusy)return;cpDisputeFiles=[];
  modal('Không đồng ý khiếu nại','<p style="font-size:13px;line-height:1.7;margin-bottom:10px">Khiếu nại sẽ được chuyển cho <b>FoodSave (Admin) quyết định</b>. Hãy nêu rõ lý do và đính kèm ảnh nếu có.</p>'+
    '<div class="field"><label>Lý do không đồng ý *</label><textarea id="cp-note" class="inp" rows="4" maxlength="1000" placeholder="Ví dụ: đã giao đủ hàng, có camera, hàng còn nguyên đóng gói..."></textarea></div>'+
    '<div class="field"><label>Ảnh minh chứng (không bắt buộc, tối đa 3)</label><input id="cp-files" type="file" accept="image/jpeg,image/png,image/webp" multiple><div id="cp-files-info" style="font-size:11.5px;color:#6b7a70;margin-top:4px"></div></div>'+
    '<button id="cp-send" class="btn btn-primary btn-lg" style="width:100%;justify-content:center" onclick="v2CpDisputeSend(\''+id+'\')"><i class="ti ti-gavel"></i> Gửi cho Admin quyết định</button>');
  var inp=$('#cp-files');if(inp)inp.addEventListener('change',function(){v2CpPick(inp.files)});
};
async function v2CpPick(files){
  var info=$('#cp-files-info'),client=(typeof partnerStorageClient==='function')?partnerStorageClient():null;
  if(!client){if(info)info.textContent='Chưa kết nối được kho ảnh, bạn vẫn gửi được không kèm ảnh.';return;}
  if(info)info.textContent='Đang tải ảnh...';
  try{
    var list=Array.prototype.slice.call(files||[]).slice(0,3-cpDisputeFiles.length);
    for(var i=0;i<list.length;i++){
      var f=list[i];
      if(['image/jpeg','image/png','image/webp'].indexOf(f.type)<0||f.size>5*1024*1024){tst('Ảnh không hợp lệ','Chỉ nhận JPG/PNG/WEBP tối đa 5MB','info');continue;}
      var up=await partnerApiRequest('/orders/complaints/upload-url',{method:'POST',body:{content_type:f.type}});
      var r=await client.storage.from('partner-assets').uploadToSignedUrl(up.path,up.token,f,{contentType:f.type});
      if(r&&r.error)throw new Error('Không tải được ảnh');
      cpDisputeFiles.push(up.public_url);
    }
    if(info)info.textContent='Đã đính kèm '+cpDisputeFiles.length+' ảnh.';
  }catch(e){if(info)info.textContent=(e&&e.message)||'Không tải được ảnh';}
}
window.v2CpDisputeSend=function(id){
  if(cpBusy)return;
  var note=String(($('#cp-note')||{}).value||'').trim();
  if(note.length<5){tst('Thiếu lý do','Nhập lý do không đồng ý (tối thiểu 5 ký tự)','info');return;}
  cpBusy=true;var b=$('#cp-send');if(b)b.disabled=true;
  partnerApiRequest('/orders/complaints/'+encodeURIComponent(id)+'/respond',{method:'POST',body:{action:'dispute',note:note,image_urls:cpDisputeFiles}}).then(function(){closeM();tst('Đã chuyển cho Admin','FoodSave sẽ xem xét và quyết định','info');cpDone()})
    .catch(function(e){cpBusy=false;if(b)b.disabled=false;tst('Chưa gửi được',(e&&e.message)||'Vui lòng thử lại','info')});
};
// Khiếu nại MỚI dùng luồng phản hồi; khiếu nại CŨ (không có lý do/ảnh) vẫn dùng hàm cũ
if(!DEMO){
  var _resolveLegacy=resolveComplaint;
  resolveComplaint=function(id,action){
    var c=cpFind(id);
    if(c&&c.reasonCode){if(action==='refund')return window.v2CpAccept(id);if(action==='escalate')return window.v2CpDispute(id);return;}
    return _resolveLegacy(id,action);
  };
}

/* ---------- trang MỚI: KHÁCH HÀNG ---------- */
var CUST=[['Trần Thu H.','0977 •••• 456',12,'4,9',0,'Thành viên vàng'],['Lê Văn H.','0933 •••• 111',9,'4,7',0,'Thành viên bạc'],['Nguyễn Minh T.','0912 •••• 678',5,'4,8',0,'Thành viên mới'],['Vũ Hải N.','0944 •••• 000',3,'3,9',1,'Đã vắng mặt 1 lần'],['Đỗ Thảo V.','0966 •••• 444',14,'5,0',0,'Thành viên vàng']];
function pCustDemo(){
  return '<div class="v2-g v2-g4 v2-m">'+kpi('Khách đã mua','148','30 ngày','#111512','ti-users','customers')+kpi('Khách quay lại','62%','Từ lần mua thứ 2','var(--green-700)','ti-repeat','customers')+kpi('Đánh giá TB','4,7 ★','Từ 96 đánh giá','#d97706','ti-star','customers')+kpi('Vắng mặt','2','Tháng này','var(--red)','ti-user-off','customers')+'</div>'+
  '<div class="v2-p"><div class="v2-ph"><div class="v2-pt"><i class="ti ti-users"></i>Khách hàng thân thiết'+sample()+'</div></div><div style="overflow:auto"><table class="v2-t"><thead><tr><th>Khách</th><th>Điện thoại</th><th>Số đơn</th><th>Đánh giá</th><th>Vắng mặt</th><th>Ghi chú</th></tr></thead><tbody>'+
  CUST.map(function(c){return '<tr><td><b>'+c[0]+'</b></td><td>'+c[1]+'</td><td>'+c[2]+'</td><td>'+c[3]+' ★</td><td><span class="v2-pill '+(c[4]?'r':'g')+'">'+c[4]+'</span></td><td>'+c[5]+'</td></tr>'}).join('')+'</tbody></table></div><div class="v2-pb"><div class="v2-note">Số điện thoại được che một phần để bảo vệ quyền riêng tư của người mua.</div></div></div>';
}

/* ---------- trang MỚI: KHUYẾN MÃI ---------- */
function pPromoDemo(){
  var V=[['FS-WELCOME10','Giảm 10% đơn đầu','10%','Đang chạy','42/100'],['FS-RED5K','Giảm 5.000đ hàng nhãn đỏ','5.000đ','Đang chạy','18/50'],['FS-WEEKEND','Cuối tuần giảm 8%','8%','Sắp chạy','0/200']];
  return '<div class="v2-al g"><i class="ti ti-speakerphone" style="font-size:22px"></i><div><b>Voucher của cửa hàng</b> chỉ áp dụng cho sản phẩm của bạn. Giá nhãn (Xanh −20% · Vàng −50% · Đỏ −80%) do hệ thống tự áp theo hạn sử dụng.</div><span class="v2-btn p go" onclick="tst(\'Tạo voucher\',\'Chức năng sẽ nối API ở bước triển khai\',\'info\')"><i class="ti ti-plus"></i> Tạo voucher</span></div>'+
  '<div class="v2-p"><div class="v2-ph"><div class="v2-pt"><i class="ti ti-ticket"></i>Mã đang quản lý'+sample()+'</div></div><div style="overflow:auto"><table class="v2-t"><thead><tr><th>Mã</th><th>Tên</th><th>Giảm</th><th>Trạng thái</th><th>Đã dùng</th></tr></thead><tbody>'+V.map(function(v){return '<tr><td><b>'+v[0]+'</b></td><td>'+v[1]+'</td><td>'+v[2]+'</td><td><span class="v2-pill '+(v[3]==='Đang chạy'?'g':'y')+'">'+v[3]+'</span></td><td>'+v[4]+'</td></tr>'}).join('')+'</tbody></table></div></div>';
}

/* ---------- KHÁCH HÀNG · KHUYẾN MÃI (dữ liệu thật, Đợt 4b) ---------- */
function loadInto(box,path,after){
  if(DEMO||box.loading||typeof partnerApiRequest!=='function')return;
  box.loading=true;
  partnerApiRequest(path).then(function(d){box.data=d;box.err=''}).catch(function(e){box.err=(e&&e.message)||'Không tải được dữ liệu.'})
    .then(function(){box.at=Date.now();box.loading=false;if(pg===after)R()});
}
function ensureBox(box,path,after,force){
  // Chống gọi dồn dập: vừa có dữ liệu / vừa lỗi (<15 giây) thì không gọi lại; chỉ nút Thử lại / Làm mới mới ép gọi
  if(!force&&(box.err||box.data)&&Date.now()-(box.at||0)<15000)return;
  loadInto(box,path,after);
}
function boxMsg(box,loadingText,retry){
  return '<div class="v2-p"><div class="v2-pb" style="text-align:center;color:#6b7a70;padding:46px">'+(box.err?esc(box.err)+' <span class="v2-btn" onclick="'+retry+'">Thử lại</span>':loadingText)+'</div></div>';
}
var CUSTR={data:null,loading:false,err:'',at:0};
window.custReload=function(){CUSTR.err='';ensureBox(CUSTR,'/partner/customers','customers',true);R()};
function pCust(){
  if(DEMO)return pCustDemo();
  ensureBox(CUSTR,'/partner/customers','customers',false);
  var d=CUSTR.data;
  if(!d)return boxMsg(CUSTR,'Đang tải khách hàng…','custReload()');
  var items=d.items||[];
  var back=items.filter(function(c){return c.completed>=2}).length;
  var ns=items.reduce(function(t,c){return t+c.no_show},0), spent=items.reduce(function(t,c){return t+c.spent_cents},0);
  var rows=items.map(function(c){
    return '<tr><td><b>'+esc(c.name)+'</b></td><td>'+esc(c.phone_masked||'—')+'</td><td>'+c.orders+'</td><td>'+c.completed+'</td><td>'+c.cancelled+'</td><td><span class="v2-pill '+(c.no_show?'r':'g')+'">'+c.no_show+'</span></td><td>'+money(c.spent_cents)+'</td><td>'+new Date(c.last_order_at).toLocaleDateString('vi-VN')+'</td></tr>';
  }).join('')||'<tr><td colspan="8" style="text-align:center;color:#6b7a70;padding:24px">Chưa có khách nào đặt hàng tại cửa hàng của bạn.</td></tr>';
  return '<div class="v2-g v2-g4 v2-m">'+kpi('Khách đã đặt',String(d.total),'Từ trước đến nay','#111512','ti-users','customers')+kpi('Khách quay lại',items.length?Math.round(back/items.length*100)+'%':'—','Từ 2 đơn hoàn tất trở lên','var(--green-700)','ti-repeat','customers')+kpi('Vắng mặt',String(ns),'Tổng các lần','var(--red)','ti-user-off','customers')+kpi('Đã chi tại cửa hàng',short(spent),'Các đơn hoàn tất','#0b6aa6','ti-coin','customers')+'</div>'+
  '<div class="v2-p"><div class="v2-ph"><div class="v2-pt"><i class="ti ti-users"></i>Khách hàng của cửa hàng</div><span class="v2-link" onclick="custReload()">Làm mới →</span></div><div style="overflow:auto"><table class="v2-t"><thead><tr><th>Khách</th><th>Điện thoại</th><th>Số đơn</th><th>Hoàn tất</th><th>Hủy</th><th>Vắng mặt</th><th>Đã chi</th><th>Mua gần nhất</th></tr></thead><tbody>'+rows+'</tbody></table></div><div class="v2-pb"><div class="v2-note">Chỉ hiện khách đã đặt đơn tại cửa hàng của bạn. Số điện thoại được che một phần ngay từ máy chủ để bảo vệ quyền riêng tư của người mua.</div></div></div>';
}

var VCHR={data:null,loading:false,err:'',at:0};
var VSTATE={live:['g','Đang chạy'],scheduled:['b','Sắp chạy'],expired:['m','Hết hạn'],used_up:['y','Hết lượt'],off:['m','Đã tắt']};
window.vchReload=function(){VCHR.err='';ensureBox(VCHR,'/partner/vouchers','promo',true);R()};
window.v2VoucherToggle=function(id,on){
  partnerApiRequest('/partner/vouchers/'+encodeURIComponent(id),{method:'PATCH',body:{is_active:on}})
    .then(function(){tst(on?'Đã bật voucher':'Đã tắt voucher','','info');vchReload()})
    .catch(function(e){tst('Không cập nhật được',(e&&e.message)||'','info')});
};
window.v2NewVoucher=function(){
  var f=function(l,id,t,ph){return '<label style="display:block;font-size:12px;font-weight:700;margin-bottom:8px">'+l+'<br><input id="'+id+'" type="'+(t||'text')+'" placeholder="'+(ph||'')+'" class="inp" style="width:100%"></label>'};
  modal('Tạo voucher cửa hàng',f('Mã (3-30 ký tự)','vc_code','text','GIAM10')+f('Tên','vc_name','text','Giảm 10% đơn đầu')+
    '<label style="display:block;font-size:12px;font-weight:700;margin-bottom:8px">Loại giảm<br><select id="vc_type" class="inp" style="width:100%"><option value="percent">Giảm theo %</option><option value="fixed">Giảm số tiền (đ)</option></select></label>'+
    f('Giá trị (% hoặc đ)','vc_val','number','10')+f('Đơn tối thiểu (đ, tùy chọn)','vc_min','number')+f('Số lượt tối đa (tùy chọn)','vc_max','number')+f('Bắt đầu','vc_from','datetime-local')+f('Kết thúc','vc_to','datetime-local')+
    '<button class="btn btn-g btn-lg" style="width:100%;justify-content:center" onclick="v2SaveVoucher()"><i class="ti ti-check"></i> Tạo voucher</button>');
};
window.v2SaveVoucher=function(){
  var g=function(id){return String((document.getElementById(id)||{}).value||'').trim()};
  var val=Math.round(Number(g('vc_val')));
  if(!g('vc_code')||!g('vc_name')||!(val>0)||!g('vc_from')||!g('vc_to')){tst('Thiếu thông tin','Nhập mã, tên, giá trị và thời gian','info');return;}
  var body={code:g('vc_code'),name:g('vc_name'),starts_at:new Date(g('vc_from')).toISOString(),expires_at:new Date(g('vc_to')).toISOString()};
  if(g('vc_type')==='percent')body.percent_off=val;else body.fixed_discount_cents=val;
  if(g('vc_min'))body.min_order_cents=Math.round(Number(g('vc_min')));
  if(g('vc_max'))body.max_redemptions=Math.round(Number(g('vc_max')));
  partnerApiRequest('/partner/vouchers',{method:'POST',body:body})
    .then(function(){closeM();tst('Đã tạo voucher','Khách nhập mã khi thanh toán','info');vchReload()})
    .catch(function(e){tst('Không tạo được voucher',(e&&e.message)||'','info')});
};
function pPromo(){
  if(DEMO)return pPromoDemo();
  ensureBox(VCHR,'/partner/vouchers','promo',false);
  var d=VCHR.data;
  if(!d)return boxMsg(VCHR,'Đang tải voucher…','vchReload()');
  var rows=d.map(function(v){
    var st=VSTATE[v.state]||['m',v.state];
    return '<tr><td><b>'+esc(v.code)+'</b></td><td>'+esc(v.name)+'</td><td>'+(v.percent_off?v.percent_off+'%':money(v.fixed_discount_cents))+(v.min_order_cents?'<br><small style="color:#6b7a70">đơn từ '+money(v.min_order_cents)+'</small>':'')+'</td><td><span class="v2-pill '+st[0]+'">'+st[1]+'</span></td><td>'+v.redemption_count+(v.max_redemptions?'/'+v.max_redemptions:'')+'</td><td>'+new Date(v.expires_at).toLocaleDateString('vi-VN')+'</td><td><span class="v2-btn" onclick="v2VoucherToggle(\''+esc(v.id)+'\','+(v.is_active?'false':'true')+')">'+(v.is_active?'Tắt':'Bật')+'</span></td></tr>';
  }).join('')||'<tr><td colspan="7" style="text-align:center;color:#6b7a70;padding:24px">Chưa có voucher nào. Bấm "Tạo voucher" để bắt đầu.</td></tr>';
  return '<div class="v2-al g"><i class="ti ti-speakerphone" style="font-size:22px"></i><div><b>Voucher của cửa hàng</b> chỉ áp dụng cho sản phẩm của bạn. Giá nhãn (Xanh −20% · Vàng −50% · Đỏ −80%) do hệ thống tự áp theo hạn sử dụng.</div><span class="v2-btn p go" onclick="v2NewVoucher()"><i class="ti ti-plus"></i> Tạo voucher</span></div>'+
  '<div class="v2-p"><div class="v2-ph"><div class="v2-pt"><i class="ti ti-ticket"></i>Mã đang quản lý</div><span class="v2-link" onclick="vchReload()">Làm mới →</span></div><div style="overflow:auto"><table class="v2-t"><thead><tr><th>Mã</th><th>Tên</th><th>Giảm</th><th>Trạng thái</th><th>Đã dùng</th><th>Hết hạn</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
}

/* ---------- trang MỚI: NHẬN HÀNG · QR ---------- */
function pPickup(){
  var q=ORD.filter(function(o){return o.st==='ready'||o.st==='confirmed'||o.st==='new'});
  return '<div class="v2-g v2-g21"><div class="v2-p"><div class="v2-ph"><div class="v2-pt"><i class="ti ti-qrcode"></i>Xác nhận khách nhận hàng</div></div><div class="v2-pb" style="text-align:center"><i class="ti ti-scan" style="font-size:54px;color:#1c7c45"></i><p style="font-size:12.5px;color:#6b7a70;font-weight:600;margin:6px 0 12px">Nhập mã nhận hàng hoặc quét QR trên điện thoại khách.</p><input id="v2pc" class="inp" placeholder="VD: FS-2403" style="text-align:center;font-weight:900;font-size:16px;max-width:280px;margin:0 auto 12px"><br><span class="v2-btn p" onclick="v2Pick()"><i class="ti ti-check"></i> Xác nhận đã giao</span> <span class="v2-btn" onclick="v2StartScan()"><i class="ti ti-camera"></i> Quét bằng camera</span><div id="v2scanpanel" style="display:none;margin-top:12px"><video id="v2scanvideo" playsinline muted style="width:100%;max-width:320px;height:220px;object-fit:cover;border-radius:12px;background:#111"></video><div id="v2scanstatus" style="font-size:12px;font-weight:700;color:#6b7a70;margin-top:6px"></div><span class="v2-btn" onclick="v2StopScan()"><i class="ti ti-x"></i> Tắt camera</span></div></div></div>'+
  '<div class="v2-p"><div class="v2-ph"><div class="v2-pt"><i class="ti ti-hourglass"></i>Đang chờ khách đến ('+q.length+')</div></div>'+(q.map(function(o){return '<div class="v2-row"><div class="v2-ic" style="background:'+lB(o.l)+'">'+(o.lines&&o.lines[0]?o.lines[0].emoji:'🍱')+'</div><div><div class="t">'+o.code+' · '+esc(o.c)+'</div><div class="s">'+esc(o.slot)+'</div></div><div class="r">'+(o.pickupDeadline?cd(o.pickupDeadline,'',30,15):'')+'</div></div>'}).join('')||'<div class="v2-pb" style="text-align:center;color:#6b7a70">Không có đơn nào đang chờ.</div>')+'</div></div>';
}
var scanTimer=null, scanStream=null, scanBusy=false;
window.v2StopScan=function(){
  if(scanTimer){clearInterval(scanTimer);scanTimer=null}
  if(scanStream){scanStream.getTracks().forEach(function(t){t.stop()});scanStream=null}
  var v=$('#v2scanvideo');if(v)v.srcObject=null;
  var p=$('#v2scanpanel');if(p)p.style.display='none';
};
window.v2StartScan=async function(){
  var panel=$('#v2scanpanel'),video=$('#v2scanvideo'),status=$('#v2scanstatus');
  if(!panel||!video||!status)return;
  panel.style.display='block';
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){status.style.color='var(--red)';status.textContent='Trình duyệt chưa hỗ trợ camera. Hãy nhập mã thủ công.';return;}
  v2StopScan();panel.style.display='block';
  status.style.color='#6b7a70';status.textContent='Đang mở camera...';
  try{
    try{scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false})}
    catch(err){scanStream=await navigator.mediaDevices.getUserMedia({video:true,audio:false})}
    video.srcObject=scanStream;await video.play();
    if(!('BarcodeDetector' in window)){status.textContent='Camera đã bật nhưng trình duyệt này chưa hỗ trợ tự quét QR. Hãy nhập mã thủ công.';return;}
    var formats=['qr_code','code_128'];
    if(BarcodeDetector.getSupportedFormats){var sup=await BarcodeDetector.getSupportedFormats();formats=formats.filter(function(f){return sup.indexOf(f)>=0})}
    var det=formats.length?new BarcodeDetector({formats:formats}):new BarcodeDetector();
    status.textContent='Đưa mã QR của khách vào khung quét.';
    scanTimer=setInterval(async function(){
      if(scanBusy||video.readyState<2)return;
      scanBusy=true;
      try{
        var codes=await det.detect(video);
        if(codes&&codes.length&&codes[0].rawValue){
          var raw=String(codes[0].rawValue).trim();
          v2StopScan();
          var inp=$('#v2pc');if(inp)inp.value=raw;
          var o=ORD.filter(function(x){return String(x.code).toLowerCase()===raw.toLowerCase()&&['ready','confirmed'].indexOf(x.st)>=0})[0];
          if(!o){tst('Không tìm thấy','Mã QR không khớp đơn nào đang chờ giao','info');}
          else if(confirm('Giao hàng cho '+o.c+' (đơn '+o.id+', '+money(o.p)+')?'))v2Pick();
        }
      }catch(err){}finally{scanBusy=false}
    },450);
  }catch(err){
    status.style.color='var(--red)';status.textContent='Không mở được camera. Hãy kiểm tra quyền camera hoặc nhập mã thủ công.';
  }
};
window.v2Pick=function(){
  var v=($('#v2pc')||{}).value||'',o=ORD.filter(function(x){return String(x.code).toLowerCase()===v.trim().toLowerCase()&&['ready','confirmed'].indexOf(x.st)>=0})[0];
  if(!o){tst('Không tìm thấy','Mã không đúng hoặc đơn chưa sẵn sàng','info');return;}
  var i=ORD.indexOf(o);selO=i;oP=o.st;
  if(DEMO){orderConfirmPickup();return;}
  // Mã đã khớp đơn: gửi xác nhận lên Backend (kiểm tra hạn lấy hàng ở phía máy chủ)
  orderSetStatus('done','Giao hàng thành công',money(o.p)+' đã được ghi nhận');
};

/* ---------- đăng ký trang & điều hướng ---------- */
pDash=pDashV2;pOrders=pOrdersV2;
pWallet=DEMO?pWalletV2:pWalletReal;   // Ví: dữ liệu thật ở chế độ thường (Đợt 2)
pComplaints=pComplaintsV2;   // Khiếu nại: dữ liệu thật ở chế độ thường (Đợt 3)
window.pCust=pCust;window.pPromo=pPromo;window.pPickup=pPickup;
(function(){
  var add=function(after,n){var i=NAV.findIndex(function(x){return x.id===after});if(NAV.findIndex(function(x){return x.id===n.id})<0)NAV.splice(i+1,0,n)};
  add('orders',{id:'pickup',l:'Nhận hàng · QR',i:'ti-qrcode',cat:'core'});
  add('inv',{id:'customers',l:'Khách hàng',i:'ti-users',cat:'core'});
  add('marketing',{id:'promo',l:'Khuyến mãi',i:'ti-ticket',cat:'impact'});
})();

/* sau mỗi lần R(): đồng hồ đếm ngược + khối chi tiết đơn; bổ sung tên trang cho trang mới */
var _R=R;
R=function(){
  _R();
  var t={pickup:'Nhận hàng · Xác nhận QR',customers:'Khách hàng',promo:'Khuyến mãi · Voucher'};
  if(pg!=='pickup')v2StopScan();
  if(t[pg])$('#pt').textContent=t[pg];
  if(['pickup','customers','promo'].indexOf(pg)>=0){var m={pickup:pPickup,customers:pCust,promo:pPromo};$('#ct').innerHTML=m[pg]();}
  orderExtra();tickCd();
};

/* ---------- thao tác thật (ngoài demo) ---------- */
if(!DEMO){
  // Cửa hàng chỉ đánh dấu vắng mặt được SAU hạn lấy hàng; máy chủ kiểm tra lại, chuyển đơn sang "Vắng mặt", không hoàn tiền
  noShow=function(){
    var o=ORD[selO];if(!o)return;
    if(o.pickupDeadline&&Date.now()<o.pickupDeadline+5*MIN){tst('Chưa quá hạn lấy hàng','Bạn chỉ đánh dấu vắng mặt được sau khi hết hạn lấy hàng + 5 phút châm chước','info');return;}
    modal('Khách vắng mặt','<p style="font-size:13.5px;color:var(--muted);margin-bottom:16px;line-height:1.7;font-weight:500">Khách không đến lấy hàng trong hạn? Đơn chuyển sang <b>Vắng mặt</b>: <b>không hoàn tiền</b> cho khách, tiền đơn (trừ phí) thuộc về cửa hàng và khách bị trừ 15 điểm uy tín.</p><button class="btn btn-r btn-lg" style="width:100%;justify-content:center;margin-bottom:10px" onclick="closeM();orderSetStatus(\'no_show\',\'Đã đánh dấu vắng mặt\',\'Không hoàn tiền · khách bị trừ điểm uy tín\')"><i class="ti ti-user-off"></i> Xác nhận vắng mặt</button><button class="btn btn-o btn-lg" style="width:100%;justify-content:center" onclick="closeM()">Chờ thêm</button>');
  };
  cancelOrder=function(){
    modal('Hủy đơn hàng','<p style="font-size:13.5px;color:var(--muted);margin-bottom:16px;line-height:1.7;font-weight:500">Cửa hàng hủy đơn đã thanh toán: khách được <b>hoàn 100%</b> và cửa hàng bị trừ <b>15 điểm uy tín</b>.</p><div style="display:flex;flex-direction:column;gap:10px"><button class="btn btn-r btn-lg" style="width:100%;justify-content:center" onclick="closeM();orderSetStatus(\'cancelled\',\'Đã hủy đơn\',\'Đã hoàn tiền 100% cho khách\')"><i class="ti ti-building-store"></i> Xác nhận hủy đơn</button><button class="btn btn-o btn-lg" style="width:100%;justify-content:center" onclick="closeM()"><i class="ti ti-arrow-left"></i> Không hủy</button></div>');
  };
  // Số tin chưa đọc theo đơn: cập nhật cùng nhịp làm mới danh sách đơn
  var _after=window.foodsaveAfterOrdersReplace;
  window.foodsaveAfterOrdersReplace=function(sel){
    if(typeof _after==='function')_after(sel);
    if(typeof partnerApiRequest!=='function')return;
    partnerApiRequest('/orders/chat/unread').then(function(map){
      var changed=JSON.stringify(map||{})!==JSON.stringify(UNREAD);
      UNREAD=map||{};
      if(changed&&pg==='orders'&&selO===null){var typing=document.activeElement&&/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);if(!typing)R();}
    }).catch(function(){});
  };
}

/* ---------- chế độ demo: thao tác cục bộ, không gọi API ---------- */
if(DEMO){
  seed();
  orderSetStatus=function(st,title,desc){if(selO===null)return;ORD[selO].st=st;oP=st;tst(title,desc,'order');R()};
  orderConfirmPickup=function(){if(selO===null)return;ORD[selO].st='done';ORD[selO].pickupDeadline=0;oP='done';tst('Đã giao hàng','Tiền được chuyển từ giữ chờ vào ví cửa hàng','order');R()};
  noShow=function(){if(selO===null)return;ORD[selO].st='no_show';ORD[selO].pickupDeadline=0;oP='no_show';tst('Đã đánh dấu vắng mặt','Không hoàn tiền · khách bị trừ 15 điểm','info');R()};
  cancelOrder=function(){if(selO===null)return;ORD[selO].st='cancelled';oP='cancelled';tst('Đã hủy đơn','Hoàn 100% cho khách (cửa hàng hủy)','info');R()};
  resolveComplaint=function(id,a){var c=COMPLAINTS.find(function(x){return x.id===id});if(!c)return;
    var m={refund:['resolved','Cửa hàng đồng ý hoàn tiền.'],voucher:['resolved','Bồi thường bằng voucher.'],explain:['in-review','Cửa hàng đang giải thích với khách.'],escalate:['in-review','Cửa hàng không đồng ý – chuyển Admin quyết định.']}[a];
    c.st=m[0];c.resolution=m[1];c.respondBy=0;tst('Đã phản hồi khiếu nại',m[1],'info');R()};
  var bar=document.createElement('div');bar.className='v2-demo';bar.innerHTML='<span>🧪 <b>Chế độ xem thử</b> · dữ liệu mẫu, không ghi vào hệ thống</span>';document.body.appendChild(bar);
  var go2=function(){try{goView('portal');pg='dash';R()}catch(e){console.error(e)}};
  if(document.readyState==='complete')go2();else window.addEventListener('load',go2);
}
})();

