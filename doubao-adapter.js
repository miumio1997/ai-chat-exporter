/* Doubao DOM compatibility. Local reads only: no API, credentials, storage or upload.
 * Existing renderers and legacy extraction remain in popup.js.
 */
(function (root) {
  'use strict';
  if(root.AIExportDoubao && root.AIExportDoubao.version==='1.6.13')return;
  var MODERN = '[data-testid="send_message"],[data-testid="receive_message"],[data-message-role="user"],[data-message-role="assistant"]';
  var LEGACY = '[class*="flow-markdown-body"],[data-role="user"],[data-role="assistant"]';
  var nodeKeys = new WeakMap(), nextKey = 0, active = null, collecting = false;
  function isDoubao() { return /(^|\.)doubao\.com$/i.test(location.hostname); }
  function ownsPage() { return isDoubao() && (!!document.querySelector(MODERN) || !document.querySelector(LEGACY)); }
  function visible(el, cache) {
    if(cache && cache.has(el))return cache.get(el);
    var trail=[];
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      if(cache&&cache.has(n)){var hit=cache.get(n);trail.forEach(function(x){cache.set(x,hit);});return hit;}
      trail.push(n);
      if (n.hidden || n.getAttribute('aria-hidden') === 'true') {if(cache)trail.forEach(function(x){cache.set(x,false);});return false;}
      var s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden') {if(cache)trail.forEach(function(x){cache.set(x,false);});return false;}
    }
    if(cache)trail.forEach(function(x){cache.set(x,true);});
    return true;
  }
  function textOf(node) {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1) return '';
    if (node.tagName === 'BR') return '\n';
    var s = Array.from(node.childNodes).map(textOf).join('');
    if (node.tagName === 'TD' || node.tagName === 'TH') return s + '\t';
    return /^(P|DIV|H[1-6]|LI|UL|OL|PRE|BLOCKQUOTE|TR|TABLE|SECTION)$/.test(node.tagName) ? s + '\n' : s;
  }
  function snapshot() {
    var visibilityCache=new WeakMap();
    var list = document.querySelector('[data-testid="message-list"]') || document;
    var roots = Array.from(list.querySelectorAll(MODERN)).filter(function (el) {
      return visible(el,visibilityCache) && !el.parentElement.closest(MODERN) && !el.closest('#aie25');
    });
    return roots.map(function (el) {
      var role = el.getAttribute('data-message-role') || (el.getAttribute('data-testid') === 'send_message' ? 'user' : 'assistant');
      var content = el.querySelector('[data-testid="message_content"]') || el;
      var clone = content.cloneNode(true);
      // Remove hidden UI twins using the live computed visibility before detaching.
      var liveChildren = Array.from(content.querySelectorAll('*'));
      var copyChildren = Array.from(clone.querySelectorAll('*'));
      liveChildren.forEach(function (child, i) { if (!visible(child,visibilityCache)) copyChildren[i].remove(); });
      clone.querySelectorAll('script,style,button,textarea,input,select,svg,[role="button"],[contenteditable="true"],[data-testid="message_action_bar"],[data-testid="suggest_message_list"],[data-send-message-status]').forEach(function (e) { e.remove(); });
      clone.querySelectorAll('[data-testid="attachment_file_item"]').forEach(function (file) {
        var name = file.querySelector('[data-testid="message_nested_content_file_name"]');
        var p = document.createElement('p'); p.textContent = '［附件：' + ((name && name.textContent || file.textContent || '').trim() || '未命名文件') + '］'; file.replaceWith(p);
      });
      clone.querySelectorAll('img').forEach(function (img) {
        var p = document.createElement('span'); p.textContent = '［图片：' + (img.getAttribute('alt') || '图片附件') + '］'; img.replaceWith(p);
      });
      var text = textOf(clone).replace(/[\t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      var id = content.getAttribute('data-message-id') || el.getAttribute('data-message-id');
      if (!id) {
        var old = nodeKeys.get(el), signature = role + '\0' + text;
        if (!old || old.signature !== signature) { old = {key: 'node-' + (++nextKey), signature: signature}; nodeKeys.set(el, old); }
        id = old.key;
      }
      return {key: role + ':' + id, stableId: !/^node-/.test(id), role: role === 'user' ? '用户' : '豆包', content: text, element: clone};
    }).filter(function (m) { return m.content.length > 0; });
  }
  function signature(items) { return items.map(function (m) { return m.key + '\0' + m.content; }).join('\u001e'); }
  function title() {
    var el = document.querySelector('[data-testid="editable_conversation_name"]');
    return (el && el.textContent || document.title.replace(/\s*[-–—|·]\s*豆包\s*$/, '') || '对话').trim();
  }
  function scroller() {
    var el = document.querySelector('[data-testid="message-list"] ' + MODERN.split(',')[0]) || document.querySelector(MODERN);
    if (!el) el = document.querySelector('[data-testid="message-list"]');
    for (var n = el; n && n !== document.body; n = n.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 8) return n;
    }
    return document.scrollingElement || document.documentElement;
  }
  function merge(ordered, items, prepend) {
    items.forEach(function (item, i) {
      var index = ordered.findIndex(function (x) { return x.key === item.key; });
      if (index >= 0) { ordered[index] = item; return; }
      var next = -1;
      for (var j = i + 1; j < items.length && next < 0; j++) next = ordered.findIndex(function (x) { return x.key === items[j].key; });
      if (next >= 0) ordered.splice(next, 0, item);
      else {
        var prev = i > 0 ? ordered.findIndex(function (x) { return x.key === items[i-1].key; }) : -1;
        if (prev >= 0) ordered.splice(prev + 1, 0, item);
        else if (prepend) ordered.unshift(item);
        else ordered.push(item);
      }
    });
  }
  function cancelled(options, url) { return (options.cancelled && options.cancelled()) || location.href !== url; }
  function pause(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  // A long message occupies many screens but is still one already-loaded DOM node.
  // Read the virtual list's actual row ranges, never infer missing messages from text height.
  function layout() {
    var list=document.querySelector('[data-testid="message-list"]');
    if(!list)return {complete:false,known:false,gap:0};
    var items=list.querySelector('.list_items');
    if(!items)return {complete:!!list.querySelector(MODERN),known:true,gap:0,staticList:true};
    var rows=Array.from(items.children).filter(function(e){return e.classList.contains('v_list_row');});
    var ranges=[],hasHead=false,hasFoot=false,footEnd=0,invalid=false,indices=[],indexed=true;
    rows.forEach(function(e){
      var kind=e.style.getPropertyValue('--cls').trim(), raw=e.style.getPropertyValue('--vlist-row-transform-y').trim();
      if(!/^\d+(?:\.\d+)?px$/.test(raw)){invalid=true;return;}
      var top=parseFloat(raw), height=e.getBoundingClientRect().height;
      if(!(height>=0)){invalid=true;return;}
      if(kind!=='h'&&kind!=='f'){var rowMatch=/^r-(\d+)-0_block_/.exec(kind);if(rowMatch)indices.push(Number(rowMatch[1]));else indexed=false;}
      if(kind==='h')hasHead=true;
      if(kind==='f'){hasFoot=true;footEnd=top+height;}
      ranges.push({start:top,end:top+height});
    });
    if(invalid||!ranges.length)return {complete:false,known:false,gap:0};
    ranges.sort(function(a,b){return a.start-b.start;});
    var end=0,gap=null;
    ranges.forEach(function(r){if(gap===null&&r.start>end+2)gap=end;end=Math.max(end,r.end);});
    var sequenceComplete=!indexed||!indices.length||(Math.min(...indices)===0&&new Set(indices).size===Math.max(...indices)+1);
    return {complete:hasHead&&hasFoot&&gap===null&&ranges[0].start<=2&&sequenceComplete,known:true,
      gap:!hasHead?0:gap!==null?gap:end,hasHead:hasHead,hasFoot:hasFoot,end:end,footEnd:footEnd};
  }
  function fingerprint() {
    var list=document.querySelector('[data-testid="message-list"]')||document;
    return Array.from(list.querySelectorAll(MODERN)).filter(function(e){return !e.parentElement.closest(MODERN);}).map(function(e){
      var c=e.querySelector('[data-testid="message_content"]')||e;
      return (c.getAttribute('data-message-id')||'')+'\0'+c.textContent;
    }).join('\u001e');
  }
  function generating() {
    return Array.from(document.querySelectorAll('button,[role="button"]')).some(function(b){
      var label=(b.getAttribute('aria-label')||b.getAttribute('title')||b.textContent||'').trim();
      return /^(停止生成|停止回答|停止输出|Stop generating|Stop response)$/i.test(label)&&visible(b);
    });
  }
  async function collect(options) {
    if(collecting)throw new Error('已有豆包导出正在运行，请等待结束后重试。');
    collecting=true;options=options||{};
    var url=location.href,deadline=Date.now()+20000,ordered=[],scroll=null,originalTop=0,originalBehavior='';
    var rangesSeen=[],sawHead=false,sawFoot=false,finalEnd=0,missingIds=false,scrolls=0;
    var rowIndices=new Set(),lastRowIndex=null,indexedRows=true,currentRows=[];
    function check(){
      if(cancelled(options,url))throw new Error('导出已取消，或对话已切换；未生成文件。');
      if(Date.now()>deadline)throw new Error('历史消息仍未加载完整，已停止；未生成文件。');
      if(generating())throw new Error('消息仍在生成，请在回复结束后重试。');
    }
    async function ready(){
      var end=Math.min(deadline,Date.now()+5000),last=fingerprint();
      while(Date.now()<end){
        check();await pause(80);check();var current=fingerprint();
        if(current&&current===last)return;
        last=current;
      }
      throw new Error(last?'消息持续变化，请待回复完成后重试。':'未识别到豆包消息，请等待页面加载后重试。');
    }
    function collectRanges(){
      var list=document.querySelector('[data-testid="message-list"] .list_items');
      if(!list)return;
      currentRows=[];var footerTop=null;
      Array.from(list.children).filter(function(e){return e.classList.contains('v_list_row');}).forEach(function(e){
        var raw=e.style.getPropertyValue('--vlist-row-transform-y').trim();
        if(!/^\d+(?:\.\d+)?px$/.test(raw))return;
        var start=parseFloat(raw),end=start+e.getBoundingClientRect().height,kind=e.style.getPropertyValue('--cls').trim();
        rangesSeen.push({start:start,end:end});
        if(kind==='h')sawHead=true;
        if(kind==='f'){sawFoot=true;finalEnd=end;footerTop=start;}
        if(kind!=='h'&&kind!=='f'){
          var match=/^r-(\d+)-0_block_/.exec(kind);
          if(!match)indexedRows=false;
          else {var index=Number(match[1]);rowIndices.add(index);currentRows.push({index:index,start:start,end:end});}
        }
      });
      // Pixel heights change when previously unmounted images/text are measured.
      // Native row indices remain stable across those layout changes.
      if(footerTop!==null){
        var last=currentRows.find(r=>Math.abs(r.end-footerTop)<=2);
        if(last)lastRowIndex=last.index;
      }
    }
    function nextGap(){
      rangesSeen.sort(function(a,b){return a.start-b.start;});var end=0;
      for(var i=0;i<rangesSeen.length;i++){if(rangesSeen[i].start>end+2)return end;end=Math.max(end,rangesSeen[i].end);}
      return end;
    }
    try{
      await ready();var state=layout();
      // The common case: both ends and every row are rendered. No scroll, one rich capture.
      if(state.complete){
        var direct=snapshot();if(!direct.length)throw new Error('没有可导出的消息；未生成文件。');
        return {messages:direct,title:title(),note:'提取范围：已完整渲染的页面消息；附件仅记录名称，不含附件正文。',scrolls:0};
      }
      if(!state.known)throw new Error('当前列表无法确认消息完整性，未自动逐屏滚动；未生成文件。');
      scroll=scroller();originalTop=scroll.scrollTop;originalBehavior=scroll.style.scrollBehavior;scroll.style.scrollBehavior='auto';
      var lastProgress='',stalled=0;
      for(var step=0;step<60;step++){
        check();var current=snapshot();missingIds=missingIds||current.some(function(m){return !m.stableId;});
        merge(ordered,current,!sawHead);collectRanges();var gap=nextGap();
        var missingIndex=0;
        while(rowIndices.has(missingIndex))missingIndex++;
        var indexed=indexedRows&&rowIndices.size>0;
        if(missingIds)throw new Error('虚拟列表缺少稳定消息标识，无法可靠合并；未生成文件。');
        if(indexed ? sawHead&&lastRowIndex!==null&&missingIndex>lastRowIndex : sawHead&&sawFoot&&gap>=finalEnd-2)break;
        var target=!sawHead?0:Math.max(0,gap-2),before=fingerprint();
        if(indexed){
          var preceding=currentRows.filter(r=>r.index<missingIndex).sort((a,b)=>b.index-a.index)[0];
          target=missingIndex===0?0:preceding?Math.max(0,preceding.end-2):target;
        }
        var progress=target+'|'+current.map(function(m){return m.key;}).join('|')+'|'+scroll.scrollHeight;
        if(progress===lastProgress)stalled++;else stalled=0;lastProgress=progress;
        if(stalled>=3)throw new Error('缺失消息未能加载，已停止；未生成文件。');
        scroll.scrollTop=target;scrolls++;
        // Wait only for the next missing row to appear; do not sleep through the same long message.
        for(var wait=0;wait<12;wait++){
          await pause(80);check();
          if(fingerprint()!==before||layout().complete)break;
        }
        await ready();
        if(step===59)throw new Error('历史仍未完整，已停止；未生成文件。');
      }
      check();if(!ordered.length)throw new Error('没有可导出的消息；未生成文件。');
      return {messages:ordered,title:title(),note:'提取范围：按消息位置补齐的页面消息；附件仅记录名称，不含附件正文。',scrolls:scrolls};
    } finally {
      collecting=false;
      if(scroll){if(location.href===url)scroll.scrollTop=originalTop;scroll.style.scrollBehavior=originalBehavior;}
    }
  }
  function listConversations() {
    var items = Array.from(document.querySelectorAll('[data-testid="conversation-list-v2-item"]'));
    var seen = new Set();
    return items.map(function (el) { return el.closest('a[href]') || el; }).filter(function (el) {
      var id = targetPath(el); if (!id || seen.has(id)) return false; seen.add(id); return true;
    });
  }
  function targetPath(el) {
    var href = el.getAttribute('href');
    if (href) { try { var u = new URL(href, location.href); if (u.origin === location.origin && /^\/chat\/[^/]+\/?$/.test(u.pathname)) return u.pathname.replace(/\/$/, ''); } catch (_) {} }
    var item = el.matches('[data-conversation-id]') ? el : el.querySelector('[data-conversation-id]');
    var id = item && item.getAttribute('data-conversation-id');
    return id && /^[a-zA-Z0-9_-]+$/.test(id) ? '/chat/' + id : '';
  }
  function sidebarScroller() {
    var item=document.querySelector('[data-testid="conversation-list-v2-item"]');
    for(var n=item;n&&n!==document.body;n=n.parentElement){
      if(/(auto|scroll)/.test(getComputedStyle(n).overflowY)&&n.scrollHeight>n.clientHeight+8)return n;
    }
    return null;
  }
  async function scanConversations(add, cancelled) {
    var side=sidebarScroller(), original=side&&side.scrollTop, until=Date.now()+20000, last='', stable=0;
    add(listConversations());
    if(!side)return;
    try {
      side.scrollTop=0;
      for(var i=0;i<60;i++){
        if(cancelled())return;
        await pause(350); var items=listConversations();add(items);
        var sig=items.map(targetPath).join('|')+'|'+side.scrollHeight;
        var bottom=side.scrollTop+side.clientHeight>=side.scrollHeight-3;
        if(bottom&&sig===last)stable++;else stable=0;
        if(stable>=3)return;
        if(Date.now()>until)throw new Error('列表较长，仅列出本次已加载的对话');
        last=sig;side.scrollTop+=Math.max(100,side.clientHeight*0.65);
      }
      throw new Error('列表尚未全部加载，仅显示已发现的对话');
    } finally {side.scrollTop=original;}
  }
  async function reveal(wanted, options) {
    var side=sidebarScroller(), until=Date.now()+20000;
    if(!side)return null;
    side.scrollTop=0;
    for(var i=0;i<60&&Date.now()<until;i++){
      if(options.cancelled())throw new Error('已停止导出。');
      await pause(350);
      var live=listConversations().find(function(x){return targetPath(x)===wanted;});
      if(live)return live;
      if(side.scrollTop+side.clientHeight>=side.scrollHeight-3)return null;
      side.scrollTop+=Math.max(100,side.clientHeight*0.65);
    }
    return null;
  }
  async function navigate(el, options) {
    var wanted = targetPath(el); if (!wanted) throw new Error('该列表项缺少可靠对话地址，已跳过。');
    var beforePath = location.pathname.replace(/\/$/, ''), beforeSig = signature(snapshot());
    if (beforePath === wanted) return;
    // Re-find a live link; detached virtual-list elements must never silently export the old page.
    var live = listConversations().find(function (x) { return targetPath(x) === wanted; });
    if (!live && el.isConnected) live = el;
    if (!live) live=await reveal(wanted,options);
    if (!live) throw new Error('侧栏条目已卸载；请将对应对话显示在侧栏后重试。');
    live.click();
    var until = Date.now() + 15000, same = 0, last = '';
    while (Date.now() < until) {
      if (options.cancelled()) throw new Error('已停止导出。');
      var sig = signature(snapshot()), correct = location.pathname.replace(/\/$/, '') === wanted;
      if (correct && sig && sig !== beforeSig) { if (sig === last) same++; else same = 0; if (same >= 3) return; last = sig; }
      else { same = 0; last = ''; }
      await pause(300);
    }
    throw new Error('未确认目标对话加载完成，已跳过，避免导出上一段聊天。');
  }
  root.AIExportDoubao = {version:'1.6.13',ownsPage:ownsPage,snapshot:snapshot,signature:signature,layout:layout,collect:collect,listConversations:listConversations,scanConversations:scanConversations,targetPath:targetPath,navigate:navigate,
    startSingle:async function (done) {
      if (active) { alert('正在收集豆包历史消息，请稍候；切换对话可取消。'); return; }
      var token = {}; active = token;
      try { var result = await collect({cancelled:function () { return active !== token; }}); done(result); }
      catch (error) { alert(error.message || '豆包提取失败，未生成文件。'); }
      finally { if (active === token) active = null; }
    }
  };
})(globalThis);
