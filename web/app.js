const $ = (id) => document.getElementById(id);
const pages = ['home','accounts','settings','logs','playground'];
let toastTimer;
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
    $('pow-value').textContent=data.pow?'Ready':(data.pow_ready?'Ready':'—');
    $('version-value').textContent=data.version??'—';
  }catch(error){
    state.textContent='服务不可用';state.style.color='#ff897f';subtitle.textContent=error.message;
    for(const id of ['engine-value','uptime-value','pow-value','version-value'])$(id).textContent='—';
  }
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
