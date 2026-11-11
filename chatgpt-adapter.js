/* ChatGPT export: bind rendered components to message IDs; never execute message source. */
(function(root){
  'use strict';
  function markdownLink(label,url){url=String(url||'');if(!/^https?:\/\//i.test(url))return label+'［链接请在原对话打开］';return '['+String(label).replace(/[\[\]\\]/g,'\\$&')+']('+url.replace(/[\s<>"()]/g,c=>encodeURIComponent(c))+')';}
  function part(p){
    if(typeof p==='string')return p;
    if(!p||typeof p!=='object')return '';
    if(typeof p.text==='string')return p.text;
    var type=String(p.content_type||p.type||'');
    if(/image/.test(type))return '\n［图片，请在原对话查看］\n';
    if(/audio/.test(type))return '\n［音频，请在原对话查看］\n';
    if(/video/.test(type))return '\n［视频，请在原对话查看］\n';
    return '\n［附件'+(typeof p.name==='string'||typeof p.filename==='string'?'：'+(p.name||p.filename):'，请在原对话查看')+'］\n';
  }
  function rawMessage(msg){
    var c=msg.content||{},parts=Array.isArray(c.parts)?c.parts:(typeof c.text==='string'?[c.text]:[]),s=parts.map(part).join('');
    var files=msg.metadata&&msg.metadata.attachments;
    if(Array.isArray(files))files.forEach(f=>{var name=f.name||f.filename;if(name&&!s.includes(name))s+='\n［附件：'+name+'］';});
    return s || '［此消息没有可读取的文字；类型：'+String(c.content_type||'未知')+'，请在原对话查看。］';
  }
  function candidate(s){
    var masked=String(s).replace(/(^|\n)[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]{0,3}\2[ \t]*(?=\n|$)|$)|(`+)[^`\n]*?\3/g,'');
    return /\{@body\b|<(?:box|row|grid|text|title|caption|badge|list|checkbox|slider|segmented-control|Link|Cite|MemoryCite|WritingBlock|AsyncImage|AsyncImageGroup|Chart)\b/.test(masked);
  }
  function fence(s){return root.AIExportIntegrity.codeFence(s);}
  function requiresView(s){return /\{@body\b|<(?:Chart|AsyncImage|WritingBlock)\b|<(?:box|row|grid|slider|segmented-control)\s+[^>]*(?:gap|align|background|radius|padding|justify|columns|value|height|width)=/.test(s);}
  function readableDOM(node){
    if(root.AIExportRich&&root.AIExportRich.readableText)return root.AIExportRich.readableText(node);
    if(!node)return '';if(node.nodeType===3)return node.nodeValue||'';if(node.nodeType!==1)return '';
    var tag=(node.localName||'').toLowerCase();if(/^(script|style|template|noscript)$/.test(tag)||node.hidden||node.getAttribute('aria-hidden')==='true')return '';
    if(tag==='input'||tag==='textarea')return String(node.value||'');if(tag==='select')return Array.from(node.selectedOptions||[]).map(o=>o.textContent).join('、');
    var text=Array.from(node.childNodes).map(readableDOM).join(''),label=node.getAttribute('aria-label')||node.getAttribute('alt')||'';return '\n'+(label&&!text.includes(label)?label+'\n':'')+text+'\n';
  }
  function domMarkdown(node,issues){
    issues=issues||[];
    try{return renderMarkdown(node,issues);}catch(_){var text=readableDOM(node).trim();issues.push({type:'text',text:text?'已保留文字和数值':'无可读取文字，需查看原对话'});return '\n［这部分排版未完整保存，'+(text?'已保留文字。］\n'+text:'请查看原对话。］')+'\n';}
  }
  function renderMarkdown(node,issues){
    if(node.nodeType===3)return node.nodeValue;
    if(node.nodeType!==1)return '';
    var tag=node.tagName.toLowerCase(),style=getComputedStyle(node);
    if(node.getAttribute('data-d-component')==='slider'){var slider=node.querySelector('[role="slider"]');if(slider)return '［当前值：'+slider.getAttribute('aria-valuenow')+'］';}
    if(node.getAttribute('data-d-component')==='segmented-control'){var chosen=node.querySelector('[role="radio"][aria-checked="true"]');if(chosen)return '［当前选择：'+chosen.textContent+'］';}
    if(node.hidden||node.getAttribute('aria-hidden')==='true'||style.display==='none'||style.visibility==='hidden'||node.matches('script,style,button,[data-conversation-role],[role="button"],.sr-only,[data-rich-export-control]'))return '';
    var children=()=>Array.from(node.childNodes).map(n=>domMarkdown(n,issues)).join('');
    if(tag==='pre')return '\n\n'+fence((node.querySelector('code')||node).textContent)+'\n\n';
    if(tag==='code'){var s=node.textContent;var ticks='`'.repeat((s.match(/`+/g)||[]).reduce((n,x)=>Math.max(n,x.length+1),1));return ticks+s+ticks;}
    if(tag==='br')return '\n';
    if(tag==='img')return '［图片：'+(node.getAttribute('alt')||'请在原对话查看')+'］';
    if(tag==='svg'){
      if(node.closest('[data-d-component="icon"]')||node.getAttribute('data-d-component')==='icon'||node.classList.contains('lucide'))return '';
      var texts=Array.from(node.querySelectorAll('text,foreignObject')).filter(e=>!e.parentElement.closest('foreignObject')).map(n=>domMarkdown(n,issues)).filter(Boolean);
      return texts.length?'\n'+texts.join('\n')+'\n':node.getAttribute('aria-label')?'［图表：'+node.getAttribute('aria-label')+'］':'［图形：文本格式未保存图像，请查看HTML或原对话］';
    }
    if(tag==='canvas')return node.getAttribute('aria-label')?'［图表：'+node.getAttribute('aria-label')+'］':'［图形：文本格式未保存图像，请查看HTML或原对话］';
    if(tag==='input')return node.type==='checkbox'?(node.checked?'[x] ':'[ ] '):'［控件当前值：'+node.value+'］';
    if(tag==='select')return '［当前选择：'+Array.from(node.selectedOptions).map(o=>o.textContent).join('、')+'］';
    if(tag==='textarea')return fence(node.value||node.textContent);
    if(tag==='a'){var href=node.getAttribute('href')||'',label=children();return /^https?:\/\//i.test(href)?markdownLink(label,href):label+(href?'［链接请在原对话打开］':'');}
    if(tag==='table'){
      var rows=Array.from(node.querySelectorAll('tr')).map(tr=>Array.from(tr.children).filter(x=>/^(TH|TD)$/.test(x.tagName)).map(c=>Array.from(c.childNodes).map(n=>domMarkdown(n,issues)).join('').trim().replace(/\|/g,'\\|').replace(/\n/g,'<br>')));
      if(!rows.length)return children();var width=Math.max(...rows.map(r=>r.length));rows=rows.map(r=>r.concat(Array(width-r.length).fill('')));return '\n\n'+rows.map((r,i)=>'| '+r.join(' | ')+' |'+(i===0?'\n| '+Array(width).fill('---').join(' | ')+' |':'')).join('\n')+'\n\n';
    }
    var s=children();
    if(/^h[1-6]$/.test(tag))return '\n\n'+'#'.repeat(Number(tag[1]))+' '+s.trim()+'\n\n';
    if(tag==='strong'||tag==='b'||node.hasAttribute('data-d-default-strong'))return '**'+s+'**';
    if(tag==='em'||tag==='i')return '*'+s+'*';
    if(tag==='li')return '\n- '+s.trim()+'\n';
    if(tag==='blockquote')return '\n\n'+s.trim().split('\n').map(l=>'> '+l).join('\n')+'\n\n';
    return /^(p|div|section|ul|ol|hr)$/.test(tag)?'\n'+s+'\n':s;
  }
  function captureBody(body,captureRich,issues){
    if(captureRich===false||!root.AIExportRich||!root.AIExportRich.capturePage)return null;
    try{return root.AIExportRich.capturePage(body,issues);}catch(_){issues.push({type:'message',text:'本条按文字保存'});return root.AIExportRich.fallbackMarkup(readableDOM(body));}
  }
  function snapshot(cache,captureRich,messageIds,htmlStrict){
    var found=new Map();
    document.querySelectorAll('[data-chatgpt-selection-message-id],[data-message-id][data-message-author-role]').forEach(el=>{
      var id=el.getAttribute('data-chatgpt-selection-message-id')||el.getAttribute('data-message-id');
      if(messageIds&&!messageIds.has(id))return;
      var body=el.querySelector('[data-markdown-text-style="assistant-message"],.prose,.whitespace-pre-wrap')||el;
      var role=el.getAttribute('data-message-author-role')||'assistant';
      if(htmlStrict&&(body.matches('[aria-busy="true"],[data-is-streaming="true"]')||body.querySelector('[aria-busy="true"],[data-is-streaming="true"],[role="progressbar"]')))return;
      if(!htmlStrict&&cache&&cache.has(id)){found.set(id,Object.assign({},cache.get(id),{element:body}));return;}
      var issues=[],content=domMarkdown(body,issues).trim();
      // Virtualized ChatGPT mounts the message ID before its body. An empty
      // shell is not a completed capture and must never enter the cache.
      if(!content||(role!=='user'&&content==='无法加载此回复'))return;
      var richHTML=captureBody(body,captureRich,issues);
      found.set(id,{key:role+':id:'+id,stableId:true,id:id,role:role==='user'?'用户':'ChatGPT',content:content,richHTML:richHTML,formatIssues:issues,element:body,component:body.matches('[data-dil-message-id],[data-d-component]')||!!body.querySelector('[data-dil-message-id],[data-d-component]')});
    });
    document.querySelectorAll('[data-chatgpt-search-message-ids]').forEach(el=>{
      var ids=Array.from(new Set(el.getAttribute('data-chatgpt-search-message-ids').split(/\s+/).filter(Boolean)));
      if(ids.length!==1||found.has(ids[0]))return;
      if(messageIds&&!messageIds.has(ids[0]))return;
      var bubble=el.querySelector('[data-user-message-bubble]');if(!bubble)return;
      if(cache&&cache.has(ids[0])){found.set(ids[0],Object.assign({},cache.get(ids[0]),{element:bubble}));return;}
      var issues=[],content=domMarkdown(bubble,issues).trim();
      if(!content)return;
      found.set(ids[0],{key:'user:id:'+ids[0],stableId:true,id:ids[0],role:'用户',content:content,richHTML:captureBody(el,captureRich,issues),formatIssues:issues,element:bubble,component:false});
    });
    return Array.from(found.values()).sort((a,b)=>a.element.compareDocumentPosition(b.element)&4?-1:1);
  }
  // Component recognition requires a platform DOM marker bound to the message ID.
  // Literal XML/JSX text alone is never permission to rewrite an author's code.
  function message(msg,rendered){
    var s=rawMessage(msg);
    if(msg.author&&msg.author.role==='assistant'&&rendered&&rendered.component&&rendered.content){
      var out=rendered.content+'\n\n［平台组件按页面当前显示静态导出；交互操作请回原对话。］';
      return out;
    }
    return s;
  }
  // HTML-only recovery of component text. This is a literal reader, never a JS
  // evaluator. Dynamic handlers/state stay in the collapsed original source.
  function htmlComponentSource(source){
    var saved=[],masked=String(source).replace(/(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\2[ \t]*(?=\n|$)|$)|(`+)[^`\n]*?\3/g,m=>'\u0001'+(saved.push(m)-1)+'\u0002');
    return {text:masked,restore:s=>s.replace(/\u0001(\d+)\u0002/g,(_,i)=>saved[Number(i)])};
  }
  function htmlNeedsView(source){
    var s=htmlComponentSource(source).text;
    return /\{[@#](?:body|each|if)\b|<(?:col|form|radio-group|select|input|textarea|Chart|AsyncImage|WritingBlock)\s+[^>]*[={]|<(?:box|row|grid)\s+[^>]*(?:gap|align|background|radius|padding|justify|columns|value|height|width)=/.test(s);
  }
  function balancedEnd(s,start){
    var depth=0,quote='',escaped=false;
    for(var i=start;i<s.length;i++){
      var c=s[i];if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote='';continue;}
      if(c==='"'||c==="'"||c==='`'){quote=c;continue;}
      if(c==='{')depth++;if(c==='}'&&--depth===0)return i+1;
      // Only closing braces reduce depth (the decrement above is guarded).
    }
    return s.length;
  }
  function literalValue(source){
    var i=0,nodes=0;
    function ws(){while(/\s/.test(source[i]||'')&&i<source.length)i++;}
    function value(depth){
      ws();if(depth>32||++nodes>10000)throw Error('literal limit');var c=source[i];
      if(c==='"'||c==="'"){
        var q=c,out='';i++;
        while(i<source.length){c=source[i++];if(c===q)return out;if(c==='\\'){
          var e=source[i++];if(e==='u'){var hex=source.slice(i,i+4);if(!/^[a-f\d]{4}$/i.test(hex))throw Error('escape');out+=String.fromCharCode(parseInt(hex,16));i+=4;}
          else if(e==='n')out+='\n';else if(e==='t')out+='\t';else if(e==='r')out+='\r';else if(e==='\\'||e===q||e==='/')out+=e;else throw Error('escape');
        }else out+=c;}throw Error('string');
      }
      if(c==='['){i++;var a=[];ws();while(source[i]!==']'){a.push(value(depth+1));ws();if(source[i]===','){i++;ws();}else if(source[i]!==']')throw Error('array');}i++;return a;}
      if(c==='{'){i++;var o=Object.create(null);ws();while(source[i]!=='}'){
        var key;if(source[i]==='"'||source[i]==="'")key=value(depth+1);else{var k=/^[\p{ID_Start}_$][\p{ID_Continue}$\u200C\u200D]*/u.exec(source.slice(i));if(!k)throw Error('key');key=k[0];i+=key.length;}
        ws();if(source[i++]!==':')throw Error('colon');o[key]=value(depth+1);ws();if(source[i]===','){i++;ws();}else if(source[i]!=='}')throw Error('object');
      }i++;return o;}
      var m=/^(?:-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|true\b|false\b|null\b)/i.exec(source.slice(i));if(!m)throw Error('not literal');i+=m[0].length;return JSON.parse(m[0]);
    }
    var result=value(0);ws();if(i!==source.length)throw Error('expression');return result;
  }
  function literalTable(value){
    function cell(v){return String(v&&typeof v==='object'?JSON.stringify(v):v==null?'':v).replace(/\|/g,'\\|').replace(/[\r\n]+/g,' ');}
    if(!Array.isArray(value))return cell(value);
    if(!value.length)return '（空列表）';
    if(value.every(v=>v&&typeof v==='object'&&!Array.isArray(v))){
      var keys=Array.from(new Set(value.flatMap(v=>Object.keys(v))));
      return '\n\n| '+keys.map(cell).join(' | ')+' |\n| '+keys.map(()=>'---').join(' | ')+' |\n'+value.map(v=>'| '+keys.map(k=>cell(v[k])).join(' | ')+' |').join('\n')+'\n\n';
    }
    return '\n'+value.map(v=>'- '+cell(v)).join('\n')+'\n';
  }
  function htmlSourceFallback(source){
    if(String(source).length>250000)return '［此段组件过大，未还原排版；原始内容完整保留在下方。］';
    var mask=htmlComponentSource(source),s=mask.text,out='',depth=0,i=0;
    var tagNames=/^(?:box|row|col|grid|grid-item|text|title|caption|badge|list|list-item|divider|icon|checkbox|slider|segmented-control|Link|Cite|MemoryCite|WritingBlock|AsyncImage|AsyncImageGroup|Chart|form|radio-group|radio|input|textarea|select|option|button|svg|g|defs|linearGradient|stop|rect|path|circle|line|polyline|polygon|foreignObject)$/;
    while(i<s.length){
      if((i===0||s[i-1]==='\n')&&depth>0){while(s[i]===' '||s[i]==='\t')i++;}
      if(s[i]==='{'&&(depth>0||s[i+1]==='@'||s[i+1]==='#'||s[i+1]==='/')){
        var end=balancedEnd(s,i),expression=s.slice(i+1,end-1);i=end;
        if(/^@body\b/.test(expression)){out+='\n';continue;}
        if(/^#each\s/.test(expression)){
          var match=/^#each\s+([\s\S]+)\s+as\s+[A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)?$/.exec(expression);
          try{out+=literalTable(literalValue(match?match[1]:''));}catch(_){out+='\n［此列表依赖动态计算，数据请查看原对话；原始内容已保留。］\n';}
          // Skip the loop template, not the literal records. Nested loops are balanced.
          var nesting=1;while(i<s.length&&nesting){var next=s.indexOf('{',i);if(next<0){i=s.length;break;}var last=balancedEnd(s,next),directive=s.slice(next+1,last-1);if(/^#each\b/.test(directive))nesting++;if(/^\/each\b/.test(directive))nesting--;i=last;}
          continue;
        }
        if(/^[#/]/.test(expression)){out+='\n［条件内容按原始文字保留；实际显示条件请回原对话核实。］\n';continue;}
        try{out+=literalTable(literalValue(expression));}catch(_){out+='［动态值请查看原对话］';}continue;
      }
      if(s[i]==='<'){
        var name=/^<\/?([\w-]+)\b/.exec(s.slice(i));
        if(name&&tagNames.test(name[1])){
          var j=i+name[0].length,quote='';
          while(j<s.length){var c=s[j];if(quote){if(c==='\\')j++;else if(c===quote)quote='';j++;continue;}if(c==='"'||c==="'"){quote=c;j++;continue;}if(c==='{'){j=balancedEnd(s,j);continue;}if(c==='>'){j++;break;}j++;}
          var tag=s.slice(i,j),closing=tag[1]==='/',self=/\/\s*>$/.test(tag),attrs=Object.create(null);
          // Read only user-visible literal attributes; event handlers are never evaluated.
          var re=/\b(title|alt|label|placeholder|url|href|value|data)\s*=\s*/g,m;
          while((m=re.exec(tag))){var start=re.lastIndex,stop=start,raw='';
            if(tag[start]==='{'){stop=balancedEnd(tag,start);raw=tag.slice(start+1,stop-1);}
            else if(tag[start]==='"'||tag[start]==="'"){var q=tag[start];stop=start+1;while(stop<tag.length){if(tag[stop]==='\\'){stop+=2;continue;}if(tag[stop++]===q)break;}raw=tag.slice(start,stop);}
            else continue;
            try{attrs[m[1]]=literalValue(raw);}catch(_){}re.lastIndex=stop;
          }
          if(closing)depth=Math.max(0,depth-1);else if(!self)depth++;
          if(!closing){
            if(name[1]==='Link')out+='\n'+markdownLink(attrs.title||attrs.label||attrs.url||'链接',attrs.url||attrs.href)+'\n';
            else if(name[1]==='AsyncImage')out+='\n［图片：'+(attrs.alt||attrs.title||'请在原对话查看')+'］\n';
            else if(/^(?:input|textarea|slider|select)$/.test(name[1]))out+='\n［控件'+(attrs.value!==undefined?'预设值：'+attrs.value:attrs.placeholder?'提示：'+attrs.placeholder:'当前值请查看原对话')+'］\n';
            else if(name[1]==='Chart')out+='\n'+(attrs.title||'图表')+(attrs.data?literalTable(attrs.data):'［图形请在原对话查看］')+'\n';
          }
          out+='\n';i=j;continue;
        }
      }
      // DIL nesting indentation is layout, not a Markdown code block.
      if(i<s.length)out+=s[i++];
    }
    return mask.restore(out.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g,'\n\n')).trim()||'［本条没有可读取文字；原始内容完整保留在下方。］';
  }

  function sourceFallback(source){
    var saved=[],tags=[],text=String(source).replace(/(^|\n)[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]{0,3}\2[ \t]*(?=\n|$)|$)|(`+)[^`\n]*?\3/g,m=>'\u0001'+(saved.push(m)-1)+'\u0002');
    text=text.replace(/\{@body[\s\S]*?\}/g,'').replace(/<\/?(?:box|row|grid|grid-item|text|title|caption|badge|list|list-item|divider|icon|checkbox|slider|segmented-control|Link|Cite|MemoryCite|WritingBlock|AsyncImage|AsyncImageGroup|Chart)\b(?:"[^"]*"|'[^']*'|[^'">])*\/?>/g,m=>{tags.push(m);return '\n';});
    text=text.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g,'\n\n').replace(/\u0001(\d+)\u0002/g,(_,i)=>saved[Number(i)]).trim();
    if(!text){var values=tags.join(' ').match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b\d+(?:\.\d+)?\b/g)||[];text=values.length?'组件中可读取的文字/数值：\n'+values.join('、'):'这部分未提供可读取的正文；图形请在原对话查看。';}
    return text;
  }
  function fallbackHTML(text,source,format){
    if(!root.AIExportRich||!root.AIExportRich.fallbackMarkup)return null;
    var html=root.AIExportRich.fallbackMarkup(text);
    try{var renderer=root.AIExportRich.create(()=>null);renderer.useMessages([{role:'ChatGPT',content:text}],'');html='<div data-export-fallback="text"><p>［本条未取得完整页面排版，已保留可读取文字。］</p>'+renderer.freeze('').turns[0].html+'</div>';}catch(_){}
    if(format==='html'&&source)html+='<details><summary>查看此段原始内容</summary><pre>'+String(source).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</pre></details>';
    return html;
  }
  function visibleMessage(m){
    if(!m||!m.author||!['user','assistant'].includes(m.author.role))return false;
    var meta=m.metadata||{},kind=m.content&&m.content.content_type;
    if(meta.is_visually_hidden_from_conversation||meta.is_user_system_message)return false;
    if(m.recipient&&m.recipient!=='all')return false;
    if(m.author.role==='assistant'&&(m.author.name||/^(analysis|justify|confidence|summary|complete|notification)$/.test(m.channel||'')))return false;
    return !/^(thoughts|reasoning_recap|code|execution_output|tool_result|system_error|computer_response)$/.test(kind||'');
  }
  function currentMessages(data){
    var mapping=data.mapping;if(!mapping||typeof mapping!=='object')throw Error('接口未返回对话消息结构');
    var id=data.current_node;
    if(!id){var parents=new Set(Object.values(mapping).map(n=>n&&n.parent));var leaves=Object.keys(mapping).filter(k=>!parents.has(k));if(leaves.length!==1)throw Error('接口缺少当前分支，无法确定应导出的消息');id=leaves[0];}
    var path=[],seen=new Set();
    while(id){if(seen.has(id)||!mapping[id])throw Error('对话节点链不完整，未将截断内容当完整对话导出');seen.add(id);var n=mapping[id];if(visibleMessage(n.message))path.unshift(Object.assign({id:n.id||id},n.message));id=n.parent;}
    return path;
  }
  // Walk mounted message windows, not screenfuls. A long answer is captured once.
  // The API message IDs are the completion oracle; quiet DOM alone proves nothing.
  async function collectRendered(expected,options){
    options=options||{};var start=Date.now(),origin=location.pathname,cache=new Map(),steps=0;
    var anchor=document.querySelector('[data-app-action-timeline-scroll]');
    if(!anchor){var first=document.querySelector('[data-message-id],[data-chatgpt-selection-message-id]');for(var p=first&&first.parentElement;p;p=p.parentElement){if(p.scrollHeight>p.clientHeight+50&&/auto|scroll/.test(getComputedStyle(p).overflowY)){anchor=p;break;}}}
    anchor=anchor||document.scrollingElement||document.documentElement;
    var old=anchor.scrollTop,behavior=anchor.style.scrollBehavior,reverse=getComputedStyle(anchor).flexDirection==='column-reverse';
    function check(){if(location.pathname!==origin)throw Error('对话地址已改变，已停止导出');if(options.cancelled&&options.cancelled())throw Error('已停止');}
    function take(){check();snapshot(cache,options.format!=='txt'&&options.format!=='md',options.messageIds,options.format==='html').forEach(m=>{if(!options.componentIds||!options.componentIds.has(m.id)||m.component)cache.set(m.id,m);});return expected.every(id=>cache.has(id));}
    function settle(){return new Promise(resolve=>{var quiet,timer,observer=new MutationObserver(()=>{clearTimeout(quiet);quiet=setTimeout(done,80);});function done(){clearTimeout(quiet);clearTimeout(timer);observer.disconnect();resolve();}observer.observe(anchor,{childList:true,subtree:true,characterData:true});quiet=setTimeout(done,100);timer=setTimeout(done,500);});}
    function jump(pos){anchor.scrollTop=pos;anchor.dispatchEvent(new Event('scroll',{bubbles:true}));}
    try{
      if(take())return {rows:cache,elapsed:Date.now()-start,steps:steps};
      anchor.style.scrollBehavior='auto';jump(reverse?-(anchor.scrollHeight-anchor.clientHeight):0);await settle();
      var stuck=0,last='';
      while(Date.now()-start<(options.limit||12000)){
        if(take())return {rows:cache,elapsed:Date.now()-start,steps:steps};
        var turns=Array.from(document.querySelectorAll('[data-content-search-turn-key],[data-testid^="conversation-turn-"],article[data-turn-id]'));
        var rect=anchor.getBoundingClientRect(),tail=turns[turns.length-1],pos=anchor.scrollTop;
        var next=tail?pos+tail.getBoundingClientRect().top-rect.top:pos+anchor.clientHeight*.8;
        if(next<=pos+2)next=tail?pos+tail.getBoundingClientRect().bottom-rect.top-40:pos+anchor.clientHeight*.8;
        var max=anchor.scrollHeight-anchor.clientHeight;next=reverse?Math.min(0,Math.max(-max,next)):Math.max(0,Math.min(max,next));
        var signature=cache.size+':'+Math.round(pos)+':'+Math.round(max);stuck=signature===last?stuck+1:0;last=signature;
        if(stuck>=4)break;
        jump(next);steps++;await settle();
      }
      take();return {rows:cache,elapsed:Date.now()-start,steps:steps,missing:expected.filter(id=>!cache.has(id))};
    }finally{if(location.pathname===origin){anchor.scrollTop=old;anchor.style.scrollBehavior=behavior;}}
  }
  async function prepare(data,options){
    options=options||{};
    var cid=data.conversation_id||data.id;
    if(cid&&options.convId&&cid!==options.convId)throw Error('接口返回的对话身份与目标不符，未导出');
    var source=currentMessages(data),rendered=new Map(),warnings=[];
    if(source.length&&source[source.length-1].status==='in_progress')throw Error('回复仍在生成，请结束后重新导出。');
    if(location.pathname.endsWith('/c/'+options.convId)&&root.AIExportIntegrity.busy())throw Error('页面仍在生成或正在加载，请结束后重新导出。');
    // Validate the full branch first, then prepare only the requested role.
    // Excluded messages must not trigger navigation, rendering or format warnings.
    var selectedRole=options.role==='user'||options.role==='assistant'?options.role:null;
    if(selectedRole)source=source.filter(m=>m.author.role===selectedRole);
    var messageIds=selectedRole?new Set(source.map(m=>m.id)):null;
    var htmlMode=options.format==='html';
    function needsView(m){var raw=rawMessage(m);return m.author.role==='assistant'&&((candidate(raw)&&requiresView(raw))||(htmlMode&&htmlNeedsView(raw)));}
    var needs=source.filter(needsView);
    // Plain API text already has the complete branch. Only component messages
    // need a page read in TXT/Markdown; do not traverse unrelated rich DOM.
    var textOnly=options.format==='txt'||options.format==='md';
    var snapshotIds=textOnly?new Set(source.filter(m=>m.author.role==='assistant'&&candidate(rawMessage(m))).map(m=>m.id)):messageIds;
    if(location.pathname.endsWith('/c/'+options.convId)&&(!textOnly||snapshotIds.size))snapshot(null,!textOnly,snapshotIds,htmlMode).forEach(m=>rendered.set(m.id,m));
    function hasView(m){var v=rendered.get(m.id);return v&&(!htmlMode||v.component||v.content.includes(rawMessage(m)));}
    if(needs.some(m=>!hasView(m))){
      var target='/c/'+options.convId;
      try{
        if(!location.pathname.endsWith(target)&&options.navigate)await options.navigate();
        if(location.pathname.endsWith(target)){
          var wanted=htmlMode?needs.filter(m=>!hasView(m)).map(m=>m.id):needs.map(m=>m.id);
          var result=await collectRendered(wanted,Object.assign({},options,{messageIds:htmlMode?new Set(wanted):messageIds,componentIds:htmlMode?new Set(wanted):null}));
          if(htmlMode)result.rows.forEach((v,k)=>rendered.set(k,v));else rendered=result.rows;
        }
      }catch(e){if(/已停止|对话地址已改变|导出期间对话地址改变/.test(e.message))throw e;warnings.push('部分页面内容未取得，相关消息按可读取文字保存。');}
    }
    if(options.cancelled&&options.cancelled())throw Error('已停止');
    var msgs=source.map((m,index)=>{
      var view=rendered.get(m.id),s=message(m,view),richHTML=view&&view.richHTML;
      if(view&&view.formatIssues&&view.formatIssues.length){warnings.push('第 '+(index+1)+' 条消息有 '+view.formatIssues.length+' 处格式降级，已在对应位置标注。');s+='\n\n［本条有部分排版或图形未完整保存；可读取文字已保留。］';}
      if(needsView(m)&&(!view||!view.content.trim()||(!view.component&&!view.content.includes(rawMessage(m))))){
        var readable=htmlMode?(view&&view.component&&view.content||htmlSourceFallback(rawMessage(m))):(view&&view.content||sourceFallback(rawMessage(m)));
        s='［本条未取得完整页面排版，已保留可读取文字；图形请查看原对话。］\n\n'+readable;
        richHTML=fallbackHTML(readable,rawMessage(m),options.format);warnings.push('第 '+(index+1)+' 条消息未取得完整页面排版，已按可读取文字保存。');
      }
      return {id:m.id,role:m.author.role==='user'?'用户':'ChatGPT',content:s,richHTML:richHTML};
    });
    return {messages:msgs,note:'导出范围：当前分支，'+source.length+' 条'+(selectedRole==='user'?'用户':selectedRole==='assistant'?'助手':'用户/助手')+'消息；未包含其他重新生成分支。'+(Array.from(rendered.values()).some(m=>m.component)?'\n平台组件按页面当前显示静态导出，保留当前数值；交互请回原对话。':'')+(warnings.length?'\n部分格式已按文字保存，详见对应位置的说明；图形未完整保存。':''),warnings:warnings};
  }
  root.AIExportChatGPT={message:message,rawMessage:rawMessage,candidate:candidate,snapshot:snapshot,prepare:prepare,currentMessages:currentMessages,visibleMessage:visibleMessage,collectRendered:collectRendered,htmlSourceFallback:htmlSourceFallback,htmlNeedsView:htmlNeedsView};
})(typeof globalThis!=='undefined'?globalThis:this);
