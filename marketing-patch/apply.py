#!/usr/bin/env python3
"""Áp giao diện Marketing mới vào FOODSAVE_PARTNER.html (có backup). Dùng: python apply.py <đường dẫn FOODSAVE_PARTNER.html>"""
import re,sys,shutil,os
here=os.path.dirname(os.path.abspath(__file__))
tgt=sys.argv[1]
src=open(tgt,encoding='utf-8').read()
if 'Marketing Studio v3' in src: sys.exit('Đã áp patch rồi, không làm lại.')
shutil.copy(tgt,tgt+'.bak-truoc-marketing-v3')
js=open(os.path.join(here,'pmkt-v2.js'),encoding='utf-8').read()
css=open(os.path.join(here,'pmkt-v2.css'),encoding='utf-8').read()
lines=src.split('\n')
start=next(i for i,l in enumerate(lines) if l.startswith('let MKT={'))
end=next(i for i,l in enumerate(lines) if l.startswith('function pDona('))
block=lines[start:end]
drop={'MKT','mktSetTab','pMkt','mktOverview','mktReport','mktConnPick','mktConnect','mktOpenStudio','mktRenderStudio','mktTab','mktPublish','mktKpis','mktExportCsv','mktQuickPush','mktSendList'}
decl=re.compile(r'^(?:async function|function|const|let)\s+([A-Za-z0-9_]+)')
out=[];skip=False;inserted=False
for l in block:
    m=decl.match(l)
    if m:
        skip=m.group(1) in drop
        if skip and not inserted: out.append('//__MKT_V3__'); inserted=True
    elif skip and l.startswith('//') : skip=False
    if not skip: out.append(l)
new='\n'.join(out).replace('//__MKT_V3__',js)
res='\n'.join(lines[:start])+'\n'+new+'\n'+'\n'.join(lines[end:])
for a,b in [('để nhắc người mua trong app và đăng lên các kênh đang dùng.','để đăng lên các nền tảng đang dùng.'),
            ("  const channels=mktSendList();\n","  const channels=mktSendList();\n  if(!channels.length){tst('Chưa có nền tảng','Hãy bật ít nhất một nền tảng ở Thiết lập đăng bài','info');return;}\n")]:
    if a not in res: sys.exit('Không tìm thấy đoạn cần sửa: '+a[:40])
    res=res.replace(a,b,1)
res=res.replace('</style>','\n'+css+'\n</style>',1)
open(tgt,'w',encoding='utf-8').write(res)
print('Xong. Backup: '+tgt+'.bak-truoc-marketing-v3')
