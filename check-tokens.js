const fs=require('fs');
const line=(fs.readFileSync('.env','utf8').match(/^FACEBOOK_PAGE_TOKENS=(.*)$/m)||[])[1];
const map=JSON.parse(line||'{}');
(async()=>{for(const [id,t] of Object.entries(map)){
const r=await fetch('https://graph.facebook.com/v19.0/me?fields=id,name&access_token='+encodeURIComponent(t));
const j=await r.json();
console.log('Khai bao ID:',id,'-> token that cua:',j.name||('LOI: '+(j.error&&j.error.message)));}})();
