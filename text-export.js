/* Shared DOM history collector. Native completeness first; otherwise retain
   bounded history traversal. Reuse only an unchanged, previously scanned DOM. */
(function(root){
  'use strict';
  var timing={quiet:1800,limit:45000,step:100};
  var I=root.AIExportIntegrity;
  var lastScan=root.AIExportText&&root.AIExportText.lastScan||null;
  function sameScan(messages,target,s){
    return lastScan&&lastScan.target===target&&lastScan.height===s.scrollHeight&&lastScan.rows.length===messages.length&&
      messages.every((m,i)=>m.element===lastScan.rows[i].element&&m.element.isConnected&&m.role===lastScan.rows[i].role&&m.content===lastScan.rows[i].content);
  }
  var currentPath=()=>I.currentPath(),identity=(el,role)=>I.identity(el,role),busy=()=>I.busy();
  function visible(el){
    for(var n=el;n&&n.nodeType===1;n=n.parentElement){
      var s=getComputedStyle(n);
      if(n.hidden||n.getAttribute('aria-hidden')==='true'||s.display==='none'||s.visibility==='hidden')return false;
    }
    return true;
  }
  function knownGap(messages){
    var elements=messages.map(m=>m.element).filter(Boolean);
    var selectors='[data-virtual-list-item-key],[data-testid^="conversation-turn-"],[aria-posinset]';
    var rows=Array.from(new Set(elements.map(el=>el.closest(selectors)).filter(Boolean)));
    var positions=rows.map(el=>{
      var value=el.getAttribute('aria-posinset');
      if(value!==null&&/^\d+$/.test(value))return Number(value)-1;
      value=el.getAttribute('data-virtual-list-item-key');
      if(value!==null&&/^\d+$/.test(value))return Number(value);
      var match=(el.getAttribute('data-testid')||'').match(/^conversation-turn-(\d+)$/);
      return match?Number(match[1]):null;
    }).filter(n=>n!==null).sort((a,b)=>a-b);
    if(positions.length){
      if(positions[0]>0)return true;
      for(var i=1;i<positions.length;i++)if(positions[i]>positions[i-1]+1)return true;
    }
    if(rows.some(el=>{var n=Number(el.getAttribute('aria-setsize'));return n>0&&n>rows.length;}))return true;
    // A spacer or an unmounted range before the first message is a reason to
    // retain the existing history collector, even if there is no row index.
    var first=elements[0],container=first;
    while(container&&container.parentElement){
      container=container.parentElement;
      var style=getComputedStyle(container);
      if(container.clientHeight>0&&container.scrollHeight>container.clientHeight+8&&/(auto|scroll)/.test(style.overflowY)){
        var offset=first.getBoundingClientRect().top-container.getBoundingClientRect().top+container.scrollTop;
        var tail=elements[elements.length-1].getBoundingClientRect().bottom-container.getBoundingClientRect().top+container.scrollTop;
        if(offset>Math.max(400,container.clientHeight)||container.scrollHeight-tail>Math.max(400,container.clientHeight))return true;
        break;
      }
    }
    return Array.from(document.querySelectorAll('main [data-virtualizer-spacer],main [data-virtual-list-spacer],main [data-testid="loading-older-messages"],main [data-testid="load-more-messages"],main [aria-busy="true"]')).some(el=>visible(el));
  }
  function capture(read,options){
    options=options||{};
    if(options.cancelled&&options.cancelled())throw Error('已停止');
    if(options.target&&currentPath()!==options.target)throw Error('导出期间对话地址改变，已停止以免混入其他聊天。');
    if(busy())return null;
    var messages;try{messages=read();}catch(ignore){return null;}
    if(!messages||!messages.length||messages.some(m=>!m.element||!visible(m.element))||knownGap(messages))return null;
    // Zero-scroll completion requires native total + positions. Mere quiet,
    // pixel coverage, or a nonempty DOM never proves that earlier history exists.
    var rows=Array.from(new Set(messages.map(m=>m.element.closest('[aria-posinset][aria-setsize]')).filter(Boolean)));
    if(!rows.length||messages.some(m=>!m.element.closest('[aria-posinset][aria-setsize]')))return null;
    var total=Number(rows[0].getAttribute('aria-setsize'));
    if(!Number.isSafeInteger(total)||total<=0||rows.length!==total)return null;
    var positions=rows.map(el=>Number(el.getAttribute('aria-posinset'))).sort((a,b)=>a-b);
    if(rows.some(el=>Number(el.getAttribute('aria-setsize'))!==total)||positions.some((n,i)=>n!==i+1))return null;
    if(Array.from(document.querySelectorAll('model-response,[data-message-author-role="assistant"]')).some(el=>visible(el)&&!root.AIExportIntegrity.content(el).trim()))return null;
    return {messages:messages,complete:true,note:'已按页面提供的总数核对 '+total+' 行，保存 '+messages.length+' 条消息。'};
  }
  function scroller(){
    var el=document.querySelector('[data-markdown-text-style="assistant-message"],[data-conversation-role],[data-message-author-role],[data-testid="user-message"],.ds-markdown,user-query,[data-role="user"],[class*="flow-markdown-body"],[class*="UserQuestion"]');
    for(var n=el;n;n=n.parentElement)if(n.clientHeight>0&&n.scrollHeight>n.clientHeight+8&&/(auto|scroll)/.test(getComputedStyle(n).overflowY))return n;
    return document.scrollingElement||document.documentElement;
  }
  function collect(read,options){
    options=options||{};var direct=capture(read,options);if(direct)return Promise.resolve(direct);var target=options.target||currentPath(),s=scroller(),top=s.scrollTop,behavior=s.style.scrollBehavior;
    var initial=read();
    if(!busy()&&!knownGap(initial)&&initial.length&&sameScan(initial,target,s))return Promise.resolve({messages:initial,complete:false,note:lastScan.note});
    var entries=new Map(),order=[],downOrder=[],last='',changed=Date.now(),start=Date.now(),phase='top',timer,done=false,unstable=false;
    // A mounted long answer is readable as one node, even when it spans many
    // screens. Advance across that node instead of waiting once per screen.
    function nextBoundary(batch){
      var pos=s.scrollTop;
      var rect=s.getBoundingClientRect(),edge=pos+s.clientHeight*.8;
      var rows=Array.from(s.querySelectorAll('[data-virtual-list-item-key]'));
      var nodes=rows.length?rows:batch.map(m=>m.element).filter(el=>el&&el.nodeType===1&&el.isConnected&&s.contains(el));
      var ranges=nodes.map(el=>{var r=el.getBoundingClientRect();return {start:pos+r.top-rect.top,end:pos+r.bottom-rect.top};}).filter(r=>r.end>r.start).sort((a,b)=>a.start-b.start);
      // Do not leap across a gap in a virtual list: it can be an unloaded row.
      for(var r of ranges){if(r.end<=pos)continue;if(r.start>edge+4)break;edge=Math.max(edge,r.end);}
      return Math.min(Math.max(0,s.scrollHeight-s.clientHeight),Math.max(pos+1,edge));
    }
    s.style.scrollBehavior='auto';
    return new Promise((resolve,reject)=>{
      function finish(error,reason){
        if(done)return;done=true;clearTimeout(timer);s.style.scrollBehavior=behavior;if(currentPath()===target&&Math.abs(s.scrollTop-top)>1)s.scrollTop=top;
        if(error){reject(error);return;}
        var finalOrder=phase==='down'?downOrder.concat(order.filter(k=>!downOrder.includes(k))):order;
        var messages=finalOrder.map(k=>entries.get(k));
        var result={messages:messages,note:'页面范围：已收集 '+messages.length+' 条；平台未提供总数，历史完整性未核实。'+(reason||'')+(unstable?' 部分片段无稳定消息 ID，仅能按页面节点保留，虚拟列表仍可能重复或遗漏。':''),complete:false};
        if(reason==='已检查到当前页面底部。'&&!unstable){
          var mounted=read();
          if(mounted.length===messages.length&&mounted.every((m,i)=>m.element===messages[i].element&&m.content===messages[i].content)){
            lastScan={target:target,height:s.scrollHeight,note:result.note,rows:mounted.map(m=>({element:m.element,role:m.role,content:m.content}))};
            root.AIExportText.lastScan=lastScan;
          }
        }
        resolve(result);
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
          if(phase==='down')keys.forEach((key,i)=>{
            if(downOrder.includes(key))return;
            var following=keys.slice(i+1).find(k=>downOrder.includes(k)),prior=keys.slice(0,i).reverse().find(k=>downOrder.includes(k));
            if(following)downOrder.splice(downOrder.indexOf(following),0,key);
            else if(prior)downOrder.splice(downOrder.indexOf(prior)+1,0,key);
            else downOrder.push(key);
          });
          // Merge by node identity and visible relative order, never by text prefix.
          keys.forEach((key,i)=>{if(order.includes(key))return;var following=keys.slice(i+1).find(k=>order.includes(k));var prior=keys.slice(0,i).reverse().find(k=>order.includes(k));if(following)order.splice(order.indexOf(following),0,key);else if(prior)order.splice(order.indexOf(prior)+1,0,key);else if(phase==='top')order.unshift(key);else order.push(key);});
          var signature=keys.map(k=>k+'\0'+entries.get(k).content).join('\u001e')+'|'+s.scrollHeight;
          if(signature!==last){last=signature;changed=Date.now();}
          if(options.enough&&!busy()&&options.enough(entries)){finish(null,'指定消息已逐一找到。');return;}
          if(Date.now()-start>timing.limit){if(busy())finish(Error('页面仍在生成或加载，未将未完成内容作为完整导出。'));else finish(null,'达到等待上限，可能仍有未加载消息。');return;}
          if(phase==='top'){
            if(s.scrollTop>1){s.scrollTop=0;changed=Date.now();}
            if(Date.now()-changed>=timing.quiet&&!busy()){phase='down';changed=Date.now()-timing.quiet;}
          }else if(!busy()&&Date.now()-changed>=timing.quiet){
            if(s.scrollTop+s.clientHeight>=s.scrollHeight-4){finish(null,'已检查到当前页面底部。');return;}
            s.scrollTop=nextBoundary(batch);changed=Date.now();
          }
          timer=setTimeout(tick,timing.step);
        }catch(e){finish(e);}
      }
      tick();
    });
  }
  root.AIExportText={capture:capture,collect:collect};
})(globalThis);
