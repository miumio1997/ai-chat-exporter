/* Message identity, navigation and bounded DOM collection. No network or storage. */
(function(root){
  'use strict';
  var timing={quiet:1800,limit:45000,step:300};
  var ids=new WeakMap(),serial=0;
  function text(el){return typeof el==='string'?el:String(el&&(el.innerText||el.textContent)||'');}
  function content(el){
    var s=text(el);if(typeof el==='string'||!el)return s;
    if(location.hostname==='gemini.google.com')el.querySelectorAll('.screen-reader-user-query-label,.screen-reader-model-response-label').forEach(n=>{var label=text(n);if(label)s=s.replace(label,'');});
    el.querySelectorAll('img,audio,video').forEach(e=>{var type={IMG:'图片',AUDIO:'音频',VIDEO:'视频'}[e.tagName];var name=e.getAttribute('alt')||e.getAttribute('title');var label='［'+type+(name?'：'+name:'，请在原对话查看')+'］';if(!s.includes(label))s+='\n'+label;});
    return s;
  }
  function codeFence(s){var runs=String(s).match(/`+/g)||[],n=runs.reduce((n,x)=>Math.max(n,x.length+1),3);var f='`'.repeat(n);return f+'\n'+s+'\n'+f;}
  function identity(el,role){
    if(!el||typeof el==='string')return null;
    var owner=el.closest('[data-message-id],[data-chatgpt-selection-message-id],[data-chatgpt-search-message-ids],[data-dil-message-id]')||el;
    var id=owner.getAttribute('data-message-id')||owner.getAttribute('data-chatgpt-selection-message-id')||owner.getAttribute('data-chatgpt-search-message-ids')||owner.getAttribute('data-dil-message-id');
    if(id)return {key:role+':id:'+id,stable:true};
    if(/(^|\.)deepseek\.com$/i.test(location.hostname)){
      var row=el.closest('[data-virtual-list-item-key]'),rowId=row&&row.getAttribute('data-virtual-list-item-key');
      if(rowId){
        var parts=Array.from(row.querySelectorAll('.ds-markdown')).filter(n=>!n.parentElement.closest('.ds-markdown'));
        var kind=el.closest('.ds-think-content')?'think':'answer';
        parts=parts.filter(n=>(n.closest('.ds-think-content')?'think':'answer')===kind);
        var part=parts.findIndex(n=>n===el||n.contains(el));
        return {key:role+':row:'+rowId+':'+kind+':part:'+part,stable:true};
      }
    }
    if(location.hostname==='gemini.google.com'){
      var turn=el.closest('.conversation-container[id]');
      if(turn)return {key:role+':turn:'+turn.id,stable:true};
    }
    if(!ids.has(el))ids.set(el,++serial);
    return {key:role+':node:'+ids.get(el),stable:false};
  }
  function deepseek(add){
    var rows=Array.from(document.querySelectorAll('.ds-virtual-list [data-virtual-list-item-key]'));
    if(!rows.length)return false;
    rows.forEach(function(row){
      var parts=Array.from(row.querySelectorAll('.ds-markdown')).filter(n=>!n.parentElement.closest('.ds-markdown'));
      if(parts.length)parts.forEach(el=>add('DeepSeek',el));
      else if(row.querySelector('.ds-message'))add('用户',row);
    });
    return true;
  }
  function claim(seen,el){
    if(!el||typeof el==='string')return true;
    for(var other of seen)if(other===el||other.contains(el)||el.contains(other))return false;
    seen.add(el);return true;
  }
  function typed(messages,header,options){
    var turns=[];
    for(var i=0;i<messages.length;i++){
      var m=messages[i],group=[m];
      if(m.role!=='用户'&&(!options||options.groupVersions!==false))while(i+1<messages.length&&messages[i+1].role===m.role)group.push(messages[++i]);
      group.forEach((x,j)=>turns.push({label:x.role+'说',version:group.length>1?'V'+(j+1):'',isUser:x.role==='用户',content:x.content}));
    }
    return {header:String(header||'').split('='.repeat(50))[0].trim(),turns:turns};
  }
  function path(url){var u=new URL(url,location.href);if(u.origin!==location.origin)throw Error('目标不在当前平台，未导出。');return u.pathname.replace(/\/$/,'')+u.search;}
  function currentPath(){return path(location.href);}
  function pageSignature(){return Array.from(document.querySelectorAll('[data-chatgpt-selection-message-id],[data-chatgpt-search-message-ids],[data-message-author-role],[data-conversation-role],[data-testid="user-message"],.ds-markdown,user-query,model-response,[data-role="user"],[data-role="assistant"],[class*="UserQuestion"],[class*="MarkdownContent"],[class*="userMessage"],[class*="assistantMessage"]')).filter(e=>!e.closest('#aie25')).map(e=>(e.getAttribute('data-message-id')||e.getAttribute('data-chatgpt-selection-message-id')||e.getAttribute('data-chatgpt-search-message-ids')||(e.closest('.conversation-container[id]')||{}).id||e.getAttribute('data-virtual-list-item-key')||'')+'\0'+text(e)).join('\u001e');}
  function visible(el){if(!el||el.nodeType!==1)return true;var s=getComputedStyle(el);return !el.hidden&&el.getAttribute('aria-hidden')!=='true'&&s.display!=='none'&&s.visibility!=='hidden';}
  function geminiBusy(){
    var candidates=document.querySelectorAll('main [aria-busy="true"],main [role="progressbar"],main [data-is-streaming="true"],button[data-testid="stop-button"],[data-testid="stop-response-button"]');
    return Array.from(candidates).some(function(el){
      // Gemini puts the history/sidebar inside main. Loading that list is not
      // loading the selected conversation and must not block its download.
      if(el.closest('nav,aside,mat-sidenav,side-navigation-content,side-navigation-v2,[data-test-id="side-nav"]'))return false;
      for(var n=el;n&&n.nodeType===1;n=n.parentElement){
        var style=getComputedStyle(n);
        if(n.hidden||n.getAttribute('aria-hidden')==='true'||style.display==='none'||style.visibility==='hidden')return false;
      }
      return true;
    })||Array.from(document.querySelectorAll('main [role="status"],main span,main p')).some(function(el){
      if(el.closest('nav,aside,mat-sidenav,side-navigation-content,side-navigation-v2'))return false;
      return visible(el)&&/^(正在加载更早的消息|加载中[.…]*|Loading (earlier|older) messages[.…]*)$/i.test(text(el).trim());
    });
  }
  function busy(){
    if(location.hostname==='gemini.google.com')return geminiBusy();
    return Array.from(document.querySelectorAll('main [aria-busy="true"],main [role="progressbar"],button[data-testid="stop-button"],[data-testid="stop-response-button"],[data-is-streaming="true"]')).some(visible) ||
      Array.from(document.querySelectorAll('main [role="status"],main span,main p')).some(e=>visible(e)&&/^(正在加载更早的消息|加载中[.…]*|Loading (earlier|older) messages[.…]*)$/i.test(text(e).trim()));
  }
  function scroller(){
    var el=document.querySelector('[data-markdown-text-style="assistant-message"],[data-conversation-role],[data-message-author-role],[data-testid="user-message"],.ds-markdown,user-query,[data-role="user"],[class*="flow-markdown-body"],[class*="UserQuestion"]');
    for(var n=el;n;n=n.parentElement)if(n.clientHeight>0&&n.scrollHeight>n.clientHeight+8&&/(auto|scroll)/.test(getComputedStyle(n).overflowY))return n;
    return document.scrollingElement||document.documentElement;
  }
  function navigate(el,options){
    options=options||{};var href=el&&el.getAttribute('href');
    if(!href)return Promise.reject(Error('无法核实目标对话地址，未抓取当前页面。'));
    var target=path(href),start=Date.now(),previous=pageSignature();
    if(options.cancelled&&options.cancelled())return Promise.reject(Error('已停止'));
    if(target===currentPath()&&!busy())return Promise.resolve(target);
    return new Promise((resolve,reject)=>{
      var timer,observer,done=false;
      function finish(error){if(done)return;done=true;clearTimeout(timer);if(observer)observer.disconnect();error?reject(error):resolve(target);}
      function check(){
        if(done)return;
        if(options.cancelled&&options.cancelled()){finish(Error('已停止'));return;}
        var signature=pageSignature();
        if(currentPath()===target&&signature&&signature!==previous&&!busy()){finish();return;}
        if(Date.now()-start>(options.timeout||15000)){finish(Error('未完成切换到目标对话，未导出上一段聊天。'));return;}
        clearTimeout(timer);timer=setTimeout(check,100);
      }
      // Listen before clicking: a synchronous route transition must not be lost.
      observer=new MutationObserver(check);
      observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['aria-busy','data-is-streaming','data-message-id','data-chatgpt-selection-message-id','id']});
      try{el.click();check();}catch(error){finish(error);}
    });
  }
  function collect(read,options){
    options=options||{};var target=options.target||currentPath(),s=scroller(),top=s.scrollTop,behavior=s.style.scrollBehavior;
    var entries=new Map(),order=[],downOrder=[],last='',changed=Date.now(),start=Date.now(),phase='top',timer,done=false,unstable=false;
    // A mounted long answer is readable as one node, even when it spans many
    // screens. Advance across that node instead of waiting once per screen.
    function nextBoundary(batch){
      var pos=s.scrollTop;
      if(!/(^|\.)deepseek\.com$/i.test(location.hostname)&&location.hostname!=='gemini.google.com')return Math.min(s.scrollHeight,pos+Math.max(1,s.clientHeight*.8));
      var rect=s.getBoundingClientRect(),edge=pos+s.clientHeight*.8;
      var rows=Array.from(s.querySelectorAll('[data-virtual-list-item-key]'));
      var nodes=rows.length?rows:batch.map(m=>m.element).filter(el=>el&&el.nodeType===1&&el.isConnected&&s.contains(el));
      var ranges=nodes.map(el=>{var r=el.getBoundingClientRect();return {start:pos+r.top-rect.top,end:pos+r.bottom-rect.top};}).filter(r=>r.end>r.start).sort((a,b)=>a.start-b.start);
      // Do not leap across a gap in a virtual list: it can be an unloaded row.
      if(rows.length){
        for(var r of ranges){if(r.end<=pos)continue;if(r.start>edge+4)break;edge=Math.max(edge,r.end);}
      }else ranges.forEach(r=>{edge=Math.max(edge,r.end);});
      return Math.min(Math.max(0,s.scrollHeight-s.clientHeight),Math.max(pos+1,edge));
    }
    s.style.scrollBehavior='auto';
    return new Promise((resolve,reject)=>{
      function finish(error,reason){
        if(done)return;done=true;clearTimeout(timer);s.style.scrollBehavior=behavior;if(currentPath()===target)s.scrollTop=top;
        if(error){reject(error);return;}
        var finalOrder=phase==='down'?downOrder.concat(order.filter(k=>!downOrder.includes(k))):order;
        var messages=finalOrder.map(k=>entries.get(k));
        resolve({messages:messages,note:'页面范围：已收集 '+messages.length+' 条；平台未提供总数，历史完整性未核实。'+(reason||'')+(unstable?' 部分片段无稳定消息 ID，仅能按页面节点保留，虚拟列表仍可能重复或遗漏。':''),complete:false});
      }
      function tick(){
        try{
          if(options.cancelled&&options.cancelled()){finish(Error('已停止'));return;}
          if(currentPath()!==target){finish(Error('导出期间对话地址改变，已停止以免混入其他聊天。'));return;}
          var batch=read(),keys=[];
          batch.forEach((m,i)=>{
            var ident=m.key?{key:m.key,stable:m.stableId!==false}:identity(m.element,m.role);
            if(!ident){ident={key:'position:'+i,stable:false};}if(!ident.stable)unstable=true;
            keys.push(ident.key);entries.set(ident.key,m);
          });
          if(phase==='down')keys.forEach(k=>{if(!downOrder.includes(k))downOrder.push(k);});
          // Merge by node identity and visible relative order, never by text prefix.
          keys.forEach((key,i)=>{if(order.includes(key))return;var following=keys.slice(i+1).find(k=>order.includes(k));var prior=keys.slice(0,i).reverse().find(k=>order.includes(k));if(following)order.splice(order.indexOf(following),0,key);else if(prior)order.splice(order.indexOf(prior)+1,0,key);else if(phase==='top')order.unshift(key);else order.push(key);});
          var signature=keys.map(k=>k+'\0'+entries.get(k).content).join('\u001e')+'|'+s.scrollHeight;
          if(signature!==last){last=signature;changed=Date.now();}
          if(options.enough&&!busy()&&options.enough(entries)){finish(null,'指定消息已逐一找到。');return;}
          if(Date.now()-start>timing.limit){if(busy())finish(Error('页面仍在生成或加载，未将未完成内容作为完整导出。'));else finish(null,'达到等待上限，可能仍有未加载消息。');return;}
          if(phase==='top'){
            if(s.scrollTop>1){s.scrollTop=0;changed=Date.now();}
            if(Date.now()-changed>=timing.quiet&&!busy()){phase='down';changed=Date.now();}
          }else if(!busy()&&Date.now()-changed>=timing.quiet){
            if(s.scrollTop+s.clientHeight>=s.scrollHeight-4){finish(null,'已检查到当前页面底部。');return;}
            s.scrollTop=nextBoundary(batch);changed=Date.now();
          }
          timer=setTimeout(tick,timing.step);
        }catch(e){finish(e);}
      }
      tick();s.scrollTop=0;
    });
  }
  function filename(base,ext,source){
    var u=new URL(source||location.href,location.href),id=u.pathname.split('/').filter(Boolean).pop()||'page';
    id=id.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,48)||'page';
    if(u.search){var h=2166136261;for(var c of u.search)h=Math.imul(h^c.charCodeAt(0),16777619);id+='_'+(h>>>0).toString(16);}
    return Array.from(base).slice(0,55).join('')+'_'+id+'.'+ext;
  }
  function notice(message){
    var el=document.getElementById('ai-export-notice');if(!el){el=document.createElement('div');el.id='ai-export-notice';el.setAttribute('role','status');el.style.cssText='position:fixed;bottom:16px;right:16px;max-width:440px;padding:12px 16px;background:#fff;color:#222;border:1px solid #ccc;border-radius:8px;z-index:2147483647;font:14px/1.6 sans-serif;box-shadow:0 3px 18px #0002';document.body.appendChild(el);}
    clearTimeout(el._aiExportNoticeTimer);
    el.textContent=message;
    el.onclick=()=>{clearTimeout(el._aiExportNoticeTimer);el.remove();};
    el._aiExportNoticeTimer=setTimeout(()=>el.remove(),2000);
  }
  function claude(data,id){
    if(data.uuid&&id&&data.uuid!==id)throw Error('接口返回的对话身份与目标不符，未导出');
    if(!Array.isArray(data.chat_messages))throw Error('接口未返回消息列表');
    return data.chat_messages.map(function(m){
      var s=Array.isArray(m.content)?m.content.map(b=>typeof b==='string'?b:(b&&b.type==='text'&&typeof b.text==='string'?b.text:'［'+(b&&b.type||'未知内容')+'，请在原对话查看］')).join('\n'):'';
      if(!s&&typeof m.text==='string')s=m.text;
      if(Array.isArray(m.attachments))m.attachments.forEach(f=>{var name=f.file_name||f.filename||f.name;s+='\n［附件'+(name?'：'+name:'，请在原对话查看')+'］';});
      return {id:m.uuid,role:m.sender==='human'?'用户':'Claude',content:s||'［此消息无可读取的文字，请在原对话查看］'};
    });
  }
  root.AIExportIntegrity={timing:timing,text:text,content:content,identity:identity,deepseek:deepseek,claim:claim,typed:typed,path:path,currentPath:currentPath,navigate:navigate,collect:collect,notice:notice,filename:filename,codeFence:codeFence,busy:busy,claude:claude};
  // Timing is configurable only for local, offline tests.
  Object.defineProperty(root.AIExportIntegrity,'timing',{get:()=>timing,set:v=>{timing=v;}});
})(globalThis);
