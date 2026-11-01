const $ = (id) => document.getElementById(id);
const pages = ['home','accounts','settings','logs','playground'];
let toastTimer;
let adminKey = '';\nlet accountConfigPending = null;
function toast(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),1900)}
function activate(page){
  for(const name of pages){$('page-'+name).classList.toggle('active',name===page)}
  document.querySelectorAll('[data-page]').forEach(button=>button.classList.toggle('active',button.dataset.page===page));
  $('page-title').textContent=({home:'运行概览',accounts:'账号管理',settings:'运行配置',logs:'运行日志',playground:'API 测试台'})[page];
}
document.querySelectorAll('[data-page]').forEach(button=>button.addEventListener('click',()=>activate(button.dataset.page)));
async function loadStatus(){
  const state=$('service-state'),subtitle=$('service-subtitle');
  try{
    const response=await fetch('/healthz',{cache:'no-store'});
    if(!response.ok)throw new Error('HTTP '+response.status);
    const data=await response.json();
    state.textContent=data.ok?'服务在线':'服务异常';
    state.style.color=data.ok?'#a5f0ce':'#ff897f';
    subtitle.textContent='本地 HTTP 健康检查成功 · PID '+(data.pid??'未知');
    $('engine-value').textContent=data.engine??'—';
    $('uptime-value').textContent=Number.isFinite(data.uptime_s)?formatDuration(data.uptime_s):'—';
    if(data.engine==='direct' && Array.isArray(data.accounts)){const ready=data.accounts.filter(a=>a.powReady).length;$('pow-value').textContent=ready+'/'+data.accounts.length+' 就绪'}else{$('pow-value').textContent='不适用'}
    $('version-value').textContent=data.version??'—';
    renderAccounts(data);
  }catch(error){
    state.textContent='服务不可用';state.style.color='#ff897f';subtitle.textContent=error.message;
    for(const id of ['engine-value','uptime-value','pow-value','version-value'])$(id).textContent='—';
  }
}
async function adminRequest(path,options={}){
  if(!adminKey)throw new Error('请先验证管理密钥');
  const headers={...(options.headers||{}),Authorization:'Bearer '+adminKey};
  const response=await fetch(path,{...options,headers});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(payload.error?.message||('HTTP '+response.status));
  return payload;
}
async function unlockAdmin(){
  const candidate=$('admin-key').value.trim();
  if(!candidate){toast('请输入管理密钥');return}
  const previous=adminKey;adminKey=candidate;
  try{accountConfigPending=await adminRequest('/admin/accounts');$('account-actions').hidden=false;toast('管理权限已验证');loadStatus()}
  catch(error){adminKey=previous;$('account-actions').hidden=true;toast(error.message)}
}
function readTokenLines(){
  return $('account-token-input').value.split(/[\r\n,;]+/).map(x=>x.trim()).filter(Boolean);
}
async function mutateAccounts(action){
  try{
    const payload={action};
    if(action==='add'||action==='replace')payload.tokens=readTokenLines();
    if(action==='remove')return;
    const result=await adminRequest('/admin/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    toast(result.message||'账号配置已保存，需要重启服务');
    $('account-token-input').value='';
    loadStatus();
  }catch(error){toast(error.message)}
}
async function checkAccountPool(){
  if(!confirm('将通过当前引擎发送一次真实 DeepSeek 测试请求，可能消耗账号额度。继续吗？'))return;
  try{const result=await adminRequest('/admin/accounts/check',{method:'POST'});toast(result.ok?'账号池校验成功':'账号池校验未通过')}
  catch(error){toast(error.message)}
}
$('admin-unlock').addEventListener('click',unlockAdmin);
$('account-add').addEventListener('click',()=>mutateAccounts('add'));
$('account-replace').addEventListener('click',()=>mutateAccounts('replace'));
$('account-check').addEventListener('click',checkAccountPool);
function renderAccounts(data){
  const host=$('account-summary');
  if(!host)return;
  if(data.engine==='direct' && Array.isArray(data.accounts)){
    if(!data.accounts.length){host.innerHTML='<div class="empty-card"><p>账号池为空。请使用现有 CLI 配置 userToken。</p></div>';return}
    host.replaceChildren(...accounts.map(account=>{
      const card=document.createElement('article');card.className='account-card';
      const head=document.createElement('div');head.className='account-head';
      const name=document.createElement('strong');name.textContent='账号 #'+account.index;
      const status=document.createElement('span');status.className='status-pill';status.textContent=accountConfigPending?.restartRequired?'待重启':(account.statusUnavailable?'状态不可用':(account.authFailed?'登录态失效':(account.available?'可用':'冷却中')));
      head.append(name,status);
      const token=document.createElement('code');token.textContent=account.token||'Token 已配置';
      const stats=document.createElement('div');stats.className='account-stats';
      for(const [label,value] of [['请求',account.requests],['限流',account.limited],['错误',account.errors],['PoW',account.powReady?'已预热':'未预热'],['会话',account.sessionsReady]]){
        const item=document.createElement('span');item.textContent=label+'：'+(account.statusUnavailable?'—':(value??0));stats.append(item);
      }
      card.append(head,token,stats);
      if(account.cooldownMs>0){const cooldown=document.createElement('p');cooldown.className='account-error';cooldown.textContent='剩余冷却 '+Math.ceil(account.cooldownMs/1000)+' 秒';card.append(cooldown)}
      if(account.lastError){const error=document.createElement('p');error.className='account-error';error.textContent='最近错误：'+account.lastError;card.append(error)}
      if(adminKey){const remove=document.createElement('button');remove.type='button';remove.className='remove-account';remove.textContent='移除';remove.addEventListener('click',()=>removeAccount(account.index));card.append(remove)}
      return card;
    }));
    return;
  }
  const card=document.createElement('article');card.className='account-card';
  const title=document.createElement('strong');title.textContent='Browser 引擎';
  const detail=document.createElement('p');detail.textContent='当前引擎使用单一配置登录态；原有 Browser 状态不提供 Direct 账号池的轮换遥测。';
  const token=document.createElement('span');token.className='status-pill';token.textContent=data.token?'登录态已配置':'尚未配置登录态';
  card.append(title,detail,token);host.replaceChildren(card);
}
async function removeAccount(index){
  if(!confirm('确定移除账号 #'+index+'？当前运行中的引擎需要重启后生效。'))return;
  try{const result=await adminRequest('/admin/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'remove',index})});accountConfigPending=await adminRequest('/admin/accounts');toast(result.message||'账号已移除，需要重启服务');loadStatus()}
  catch(error){toast(error.message)}
}
function formatDuration(seconds){const s=Math.max(0,Math.floor(seconds));if(s<60)return s+' 秒';if(s<3600)return Math.floor(s/60)+' 分钟';return Math.floor(s/3600)+' 小时 '+Math.floor(s%3600/60)+' 分钟'}
$('refresh').addEventListener('click',()=>{loadStatus();toast('状态已刷新')});
document.querySelectorAll('[data-copy]').forEach(button=>button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.origin+button.dataset.copy);toast('接口地址已复制')}catch{toast('复制失败')}}));
$('clear-output').addEventListener('click',()=>{$('response-output').textContent='';$('response-meta').textContent='已清空'});
$('send').addEventListener('click',sendRequest);
async function sendRequest(){
  const button=$('send'),output=$('response-output'),meta=$('response-meta');
  const prompt=$('prompt').value.trim(),model=$('model').value.trim()||'deepseek-flash',stream=$('stream').checked,key=$('api-key').value;
  if(!prompt){toast('请先输入提示词');return}
  button.disabled=true;button.textContent='请求中…';output.textContent='';meta.textContent='连接本地 API…';
  const started=performance.now();
  try{
    const headers={'Content-Type':'application/json'};
    if(key)headers.Authorization='Bearer '+key;
    const response=await fetch('/v1/chat/completions',{method:'POST',headers,body:JSON.stringify({model,stream,messages:[{role:'user',content:prompt}]})});
    if(!response.ok){const body=await response.text();throw new Error('HTTP '+response.status+' · '+body.slice(0,1200))}
    if(!stream){const data=await response.json();output.textContent=data.choices?.[0]?.message?.content??JSON.stringify(data,null,2);meta.textContent='完成 · '+Math.round(performance.now()-started)+' ms';return}
    if(!response.body)throw new Error('当前浏览器不支持流式响应');
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',content='';
    while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const blocks=buffer.split('\n\n');buffer=blocks.pop()??'';
      for(const block of blocks){for(const line of block.split('\n')){if(!line.startsWith('data:'))continue;const payload=line.slice(5).trim();if(!payload||payload==='[DONE]')continue;let item;try{item=JSON.parse(payload)}catch{continue}const delta=item.choices?.[0]?.delta;if(delta?.content){content+=delta.content;output.textContent=content}if(item.error)throw new Error(item.error.message??'流式请求失败')}}
      meta.textContent='接收中 · '+content.length+' 字符';
    }
    meta.textContent='完成 · '+content.length+' 字符 · '+Math.round(performance.now()-started)+' ms';
  }catch(error){output.textContent=error.message;meta.textContent='请求失败';}
  finally{button.disabled=false;button.innerHTML='发送请求 <span>↗</span>'}
}
loadStatus();
setInterval(loadStatus,15000);
