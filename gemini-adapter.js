/* Gemini history identity oracle. Reads only same-origin history; never generates
   messages, uploads content, executes site code, or replaces the rich renderer. */
(function(root){
  'use strict';
  var I=root.AIExportIntegrity, RPC='hNvQHb';
  function route(){
    if(location.hostname!=='gemini.google.com')return null;
    var m=location.pathname.match(/^(\/u\/\d+)?\/(?:app\/|gem\/[a-zA-Z0-9_-]+\/)([a-zA-Z0-9_-]+)\/?$/);
    return m?{prefix:m[1]||'',cid:'c_'+m[2].replace(/^c_/,''),path:I.currentPath()}:null;
  }
  function stopped(options,target){
    if(options.cancelled&&options.cancelled())throw Error('已停止');
    if(I.currentPath()!==target)throw Error('导出期间对话地址改变，已停止以免混入其他聊天。');
  }
  function isStop(e){return /已停止|导出期间对话地址改变/.test(e&&e.message||'');}
  function bootstrap(html){
    var result={};
    for(var key of ['SNlM0e','cfb2h','FdrFJe']){
      var m=new RegExp('"'+key+'"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")').exec(html);
      if(m)try{var value=JSON.parse(m[1]);if(typeof value==='string'&&value.length<20000)result[key]=value;}catch(_){}
    }
    return result.SNlM0e?result:null;
  }
  function parseResponse(text){
    var results=[];
    // Each wire frame is one JSON line; lengths and the XSSI preamble are not JSON.
    for(var line of String(text).split('\n')){
      line=line.trim();if(!line.startsWith('['))continue;
      var frame;try{frame=JSON.parse(line);}catch(_){continue;}
      if(!Array.isArray(frame))continue;
      for(var row of frame)if(Array.isArray(row)&&row[0]==='wrb.fr'&&row[1]===RPC){
        if(typeof row[2]!=='string')throw Error('Gemini历史接口未返回消息数据');
        try{results.push(JSON.parse(row[2]));}catch(_){throw Error('Gemini历史数据格式无法核对');}
      }
    }
    if(results.length!==1)throw Error('Gemini历史响应缺失或重复');
    return results[0];
  }
  function parsePage(payload,cid){
    if(!Array.isArray(payload)||payload.length<2||!Array.isArray(payload[0]))throw Error('Gemini历史缺少明确分页边界');
    var cursor=payload[1];
    if(cursor!==null&&!(typeof cursor==='string'&&cursor.length>0&&cursor.length<20000))throw Error('Gemini历史游标格式未识别');
    var ids=[],texts=Object.create(null);
    for(var turn of payload[0]){
      var identity=turn&&turn[0],candidates=turn&&turn[3]&&turn[3][0];
      if(!Array.isArray(identity)||identity[0]!==cid||typeof identity[1]!=='string'||!/^r_[a-zA-Z0-9_-]+$/.test(identity[1]))throw Error('Gemini历史消息身份无法核对');
      // A stopped/unfinished/unknown response is handled by the mature DOM path.
      // Only confirmed finished turns qualify for this zero-scroll shortcut.
      if(!Array.isArray(candidates)||!candidates.length||!candidates.every(c=>Array.isArray(c)&&Array.isArray(c[8])&&c[8][0]===2))throw Error('Gemini回复状态未确认结束');
      if(!Array.isArray(turn[2]))throw Error('Gemini历史用户消息结构未识别');
      var id=identity[1].slice(2),user=turn[2][0]&&turn[2][0][0];
      ids.push(id);texts[id]={user:typeof user==='string'?user:null,assistant:candidates.map(c=>c[1]&&c[1][0]).filter(t=>typeof t==='string')};
    }
    if(cursor!==null&&!ids.length)throw Error('Gemini历史分页提前返回空页');
    return {ids:ids,texts:texts,cursor:cursor};
  }
  async function history(options){
    options=options||{};var r=route();if(!r)throw Error('当前不是可识别的Gemini对话');
    var target=options.target||r.path;stopped(options,target);
    var started=Date.now(),controller=new AbortController(),deadline=options.historyTimeout||6000;
    var poll=setInterval(()=>{try{stopped(options,target);if(Date.now()-started>deadline)controller.abort();}catch(_){controller.abort();}},100);
    async function request(url,init){
      stopped(options,target);var response=await fetch(url,Object.assign({credentials:'include',signal:controller.signal},init));
      stopped(options,target);if(!response.ok)throw Error('Gemini历史读取 HTTP '+response.status);
      if(response.url&&new URL(response.url,location.href).origin!==location.origin)throw Error('Gemini历史读取离开当前站点');
      var body=await response.text();stopped(options,target);return body;
    }
    try{
      var config=null;
      for(var script of document.querySelectorAll('script:not([src])')){config=bootstrap(script.textContent||'');if(config)break;}
      if(!config)config=bootstrap(await request(r.prefix+'/app',{}));
      if(!config)throw Error('Gemini当前页面未提供历史读取凭据');
      var cursor=null,seenCursors=new Set(),seenIds=new Set(),newest=[],texts=Object.create(null),pages=0;
      do{
        var key=JSON.stringify(cursor);if(seenCursors.has(key))throw Error('Gemini历史分页重复，未将截断记录当完整');seenCursors.add(key);
        if(++pages>100)throw Error('Gemini历史超过核对上限');
        var query=new URLSearchParams({rpcids:RPC,'source-path':location.pathname,rt:'c','_reqid':String(Date.now()%10000000)});
        if(config.cfb2h)query.set('bl',config.cfb2h);if(config.FdrFJe)query.set('f.sid',config.FdrFJe);
        var args=[r.cid,100,cursor,1,[1],[4],null,1];
        var body=new URLSearchParams({'f.req':JSON.stringify([[[RPC,JSON.stringify(args),null,'generic']]]),at:config.SNlM0e});
        var page=parsePage(parseResponse(await request(r.prefix+'/_/BardChatUi/data/batchexecute?'+query.toString(),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','X-Same-Domain':'1'},body:body.toString()})),r.cid);
        for(var id of page.ids){if(seenIds.has(id))throw Error('Gemini历史消息ID重复，无法核对分页顺序');seenIds.add(id);newest.push(id);texts[id]=page.texts[id];}
        cursor=page.cursor;
      }while(cursor!==null);
      stopped(options,target);if(!newest.length)throw Error('Gemini历史为空，不能证明页面完整');
      return {target:target,ids:newest.reverse(),texts:texts,pages:pages,elapsed:Date.now()-started};
    }catch(error){stopped(options,target);if(controller.signal.aborted)throw Error('Gemini历史核对超时');throw error;}
    finally{clearInterval(poll);controller.abort();}
  }
  function rowIdentity(message){
    var node=message.element&&message.element.closest('.conversation-container[id]');
    if(!node||!message.content||!message.content.trim())return null;
    var role=message.role==='用户'?'user':message.role==='Gemini'?'assistant':null;
    return role?{id:node.id.replace(/^r_/,''),role:role}:null;
  }
  function normalized(s){return String(s).replace(/[\s\u200b-\u200d\ufeff]/g,'');}
  function mathKey(tex){
    return 'GEMMATH'+Array.from(normalized(tex)).map(c=>c.codePointAt(0).toString(16).padStart(6,'0')).join('')+'ENDMATH';
  }
  function compileSource(source,preserveCitations,cjkEmphasis){
    if(!root.marked||!root.marked.lexer)return null;
    var codes=[],mathCount=0,citations=0,htmlTags=new Set();
    // Literal code must never be interpreted as a formula or a platform marker.
    var masked=String(source).replace(/(^|\n)[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]{0,3}\2[ \t]*(?=\n|$)|$)|(`+)[^`\n]*?\3/g,m=>'GEMCODE'+(codes.push(m)-1)+'ENDCODE');
    if(cjkEmphasis)masked=entryCjkEmphasis(masked);
    if(!preserveCitations)masked=masked.replace(/\[cite:\s*\d+(?:\s*,\s*\d+)*\s*\]/g,()=>{citations++;return '';});
    if(citations)masked=masked.replace(/\[cite_start\]/g,'');
    masked=masked.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$([^$\n]+?)\$/g,(_,a,b,c,d)=>{mathCount++;return mathKey(a||b||c||d);});
    masked=masked.replace(/GEMCODE(\d+)ENDCODE/g,(_,i)=>codes[Number(i)]);
    function decode(s){return String(s).replace(/&(?:#\d+|#x[\da-f]+|[a-z]+);/gi,x=>{var el=document.createElement('textarea');el.innerHTML=x;return el.value;});}
    var safeTags=new Set('p div span b strong em i u s del mark br hr h1 h2 h3 h4 h5 h6 ul ol li blockquote table thead tbody tfoot tr td th a button code pre sup sub img follow-up response-element'.split(' '));
    function htmlText(raw){
      // Inert template only. Reject executable, remote or unknown components,
      // hidden content and dynamic values instead of inventing their rendering.
      var names=Array.from(raw.matchAll(/<\/?([a-z][\w-]*)\b/gi)).map(m=>m[1].toLowerCase());
      names.forEach(n=>htmlTags.add(n));
      if(names.some(n=>!safeTags.has(n))||/\bon\w+\s*=|\bhidden\b|aria-hidden\s*=\s*["']?true|=\s*\{/i.test(raw))return null;
      var t=document.createElement('template');t.innerHTML=raw;
      function plain(n){
        if(n.nodeType===3)return n.nodeValue||'';
        if(n.nodeType!==1&&n.nodeType!==11)return '';
        if(n.nodeType===1){
          // Custom attributes may carry visible choices; unknown attributes
          // cannot silently disappear from the completeness proof.
          if(n.localName.includes('-')&&Array.from(n.attributes).some(a=>!['class','id','style'].includes(a.name)))return null;
          if(n.localName==='img')return n.getAttribute('alt')||'';
        }
        var out='';for(var child of n.childNodes){var value=plain(child);if(value===null)return null;out+=value;}return out;
      }
      return plain(t.content);
    }
    function walk(tokens){
      var out='';for(var t of tokens){
        if(t.type==='space'||t.type==='hr'||t.type==='br')continue;
        var value;
        if(t.type==='html')value=htmlText(t.text||t.raw||'');
        else if(t.type==='table')value=walk(t.header.concat(...t.rows));
        else if(t.type==='list')value=walk(t.items);
        else if(t.tokens)value=walk(t.tokens);
        else if(t.type==='code'||t.type==='codespan')value=t.text;
        else if(typeof t.text==='string')value=decode(t.text);
        else return null;
        if(value===null)return null;out+=value;
      }return out;
    }
    try{var text=walk(root.marked.lexer(masked));return text===null?null:{text:text,mathCount:mathCount,citations:citations,htmlTags:Array.from(htmlTags)};}catch(_){return null;}
  }
  function renderedSource(message){
    var element=message.element,body=element&&(element.querySelector('.markdown')||element);
    if(!body)return null;
    var mathCount=0,footnotes=body.querySelectorAll('source-footnote').length;
    function walk(n){
      if(n.nodeType===3)return n.nodeValue||'';
      if(n.nodeType!==1)return '';
      if(n.matches('script,style,template,noscript,source-footnote,sources-carousel-inline,source-inline-chip,[hidden],[aria-hidden="true"]'))return '';
      var style=getComputedStyle(n);if(style.display==='none'||style.visibility==='hidden')return '';
      if(n.matches('.katex,math')){
        var tex=n.querySelector('annotation[encoding="application/x-tex"]');
        if(tex){mathCount++;return mathKey(tex.textContent);}
        return '';
      }
      if(n.localName==='img')return n.getAttribute('alt')||'';
      return Array.from(n.childNodes).map(walk).join('');
    }
    return {text:walk(body),mathCount:mathCount,footnotes:footnotes};
  }
  function textState(message,proof){
    var ident=rowIdentity(message);if(!ident||!proof.texts||!proof.texts[ident.id])return null;
    var expected=proof.texts[ident.id],actual=normalized(message.content);
    if(ident.role==='user')return expected.user&&normalized(expected.user)?actual.includes(normalized(expected.user)):null;
    if(!proof.compiled)proof.compiled=new Map();
    var alternatives=expected.assistant.flatMap(source=>{if(!proof.compiled.has(source)){var parsed=[compileSource(source,false),compileSource(source,false,true)];if(/\[cite:\s*\d/.test(source))parsed.push(compileSource(source,true));proof.compiled.set(source,parsed);}return proof.compiled.get(source);});
    var unknown=!alternatives.length,rendered=null;
    for(var item of alternatives){
      if(!item||!normalized(item.text)){unknown=true;continue;}
      if(item.mathCount||item.citations||item.htmlTags.length){
        if(!rendered)rendered=renderedSource(message);
        if(!rendered||rendered.mathCount<item.mathCount){unknown=true;continue;}
        if(normalized(rendered.text).includes(normalized(item.text))){if(rendered.footnotes>=item.citations)return true;unknown=true;}
      }else if(actual.includes(normalized(item.text)))return true;
    }
    if(entryEmptyListTail(message,expected.assistant))return true;
    return unknown?null:false;
  }
  function checked(messages,proof,connected){
    if(!messages||messages.length!==proof.ids.length*2)return false;
    return messages.every((m,i)=>{var ident=rowIdentity(m);return ident&&(!connected||m.element.isConnected)&&ident.id===proof.ids[Math.floor(i/2)]&&ident.role===(i%2?'assistant':'user')&&textState(m,proof)===true;});
  }
  async function collectCore(read,options,diagnostic){
    options=options||{};var fallback=root.AIExportText||I,proof;
    try{proof=await history(options);}catch(error){
      if(isStop(error))throw error;
      diagnostic.path='dom-fallback';diagnostic.reason=safeReason(error);
      var result=await fallback.collect(read,options);
      result.note='Gemini历史核对未完成（'+diagnostic.reason+'）；'+result.note;
      return result;
    }
    diagnostic.pages=proof.pages;diagnostic.turns=proof.ids.length;diagnostic.historyMs=proof.elapsed;
    diagnostic.path='native';
    stopped(options,proof.target);
    var current=read();
    var coverage=current.map(m=>textState(m,proof));
    diagnostic.coverage={verified:coverage.filter(v=>v===true).length,unknown:coverage.filter(v=>v===null).length,mismatch:coverage.filter(v=>v===false).length};
    if(diagnostic.coverage.mismatch)try{diagnostic.textComparison=entryTextDiagnostics(current,proof);}catch(_){diagnostic.textComparison='unavailable';}
    diagnostic.formats={emptyUserSources:Object.values(proof.texts).filter(t=>!t.user).length,emptyAssistantSources:Object.values(proof.texts).filter(t=>!t.assistant.some(s=>s.trim())).length,htmlSources:Object.values(proof.texts).filter(t=>t.assistant.some(s=>/<[a-z][^>]*>/i.test(s))).length,renderedMath:document.querySelectorAll('model-response annotation[encoding="application/x-tex"]').length,followUps:document.querySelectorAll('model-response follow-up').length};
    if(!I.busy()&&checked(current,proof,true))return {messages:current,complete:true,note:'Gemini历史接口已核对 '+proof.ids.length+' 轮、'+current.length+' 条消息；页面正文齐全，未滚动。附件仍按原格式记录。'};
    diagnostic.path='dom-fill';
    var result=await fallback.collect(read,Object.assign({},options,{target:proof.target}));
    stopped(options,proof.target);
    // Do not hide a known missing turn behind the old "unknown completeness" note.
    var found=new Set(result.messages.map(rowIdentity).filter(Boolean).map(x=>x.id+':'+x.role));
    if(proof.ids.some(id=>!found.has(id+':user')||!found.has(id+':assistant')))throw Error('Gemini历史核对发现仍有消息未加载，未生成截断文件，请待页面恢复后重试。');
    if(result.messages.some(m=>textState(m,proof)===false))throw Error('Gemini历史正文尚未完整呈现，未生成截断文件，请待页面恢复后重试。');
    if(checked(result.messages,proof,false))return {messages:result.messages,complete:true,note:'Gemini历史接口已核对 '+proof.ids.length+' 轮、'+result.messages.length+' 条消息；缺失的页面内容已补采。附件仍按原格式记录。'};
    result.note='Gemini历史已核对 '+proof.ids.length+' 轮；部分结构化正文尚未完成逐字校验。'+result.note;
    return result;
  }
  function safeReason(error){
    var text=String(error&&error.message||'');
    return /^(Gemini|已停止|导出期间对话地址改变)/.test(text)?text.slice(0,120):'接口暂不可用';
  }
  async function collect(read,options){
    var started=Date.now(),diagnostic={version:'1.6.23',path:'history',pageScrollEvents:0};
    var area=document.querySelector('[data-test-id="chat-history-container"]');
    function onScroll(){diagnostic.pageScrollEvents++;}
    if(area)area.addEventListener('scroll',onScroll,{passive:true});
    try{
      var result=await collectCore(read,options,diagnostic);
      diagnostic.outcome='collected';diagnostic.messages=result.messages.length;diagnostic.complete=result.complete===true;
      return result;
    }catch(error){diagnostic.outcome='stopped';diagnostic.reason=safeReason(error);throw error;}
    finally{
      if(area)area.removeEventListener('scroll',onScroll);
      diagnostic.elapsedMs=Date.now()-started;
      // Local developer console only; no message text, IDs, URLs or auth data.
      if(root.console&&root.console.info)root.console.info('[AIExport Gemini]',JSON.stringify(diagnostic));
    }
  }
  root.AIExportGemini={version:'1.6.23',ownsPage:()=>!!route(),collect:collect,history:history,parsePage:parsePage,parseResponse:parseResponse,checked:checked};
  // Gemini removes emphasis markers next to Chinese text and opening quotes,
  // even when CommonMark's delimiter-flanking rule leaves them literal. This
  // runs after code masking, only as an alternative full-body comparison.
  function entryCjkEmphasis(source) {
    return source.replace(/(?<![\\*])\*\*(?!\*)([^*\n]+?)\*\*(?!\*)/g,function(all,inner,offset,whole){
      var before=whole[offset-1]||'',after=whole[offset+all.length]||'';
      var leading=/^[“‘「『（《【]/.test(inner)&&/\p{Script=Han}/u.test(before);
      var trailing=/[”’」』）》】]$/.test(inner)&&/\p{Script=Han}/u.test(after);
      return leading||trailing?inner:all;
    });
  }
  function entryEmptyListTail(message,sources){
    var body=message.element&&(message.element.querySelector('.markdown')||message.element),list=body&&body.lastElementChild;
    if(!list||list.localName!=='ol')return false;
    var items=Array.from(list.children);if(!items.length||items.some(n=>n.localName!=='li'))return false;
    var last=items[items.length-1];if(last.children.length||last.textContent.trim())return false;
    var ordinal=Number(list.getAttribute('start')||1)+items.length-1,rendered=renderedSource(message);
    if(!rendered)return false;
    return sources.some(raw=>{
      var tail=/(?:^|\n)([ \t]{0,3})(\d+)\.[ \t]+\*\*[ \t]*$/.exec(raw);
      if(!tail||Number(tail[2])!==ordinal)return false;
      var compatible=raw.slice(0,tail.index)+(tail.index?'\n':'')+tail[1]+tail[2]+'.';
      var parsed=compileSource(compatible,false,true);
      return !!parsed&&!!normalized(parsed.text)&&rendered.mathCount>=parsed.mathCount&&rendered.footnotes>=parsed.citations&&normalized(rendered.text)===normalized(parsed.text);
    });
  }
  // Native Gemini sidebar links can redirect /app/CID to /gem/GID/CID.
  // Only accept this observed alias for the same account prefix and exact CID.
  if(I&&location.hostname==='gemini.google.com'&&!I.geminiNavigation){
    var originalNavigate=I.navigate;
    function gemPath(path){var m=path.match(/^(\/u\/\d+)?\/(?:app\/([A-Za-z0-9_-]+)|gem\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+))\/?$/);return m?{prefix:m[1]||'',cid:m[2]||m[4],gem:m[3]||''}:null;}
    function gemSignature(){return Array.from(document.querySelectorAll('user-query,model-response')).map(n=>((n.closest('.conversation-container[id]')||{}).id||'')+'\0'+I.text(n)).join('\u001e');}
    I.navigate=function(el,options){
      options=options||{};var target;try{target=I.path(el.getAttribute('href'));}catch(e){return Promise.reject(e);}
      var wanted=gemPath(target);if(!wanted)return originalNavigate(el,options);
      var previous=gemSignature(),started=Date.now();
      function matches(current){var at=gemPath(current);return current===target||!!(at&&!wanted.gem&&at.gem&&at.prefix===wanted.prefix&&at.cid===wanted.cid);}
      if(options.cancelled&&options.cancelled())return Promise.reject(Error('已停止'));
      if(matches(I.currentPath())&&!I.busy())return Promise.resolve(I.currentPath());
      return new Promise((resolve,reject)=>{
        var timer,observer,done=false;
        function finish(error){if(done)return;done=true;clearTimeout(timer);if(observer)observer.disconnect();error?reject(error):resolve(I.currentPath());}
        function check(){
          if(done)return;if(options.cancelled&&options.cancelled()){finish(Error('已停止'));return;}
          var signature=gemSignature();
          if(matches(I.currentPath())&&signature&&signature!==previous&&!I.busy()){finish();return;}
          if(Date.now()-started>(options.timeout||15000)){finish(Error('未完成切换到目标对话，未导出上一段聊天。'));return;}
          clearTimeout(timer);timer=setTimeout(check,100);
        }
        observer=new MutationObserver(check);observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['aria-busy','data-is-streaming','data-message-id','id']});
        try{el.click();check();}catch(e){finish(e);}
      });
    };
    I.geminiNavigation=true;
  }
  // Local-only mismatch metadata. No credentials, URLs, IDs or full message text.
  function entryTextDiagnostics(messages, proof) {
    function delta(expected, actual) {
      var p=0,s=0;
      while(p<Math.min(expected.length,actual.length)&&expected[p]===actual[p])p++;
      while(s<Math.min(expected.length,actual.length)-p&&expected[expected.length-1-s]===actual[actual.length-1-s])s++;
      function codepoints(text){return Array.from(text.slice(Math.max(0,p-2),p+12)).map(c=>c.codePointAt(0).toString(16));}
      return {expectedLength:expected.length,actualLength:actual.length,prefix:p,suffix:s,expectedCodes:codepoints(expected),actualCodes:codepoints(actual)};
    }
    return messages.map((message,index)=>{
      if(textState(message,proof)!==false)return null;
      var ident=rowIdentity(message),source=proof.texts[ident.id],actual=normalized(message.content),rendered=renderedSource(message);
      return {message:index+1,role:ident.role,alternatives:(ident.role==='user'?[source.user]:source.assistant).map(raw=>{
        var compiled=ident.role==='user'?{text:raw}:compileSource(raw,false);
        if(!compiled)return {compiled:false,sourceLength:raw.length};
        var expected=normalized(compiled.text),render=rendered?normalized(rendered.text):'';
        return {sourceLength:raw.length,sourceTailCodes:Array.from(raw.slice(-24)).map(c=>c.codePointAt(0).toString(16)),math:compiled.mathCount||0,citations:compiled.citations||0,html:compiled.htmlTags||[],renderedContainsExpected:!!render&&render.includes(expected),renderedLength:render.length,renderedDelta:delta(expected,render),...delta(expected,actual)};
      })};
    }).filter(Boolean).slice(0,10);
  }

})(globalThis);
