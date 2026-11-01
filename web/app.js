const $ = (id) => document.getElementById(id);
const pages = ['home','accounts','settings','logs','playground'];
let toastTimer;
let adminKey = '';
let accountConfigPending = null;
let logAbortController = null;
let logPaused = true;
let logEntries = [];
let logAfter = 0;
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
  if(action==='replace' && !confirm('这会替换整个账号池，当前运行中的引擎需重启后生效。继续吗？'))return;
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
function renderLogs(){
  const host=$('logs-output');
  host.replaceChildren(...logEntries.map(entry=>{
    const row=document.createElement('article');row.className='log-row level-'+entry.level;
    const meta=document.createElement('div');meta.className='log-row-meta';
    const time=document.createElement('time');time.textContent=entry.timestamp;
    const level=document.createElement('strong');level.textContent=entry.level.toUpperCase();
    const scope=document.createElement('span');scope.textContent=entry.scope||'app';
    meta.append(time,level,scope);
    const message=document.createElement('pre');message.textContent=entry.message;
    row.append(meta,message);return row;
  }));
  host.scrollTop=host.scrollHeight;
}
function appendLog(entry){
  if(logEntries.some(item=>item.id===entry.id))return;
  logEntries.push(entry);logEntries.sort((a,b)=>a.id-b.id);
  if(logEntries.length>500)logEntries=logEntries.slice(-500);
  logAfter=Math.max(logAfter,entry.id);renderLogs();
}
async function loadLogs(){
  const level=$('log-level').value;
  const result=await adminRequest('/admin/logs?limit=200&level='+encodeURIComponent(level));
  logEntries=result.entries||[];logAfter=result.nextAfter||logAfter;renderLogs();
}
async function runLogStream(){
  while(!logPaused && adminKey){
    const controller=new AbortController();logAbortController=controller;
    try{
      const level=$('log-level').value;
      const response=await fetch('/admin/logs/stream?after='+logAfter+'&level='+encodeURIComponent(level),{headers:{Authorization:'Bearer '+adminKey},signal:controller.signal});
      if(!response.ok)throw new Error('日志流 HTTP '+response.status);
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
      $('logs-meta').textContent='实时连接中 · 最近 '+logEntries.length+' 条';
      while(!logPaused){
        const {value,done}=await reader.read();if(done)break;
        buffer+=decoder.decode(value,{stream:true});
        const blocks=buffer.split(/\r?\n\r?\n/);buffer=blocks.pop()??'';
        for(const block of blocks){
          const data=block.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
          if(!data)continue;
          try{appendLog(JSON.parse(data))}catch{}
        }
      }
    }catch(error){
      if(!logPaused)$('logs-meta').textContent='日志连接中断，正在重连…';
    }
    if(!logPaused)await new Promise(resolve=>setTimeout(resolve,1200));
  }
}
async function startLogs(){
  if(!adminKey){toast('请先在账号管理页验证管理密钥');return}
  logPaused=true;logAbortController?.abort();
  try{
    await loadLogs();logPaused=false;
    $('logs-meta').textContent='已连接，等待新日志…';
    runLogStream();
  }catch(error){$('logs-meta').textContent=error.message;toast(error.message)}
}
function pauseLogs(){
  logPaused=true;logAbortController?.abort();$('logs-meta').textContent='已暂停 · '+logEntries.length+' 条';
}
$('logs-start').addEventListener('click',startLogs);
$('logs-pause').addEventListener('click',pauseLogs);
$('logs-clear').addEventListener('click',()=>{logEntries=[];renderLogs();$('logs-meta').textContent='视图已清空；服务端日志未删除'});
$('log-level').addEventListener('change',()=>{if(!logPaused)startLogs();else loadLogs().catch(error=>toast(error.message))});
async function loadRuntimeConfig(){
  try{
    const result=await adminRequest('/admin/config');
    $('config-json').value=JSON.stringify(result.values,null,2);
    $('config-state').textContent=result.restartRequired?'有尚未重启生效的配置变更。':'当前配置已加载。';
  }catch(error){$('config-state').textContent=error.message;toast(error.message)}
}
async function saveRuntimeConfig(){
  let values;
  try{values=JSON.parse($('config-json').value)}catch(error){toast('配置 JSON 格式错误：'+error.message);return}
  if(!values||typeof values!=='object'||Array.isArray(values)){toast('配置必须是 JSON 对象');return}
  if(!confirm('保存后会写入 .env；当前服务不会热更新，需要重启后生效。继续吗？'))return;
  try{
    const result=await adminRequest('/admin/config',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({values})});
    $('config-json').value=JSON.stringify(result.values,null,2);
    $('config-state').textContent=result.message||'配置已保存，等待重启。';
    toast('配置已保存，重启后生效');
  }catch(error){$('config-state').textContent=error.message;toast(error.message)}
}
$('config-load').addEventListener('click',loadRuntimeConfig);
$('config-save').addEventListener('click',saveRuntimeConfig);
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
const requestSamples={
  '/v1/chat/completions':{model:'deepseek-flash',stream:true,messages:[{role:'user',content:'你好，请用一句话介绍自己。'}]},
  '/v1/completions':{model:'deepseek-flash',prompt:'用一句话介绍自己。',stream:true},
  '/v1/messages':{model:'deepseek-flash',max_tokens:1024,stream:true,messages:[{role:'user',content:'你好，请用一句话介绍自己。'}]},
  '/v1/messages/count_tokens':{model:'deepseek-flash',max_tokens:1024,messages:[{role:'user',content:'估算这条消息的 token 数。'}]},
};
function updateRequestSample(){
  const endpoint=$('endpoint').value;
  $('request-body').disabled=endpoint==='/v1/models'||endpoint==='/healthz';
  $('request-body').value=requestSamples[endpoint]?JSON.stringify(requestSamples[endpoint],null,2):'';
}
$('endpoint').addEventListener('change',updateRequestSample);
updateRequestSample();
$('send').addEventListener('click',sendRequest);
function sseData(block){
  const lines=block.split(/\\r?\\n/);
  const event=lines.find(line=>line.startsWith('event:'))?.slice(6).trim()||'message';
  const data=lines.filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\\n');
  return {event,data};
}
async function sendRequest(){
  const button=$('send'),output=$('response-output'),meta=$('response-meta');
  const endpoint=$('endpoint').value,key=$('api-key').value;
  const method=(endpoint==='/v1/models'||endpoint==='/healthz')?'GET':'POST';
  let requestBody=null;
  if(method==='POST'){
    try{requestBody=JSON.parse($('request-body').value)}catch(error){toast('请求体 JSON 格式错误：'+error.message);return}
    if(!requestBody||typeof requestBody!=='object'||Array.isArray(requestBody)){toast('请求体必须是 JSON 对象');return}
  }
  const anthropic=endpoint.startsWith('/v1/messages');
  const headers={};
  if(method==='POST')headers['Content-Type']='application/json';
  if(key){if(anthropic){headers['x-api-key']=key;headers['anthropic-version']='2023-06-01'}else{headers.Authorization='Bearer '+key}}
  button.disabled=true;button.textContent='请求中…';output.textContent='';meta.textContent=method+' '+endpoint+' · 连接中…';
  const started=performance.now();
  try{
    const response=await fetch(endpoint,{method,headers,body:method==='POST'?JSON.stringify(requestBody):undefined});
    const contentType=response.headers.get('content-type')||'';
    if(!response.ok){const body=await response.text();output.textContent=body;meta.textContent='HTTP '+response.status+' · '+Math.round(performance.now()-started)+' ms';return}
    if(!contentType.includes('text/event-stream')){
      const text=await response.text();
      try{output.textContent=JSON.stringify(JSON.parse(text),null,2)}catch{output.textContent=text}
      meta.textContent='HTTP '+response.status+' · '+Math.round(performance.now()-started)+' ms';
      return;
    }
    if(!response.body)throw new Error('当前 WebView 不支持流式响应');
    const reader=response.body.getReader(),decoder=new TextDecoder();
    let buffer='',events=0;
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      buffer+=decoder.decode(value,{stream:true});
      const blocks=buffer.split(/\\r?\\n\\r?\\n/);
      buffer=blocks.pop()??'';
      for(const block of blocks){
        if(!block.trim())continue;
        const item=sseData(block);events++;
        output.textContent+=((output.textContent?'\\n\\n':'' )+(item.event==='message'?'':'event: '+item.event+'\\n')+'data: '+item.data);
      }
      meta.textContent='HTTP '+response.status+' · '+events+' 个 SSE 事件 · '+Math.round(performance.now()-started)+' ms';
    }
    if(buffer.trim()){const item=sseData(buffer);output.textContent+='\\n\\n'+(item.event==='message'?'':'event: '+item.event+'\\n')+'data: '+item.data;events++}
    meta.textContent='HTTP '+response.status+' · '+events+' 个 SSE 事件 · 完成 · '+Math.round(performance.now()-started)+' ms';
  }catch(error){output.textContent=error.message;meta.textContent='请求失败'}
  finally{button.disabled=false;button.innerHTML='发送请求 <span>↗</span>'}
}
loadStatus();
setInterval(loadStatus,15000);
