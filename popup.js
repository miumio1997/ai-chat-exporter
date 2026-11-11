'use strict';

function releaseRuntime() {
  return typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime : null;
}

function safeReleaseUrl(url) {
  return typeof url === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(url);
}

function compareVersions(current, latest) {
  var a = String(current || '').split(/[^\d]+/).filter(Boolean).map(Number);
  var b = String(latest || '').split(/[^\d]+/).filter(Boolean).map(Number);
  var len = Math.max(a.length, b.length);
  for (var i = 0; i < len; i += 1) {
    var av = a[i] || 0;
    var bv = b[i] || 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

function loadReleaseConfig() {
  var runtime = releaseRuntime();
  if (!runtime || !runtime.getURL || typeof fetch !== 'function') return Promise.resolve({});
  return fetch(runtime.getURL('release-config.json'), {cache: 'no-store'})
    .then(function(response) {
      if (!response.ok) throw new Error('配置读取失败：' + response.status);
      return response.json();
    });
}

function releasePrimaryUrl(config) {
  var candidates = [
    config && config.homepageUrl,
    config && config.releaseNotesUrl,
    config && config.downloadUrl
  ];
  for (var i = 0; i < candidates.length; i += 1) {
    if (safeReleaseUrl(candidates[i])) return candidates[i];
  }
  return '';
}


function releaseTextFromHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&middot;/gi, '·')
    .replace(/&#183;/gi, '·')
    .replace(/\s+/g, ' ')
    .trim();
}

function releaseDataFromHtml(html, config) {
  var raw = String(html || '');
  var jsonMatch = raw.match(/<script[^>]*id=["']release-data["'][^>]*>([\s\S]*?)<\/script>/i);
  if (jsonMatch && jsonMatch[1]) {
    try {
      var embedded = JSON.parse(jsonMatch[1].trim());
      if (embedded.latestVersion || embedded.version) return embedded;
    } catch (embeddedError) {}
  }
  var text = releaseTextFromHtml(html);
  var version = '';
  var date = '';
  var versionPatterns = [
    /v\s*([0-9]+(?:\.[0-9]+){0,3})\s*(?:·|上次更新|更新日期|[-_])/i,
    /(?:版本|当前)\s*v?\s*([0-9]+(?:\.[0-9]+){0,3})/i,
    /[_-]v?([0-9]+(?:\.[0-9]+){1,3})\.zip/i
  ];
  for (var i = 0; i < versionPatterns.length; i += 1) {
    var match = text.match(versionPatterns[i]);
    if (match && match[1]) {
      version = match[1];
      break;
    }
  }
  var dateMatch = text.match(/(?:上次更新|更新日期|last\s*updated)\s*[：:]\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
  if (dateMatch && dateMatch[1]) date = dateMatch[1];
  return {
    latestVersion: version,
    version: version,
    lastUpdated: date,
    homepageUrl: releasePrimaryUrl(config)
  };
}

function readReleaseResponse(response, config) {
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.text().then(function(text) {
    var contentType = response.headers && response.headers.get ? String(response.headers.get('content-type') || '') : '';
    try {
      return JSON.parse(text);
    } catch (jsonError) {
      if (/html/i.test(contentType) || /^\s*</.test(text)) {
        var data = releaseDataFromHtml(text, config);
        if (data.latestVersion) return data;
        throw new Error('线上安装页没有读到版本号');
      }
      throw new Error('线上版本信息不是有效 JSON');
    }
  });
}

function setReleaseStatus(text, kind) {
  var el = document.getElementById('releaseStatus');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('ok', kind === 'ok');
  el.classList.toggle('warn', kind === 'warn');
}

function openReleasePage(url) {
  if (!safeReleaseUrl(url)) return;
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({url: url});
    return;
  }
  window.open(url, '_blank', 'noopener');
}

function initReleasePanel() {
  var runtime = releaseRuntime();
  var manifest = runtime && runtime.getManifest ? runtime.getManifest() : {};
  var currentVersion = manifest.version || '';
  var currentVersionEl = document.getElementById('currentVersion');
  var openBtn = document.getElementById('openReleasePageBtn');
  var checkBtn = document.getElementById('checkReleaseBtn');
  if (!currentVersionEl || !openBtn || !checkBtn) return;
  currentVersionEl.textContent = currentVersion ? 'v' + currentVersion : 'v--';

  loadReleaseConfig().then(function(config) {
    config = config || {};
    var pageUrl = releasePrimaryUrl(config);
    var updateUrl = safeReleaseUrl(config.updateUrl) ? config.updateUrl : '';
    openBtn.disabled = !pageUrl;
    checkBtn.disabled = !updateUrl;
    if (!pageUrl) openBtn.title = 'release-config.json 暂未配置安装页地址';
    if (!updateUrl) checkBtn.title = 'release-config.json 暂未配置更新 JSON 地址';
    setReleaseStatus(pageUrl ? '当前 ' + currentVersionEl.textContent + '。可打开安装页查看更新。' : '当前 ' + currentVersionEl.textContent + '。暂无在线更新地址。');

    openBtn.addEventListener('click', function() {
      openReleasePage(releasePrimaryUrl(config));
    });
    checkBtn.addEventListener('click', function() {
      if (!updateUrl) return;
      checkBtn.disabled = true;
      setReleaseStatus('正在检查更新...');
      fetch(updateUrl, {cache: 'no-store'})
        .then(function(response) {
          return readReleaseResponse(response, config);
        })
        .then(function(data) {
          var latestVersion = data.latestVersion || data.version || '';
          var targetUrl = releasePrimaryUrl(data) || releasePrimaryUrl(config);
          if (targetUrl) {
            config.homepageUrl = targetUrl;
            openBtn.disabled = false;
          }
          if (!latestVersion) {
            setReleaseStatus('已连接安装页，但没有读到版本号。', 'warn');
            return;
          }
          if (compareVersions(currentVersion, latestVersion) < 0) {
            setReleaseStatus('发现新版 v' + latestVersion + '，请打开安装页下载。', 'warn');
          } else if(compareVersions(currentVersion,latestVersion)>0){
            setReleaseStatus('当前安装 v'+currentVersion+'，线上提供 v'+latestVersion+'。如需回退，请打开安装页按说明更换插件。','warn');
          } else {
            setReleaseStatus('当前已是最新版本 v' + currentVersion + '。', 'ok');
          }
        })
        .catch(function(error) {
          var message = error && error.message ? error.message : '网络或更新文件读取失败';
          setReleaseStatus('检查未完成：' + message + '。可打开安装页手动查看。', 'warn');
        })
        .then(function() {
          checkBtn.disabled = false;
        });
    });
  }).catch(function() {
    openBtn.disabled = true;
    checkBtn.disabled = true;
    setReleaseStatus('当前 ' + currentVersionEl.textContent + '。更新配置未读取到。', 'warn');
  });
}

initReleasePanel();

function runInPage(fn){chrome.tabs.query({active:true,currentWindow:true},function(tabs){chrome.scripting.executeScript({target:{tabId:tabs[0].id},func:fn});});}

function runInPageWithArgs(fn,args){
  function failed(message){ setReleaseStatus(message,'warn'); alert(message); }
  if(typeof chrome==='undefined'||!chrome.tabs||!chrome.scripting||!chrome.scripting.executeScript){
    failed('当前浏览器缺少所需扩展接口，请使用支持 Manifest V3 的电脑端 Chrome / Edge。');return;
  }
  chrome.tabs.query({active:true,currentWindow:true},function(tabs){
    if(chrome.runtime.lastError){failed('无法读取当前标签页：'+chrome.runtime.lastError.message);return;}
    if(!tabs||!tabs[0]||typeof tabs[0].id!=='number'){failed('没有找到可读取的当前标签页。');return;}
    var tab=tabs[0],target={tabId:tab.id},fmt=args[args.length-1];
    if(tab.url && !/^https?:\/\//i.test(tab.url)){failed('请先打开 AI 网站中的具体聊天。浏览器设置页、扩展商店及本地文件不能直接提取。');return;}
    var files=['export-integrity.js'];
    files.push('text-export.js');
    if(tab.url && /^https?:\/\/gemini\.google\.com(?:\/|$)/i.test(tab.url)){files.push('gemini-adapter.js');if(['html','word','pdf'].indexOf(fmt)<0)files.push('vendor/marked.umd.js');}
    if(tab.url && /^https?:\/\/(chatgpt\.com|chat\.openai\.com)(?:\/|$)/i.test(tab.url)) files.push('chatgpt-adapter.js');
    if(tab.url && /^https?:\/\/([^/]+\.)?doubao\.com(?:\/|$)/i.test(tab.url)) files.push('doubao-adapter.js');
    if(['html','word','pdf'].indexOf(fmt)>=0) files.push('vendor/marked.umd.js','rich-export.js');
    function run(){
      chrome.scripting.executeScript({target:target,func:fn,args:args},function(){
        if(chrome.runtime.lastError){failed('无法在此页启动提取：'+chrome.runtime.lastError.message+'。请检查扩展的网站访问权限，刷新对话页后重试。');return;}
        window.close();
      });
    }
    if(!files.length){run();return;}
    chrome.scripting.executeScript({target:target,files:files},function(){
      if(chrome.runtime.lastError){failed('提取模块加载失败：'+chrome.runtime.lastError.message+'。请重新加载插件并刷新对话页。');return;}
      run();
    });
  });
}

function fnSingle(format) {
  format = format || 'txt';
  var _rich = ['html','word','pdf'].indexOf(format)>=0 && typeof AIExportRich!=='undefined' ? AIExportRich.create(_parseConv) : null;
  var host = location.hostname;
  var msgs = [], seen = new Set(), pname = host;
  var _dbNote='',_sourceAtStart=location.href,_fileSource=location.href;
  function cleanText(t){ return String(t==null?'':t); }

  // === 多格式输出：txt / md / html / word / pdf（单条与批量共用同一套）===
  var _I=typeof AIExportIntegrity!=='undefined'?AIExportIntegrity:null, _typed=null;
  function remember(messages,header){_typed=_I?_I.typed(messages,header):null;if(_rich)_rich.useMessages(messages,header);}
  function _parseConv(plain){
    if(_typed)return _typed;
    var marker='='.repeat(50);
    var mi=plain.indexOf(marker), header='', body=plain;
    if(mi>=0){ header=plain.slice(0,mi).trim(); body=plain.slice(mi+marker.length).replace(/^\s+/,''); }
    var blocks=body.split(/\n\n(?=【[^\n】]*?说(?: - V\d+)?】\n)/);
    var turns=[];
    blocks.forEach(function(b){
      var m=b.match(/^【([^\n】]*?说)(?: - (V\d+))?】\n?([\s\S]*)$/);
      if(m){ turns.push({label:m[1],version:m[2]||'',content:(m[3]||'').trim(),isUser:m[1].indexOf('用户')===0}); }
      else if(b.trim()){ turns.push({label:'',version:'',content:b.trim(),isUser:false}); }
    });
    return {header:header,turns:turns};
  }
  function _esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function _convHTML(plain){
    if(_rich)return _rich.conversation(plain,false);
    var c=_parseConv(plain), h='';
    if(c.header){ h+='<div class="meta">'+_esc(c.header).replace(/\n/g,'<br>')+'</div>'; }
    c.turns.forEach(function(t){
      var who=t.isUser?'user':'ai';
      var name=_esc(t.label.replace(/说$/,''))+(t.version?' · '+t.version:'');
      h+='<div class="turn '+who+'"><div class="who">'+name+'</div><div class="bubble">'+_esc(t.content)+'</div></div>';
    });
    return h;
  }
  function _htmlPage(inner,forWord,docTitle){
    if(_rich)return _rich.page(inner,docTitle);
    var css='body{font-family:-apple-system,"PingFang SC",sans-serif;background:#fff;color:#1a1a1a;max-width:780px;margin:0 auto;padding:32px 24px;line-height:1.75;}.meta{font-size:13px;color:#666;background:#f5f3ff;border-radius:10px;padding:12px 16px;margin-bottom:24px;white-space:pre-wrap;}.turn{margin-bottom:22px;}.who{font-size:13px;font-weight:700;margin-bottom:6px;}.turn.user .who{color:#6366F1;}.turn.ai .who{color:#0f9d77;}.bubble{white-space:pre-wrap;word-wrap:break-word;border-radius:12px;padding:14px 16px;font-size:15px;}.turn.user .bubble{background:#EEF2FF;}.turn.ai .bubble{background:#ECFDF5;}.conv-sep{page-break-after:always;height:0;}@media print{body{padding:0;max-width:none;}.turn{break-inside:avoid;}}';
    var head='<meta charset="utf-8"><title>'+_esc(docTitle||'AI对话导出')+'</title><style>'+css+'</style>';
    if(forWord){ return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head>'+head+'</head><body>'+inner+'</body></html>'; }
    return '<!DOCTYPE html><html><head>'+head+'</head><body>'+inner+'</body></html>';
  }
  function _toMD(plain){
    var c=_parseConv(plain), out=[];
    if(c.header){ c.header.split('\n').forEach(function(l){ out.push('> '+l); }); out.push(''); }
    c.turns.forEach(function(t){
      var name=t.label.replace(/说$/,'')+(t.version?' ('+t.version+')':'');
      out.push('## '+(t.isUser?'🧑':'🤖')+' '+name); out.push(''); out.push(t.content); out.push('');
    });
    return out.join('\n').trim()+'\n';
  }
  function _dlBlob(data,mime,fname){
    var blob=new Blob([data],{type:mime+';charset=utf-8'});
    var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=fname;
    document.body.appendChild(a); a.click(); setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(a.href);},600);
  }
  function _printHTML(htmlDoc){
    var ifr=document.createElement('iframe');
    ifr.setAttribute('style','position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;');
    document.body.appendChild(ifr);
    var d=ifr.contentWindow.document; d.open(); d.write(htmlDoc); d.close();
    setTimeout(function(){ try{ ifr.contentWindow.focus(); ifr.contentWindow.print(); }catch(e){ alert('唤起打印失败：'+(e&&e.message)); } setTimeout(function(){ if(ifr.parentNode) ifr.parentNode.removeChild(ifr); },60000); },400);
  }
  function _printMany(list,docTitle){ var inner=list.map(function(p){return _convHTML(p);}).join('<div class="conv-sep"></div>'); _printHTML(_htmlPage(inner,false,docTitle)); }
  function _cleanFilePart(value){
    return String(value||'')
      .replace(/[<>:"/\\|?*\u0000-\u001F\u007F]+/g,'_')
      .replace(/\s+/g,'_')
      .replace(/_+/g,'_')
      .replace(/^[._\-]+|[._\-]+$/g,'')
      .slice(0,80);
  }
  function _stripPlatform(rawName,pn){
    var name=String(rawName||'').trim();
    var aliases={
      'ChatGPT':['ChatGPT','OpenAI'],
      'Claude':['Claude'],
      'Gemini':['Gemini','Google Gemini'],
      'DeepSeek':['DeepSeek'],
      '豆包':['豆包'],
      'Kimi':['Kimi','Moonshot'],
      '通义千问':['通义千问','Qwen']
    }[pn]||[pn];
    aliases.filter(Boolean).forEach(function(alias){
      var escaped=String(alias).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      name=name.replace(new RegExp('^'+escaped+'(?:[\\s_\\-—–|·:：]+)','i'),'');
      name=name.replace(new RegExp('(?:[\\s_\\-—–|·:：]+)'+escaped+'$','i'),'');
      if(name.toLowerCase()===String(alias).toLowerCase())name='';
    });
    return name;
  }
  function _filenameBase(rawName,pn){
    var platform=_cleanFilePart(pn||'AI')||'AI';
    if(!/聊天记录$/.test(platform))platform+='聊天记录';
    var conversation=_cleanFilePart(_stripPlatform(rawName,pn))||'对话';
    return (platform+'_'+conversation).slice(0,100).replace(/[._\-]+$/g,'');
  }
  function _fname(rawName,pn,ext,source){ return _I.filename(_filenameBase(rawName,pn),ext,source===undefined?_fileSource:source); }
  // Word 专用渲染：Word 对 <style> class 和 div 背景支持差，改用「单元格表格 bgcolor + 行内样式 + 彩色左边框」做用户/AI 区分
  function _wordDoc(plain){
    if(_rich)return _rich.word(plain);
    var c=_parseConv(plain), b='';
    if(c.header){ b+='<p style="font-size:12px;color:#666;background:#F5F3FF;padding:8px 10px;margin:0 0 16px;">'+_esc(c.header).replace(/\n/g,'<br>')+'</p>'; }
    c.turns.forEach(function(t){
      var u=t.isUser, nameColor=u?'#4338CA':'#047857', bg=u?'#EEF2FF':'#ECFDF5', bd=u?'#6366F1':'#10B981';
      var name=_esc(t.label.replace(/说$/,''))+(t.version?' · '+t.version:'');
      b+='<p style="margin:0 0 4px;font-weight:bold;color:'+nameColor+';font-size:14px;">'+name+'</p>';
      b+='<table width="100%" cellspacing="0" cellpadding="9" style="border-collapse:collapse;margin:0 0 16px;"><tr><td bgcolor="'+bg+'" style="background:'+bg+';border-left:4px solid '+bd+';font-size:13px;line-height:1.7;color:#1a1a1a;">'+_esc(t.content).replace(/\n/g,'<br>')+'</td></tr></table>';
    });
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>AI对话导出</title></head><body style="font-family:\'PingFang SC\',sans-serif;">'+b+'</body></html>';
  }
  // HTML 导出专用：浏览器内可编辑。每段文字点开直接改，工具栏加粗/高亮/红字/删段/保存；保存后仍可继续编辑
  function _convEdit(plain){
    if(_rich)return _rich.conversation(plain,true);
    var c=_parseConv(plain), h='';
    if(c.header){ h+='<div class="meta" contenteditable="true">'+_esc(c.header).replace(/\n/g,'<br>')+'</div>'; }
    c.turns.forEach(function(t){
      var who=t.isUser?'user':'ai';
      var name=_esc(t.label.replace(/说$/,''))+(t.version?' · '+t.version:'');
      h+='<div class="turn '+who+'"><button class="del" title="删除本段" contenteditable="false">×</button><div class="who" contenteditable="true">'+name+'</div><div class="bubble" contenteditable="true">'+_esc(t.content)+'</div></div>';
    });
    return h;
  }
  function _htmlEditableDoc(plain,rawName){
    var css='body{font-family:-apple-system,"PingFang SC",sans-serif;background:#fff;color:#1a1a1a;max-width:780px;margin:0 auto;padding:32px 24px;line-height:1.75;}.meta{font-size:13px;color:#666;background:#f5f3ff;border-radius:10px;padding:12px 16px;margin-bottom:24px;white-space:pre-wrap;}.turn{margin-bottom:22px;}.who{font-size:13px;font-weight:700;margin-bottom:6px;}.turn.user .who{color:#6366F1;}.turn.ai .who{color:#0f9d77;}.bubble{white-space:pre-wrap;word-wrap:break-word;border-radius:12px;padding:14px 16px;font-size:15px;}.turn.user .bubble{background:#EEF2FF;}.turn.ai .bubble{background:#ECFDF5;}'
      +'body{padding-top:74px;}[contenteditable]:focus{outline:2px solid #818CF8;outline-offset:3px;border-radius:6px;}#ed-bar{position:fixed;top:14px;right:14px;display:flex;gap:8px;align-items:center;background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:8px 10px;box-shadow:0 6px 24px rgba(0,0,0,.12);z-index:99999;}#ed-bar button{font-family:inherit;font-size:13px;border:1px solid #E5E7EB;background:#fff;border-radius:8px;padding:6px 11px;cursor:pointer;font-weight:600;color:#444;}#ed-bar button:hover{background:#F5F3FF;}#ed-save{background:#818CF8;color:#fff;border-color:#818CF8;}#ed-tip{color:#999;font-size:12px;}.turn{position:relative;}.turn .del{position:absolute;top:-9px;left:-9px;width:22px;height:22px;border-radius:50%;border:none;background:#F87171;color:#fff;font-size:14px;line-height:22px;cursor:pointer;opacity:0;transition:.15s;padding:0;}.turn:hover .del{opacity:1;}@media print{#ed-bar,.turn .del{display:none!important;}}';
    var bar='<div id="ed-bar" contenteditable="false"><button onclick="edBold()">加粗</button><button onclick="edHi()">高亮</button><button onclick="edColor()">红字</button><button id="ed-save" onclick="edSave()">💾 保存</button><span id="ed-tip">点文字直接改 · 首次点💾选好文件，之后自动保存</span></div>';
    var sc='<scr'+'ipt>function edBold(){document.execCommand("bold",false,null);edMark();}function edHi(){document.execCommand("styleWithCSS",false,true);document.execCommand("backColor",false,"#FEF08A");edMark();}function edColor(){document.execCommand("styleWithCSS",false,true);document.execCommand("foreColor",false,"#DC2626");edMark();}var _edFh=null,_edDirty=false,_edTimer=null,_edSup=!!window.showSaveFilePicker;function _edSt(t){var s=document.getElementById("ed-save");if(s)s.textContent=t;}function _edHTML(){return "<!DOCTYPE html>\\n"+document.documentElement.outerHTML;}async function _edWrite(){try{var w=await _edFh.createWritable();await w.write(_edHTML());await w.close();_edDirty=false;_edSt("✅ 已自动保存");}catch(e){_edSt("⚠️ 保存失败，点我重试");}}function _edDl(){var b=new Blob([_edHTML()],{type:"text/html;charset=utf-8"});var a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=(document.title||"对话")+".html";document.body.appendChild(a);a.click();setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(a.href);},1500);_edDirty=false;_edSt("已发起下载，请核对浏览器记录");}async function edSave(){if(_edSup){try{if(!_edFh)_edFh=await window.showSaveFilePicker({suggestedName:(document.title||"对话")+".html",types:[{description:"网页",accept:{"text/html":[".html"]}}]});await _edWrite();}catch(e){if(e&&e.name==="AbortError")return;_edDl();}}else{_edDl();}}function edMark(){_edDirty=true;if(_edFh){_edSt("保存中…");clearTimeout(_edTimer);_edTimer=setTimeout(_edWrite,700);}else{_edSt(_edSup?"💾 点我保存到文件":"💾 点我下载保存");}}document.addEventListener("input",function(e){if(e.target&&e.target.isContentEditable)edMark();});document.addEventListener("click",function(e){if(e.target.classList&&e.target.classList.contains("del")){var t=e.target.closest(".turn");if(t&&confirm("删除这一段？")){t.remove();edMark();}}});window.addEventListener("beforeunload",function(e){if(_edDirty){e.preventDefault();e.returnValue="";}});</scr'+'ipt>';
    if(_rich)css+='\n'+_rich.css(true);
    var title=_esc(rawName||'AI对话导出');
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title><style>'+css+'</style></head><body>'+bar+_convEdit(plain)+sc+'</body></html>';
  }
  function _emit(fmt,plain,rawName,pn){
    if(fmt==='md'){ _dlBlob(_toMD(plain),'text/markdown',_fname(rawName,pn,'md')); }
    else if(fmt==='html'){ _dlBlob(_htmlEditableDoc(plain,_filenameBase(rawName,pn)),'text/html',_fname(rawName,pn,'html')); }
    else if(fmt==='word'){ _dlBlob('﻿'+_wordDoc(plain),'application/msword',_fname(rawName,pn,'doc')); }
    else if(fmt==='pdf'){ _printHTML(_htmlPage(_convHTML(plain),false,_filenameBase(rawName,pn))); }
    else { _dlBlob(plain,'text/plain',_fname(rawName,pn,'txt')); }
  }
  function add(role, el) {
    if(_I&&!_I.claim(seen,el))return;
    var t=_I?_I.content(el):(typeof el==='string'?el:(el.innerText||el.textContent||''));
    if(!t.trim())return;
    var ident=_I&&_I.identity(el,role), html=_rich?_rich.capture(role,t,el):null;
    msgs.push({role:role,content:t,element:el,key:ident&&ident.key,stableId:ident&&ident.stable,richHTML:html});
  }

  function currentConversationName(){
    var path=(location.pathname||'').replace(/\/+$/,'');
    var links=Array.from(document.querySelectorAll('a[href]'));
    for(var li=0;li<links.length;li++){
      try{
        var linkPath=new URL(links[li].href,location.href).pathname.replace(/\/+$/,'');
        var linkText=(links[li].innerText||links[li].textContent||'').trim().split('\n')[0];
        if(path&&linkPath===path&&linkText.length>=2&&linkText.length<=160)return linkText;
      }catch(e){}
    }
    var active=document.querySelector('a[aria-current="page"],[data-state="active"] a[href],a[data-state="active"],[aria-selected="true"] a[href]');
    var activeText=active&&(active.innerText||active.textContent||'').trim().split('\n')[0];
    if(activeText&&activeText.length>=2&&activeText.length<=160)return activeText;
    var docName=String(document.title||'')
      .replace(/^\s*(ChatGPT|OpenAI|Claude|Gemini|DeepSeek|豆包|Kimi|通义千问|Qwen)\s*[-–—|·:：]+\s*/i,'')
      .replace(/\s*[-–—|·:：]+\s*(ChatGPT|OpenAI|Claude|Gemini|DeepSeek|豆包|Kimi|通义千问|Qwen)\s*$/i,'')
      .trim();
    var firstUser=msgs.find(function(m){return m.role==='用户';});
    if(firstUser&&firstUser.content)return firstUser.content.replace(/\s+/g,' ').trim().slice(0,60);
    if(docName&&!/^(chatgpt|claude|gem|gemini|deepseek|豆包|kimi|通义千问|qwen|新对话|new chat)$/i.test(docName))return docName;
    return docName||'对话';
  }

  // Find the actual chat scroll container by walking up from the first message element
  function findScroller() {
    var probe = document.querySelector('[data-message-author-role],[data-testid="user-message"],.ds-markdown,[class*="flow-markdown-body"],user-query,[data-role=user],[class*=userMessage],[class*=UserQuestion]');
    if (probe) {
      var n = probe;
      while (n && n !== document.body) {
        n = n.parentElement;
        if (!n) break;
        var cs = window.getComputedStyle(n);
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 10) return n;
      }
    }
    return document.scrollingElement || document.documentElement;
  }

  function readDOM() {
    msgs = []; seen = new Set();
    if(_rich)_rich.clear();
    if (typeof AIExportChatGPT!=='undefined' && AIExportChatGPT.snapshot(null,!!_rich).length) {
      pname='ChatGPT';msgs=AIExportChatGPT.snapshot(null,!!_rich);
    } else if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) {
      pname = 'ChatGPT';
      document.querySelectorAll('[data-message-author-role]').forEach(function(el) {
        var r = el.getAttribute('data-message-author-role') === 'user' ? '用户' : 'ChatGPT';
        add(r, el.querySelector('.whitespace-pre-wrap') || el.querySelector('[class*=prose]') || el);
      });
    } else if (host.includes('claude.ai')) {
      pname = 'Claude';
      var userEls = Array.from(document.querySelectorAll('[data-testid="user-message"]'));
      // 回复正文优先认 .font-claude-message（页脚/时间戳/模型切换器都在它外面，
      // 被打断的半截回复也在这个容器里），认不到再退回 data-testid
      var claudeEls = Array.from(document.querySelectorAll('.font-claude-message,[class*="font-claude-message"]'));
      if (!claudeEls.length) claudeEls = Array.from(document.querySelectorAll('[data-testid="assistant-message"],[data-testid="ai-turn"]'));
      if (claudeEls.length > 0) {
        var combined = userEls.map(function(el){return{el:el,role:'用户'};}).concat(claudeEls.map(function(el){return{el:el,role:'Claude'};}));
        combined.sort(function(a,b){return a.el.compareDocumentPosition(b.el)&4?-1:1;});
        combined.forEach(function(item){add(item.role,item.el);});
      } else if (userEls.length > 0) {
        userEls.forEach(function(uEl) {
          add('用户', uEl);
          var node = uEl;
          for (var i = 0; i < 10; i++) {
            if (!node.parentElement) break;
            node = node.parentElement;
            var next = node.nextElementSibling;
            if (next && (next.innerText||'').trim().length > 0 && !next.querySelector('[data-testid="user-message"]')) {
              add('Claude', next); break;
            }
          }
        });
      } else {
        document.querySelectorAll('.font-claude-message,[class*=claude-message],[class*=assistant-message]').forEach(function(el){
          if((_I?_I.content(el):el.innerText).trim().length>0) add('Claude',el);
        });
      }
    } else if (host.includes('deepseek.com')) {
      pname = 'DeepSeek';
      if(!_I || !_I.deepseek(add)){
      var dsAI = Array.from(document.querySelectorAll('.ds-markdown')).filter(function(el){ return !el.parentElement || !el.parentElement.closest('.ds-markdown'); }), su = new WeakSet();
      dsAI.forEach(function(aiEl) {
        var node = aiEl;
        for (var i = 0; i < 10; i++) {
          if (!node.parentElement) break;
          node = node.parentElement;
          var prev = node.previousElementSibling;
          if (prev && !su.has(prev) && !prev.matches('.ds-markdown')&&!prev.querySelector('.ds-markdown')&&!prev.matches('nav,aside,header')) {
            var pt = (prev.innerText||'').trim();
            if (pt.length > 0||prev.querySelector('img,audio,video')) { add('用户', prev); su.add(prev); break; }
          }
        }
        add('DeepSeek', aiEl);
      });
      if (!msgs.length) dsAI.forEach(function(el){ add('DeepSeek', el); });
      }
    } else if (host.includes('gemini.google.com')) {
      pname = 'Gemini';
      var gemAll = document.querySelectorAll('user-query,model-response');
      if (gemAll.length > 0) {
        gemAll.forEach(function(el){ if(el.tagName.toLowerCase()==='model-response'&&(_I?_I.content(el):(el.innerText||'')).trim().length<1) return; add(el.tagName.toLowerCase()==='user-query'?'用户':'Gemini',el); });
      } else {
        var guEls=Array.from(document.querySelectorAll('[class*=user-query]')).filter(function(el){return !el.closest('model-response');});
        var gaEls=Array.from(document.querySelectorAll('[class*=model-response]')).filter(function(el){return !el.closest('user-query');});
        var gmAll=guEls.map(function(el){return{el:el,role:'用户'};}).concat(gaEls.map(function(el){return{el:el,role:'Gemini'};}));
        gmAll.sort(function(a,b){return a.el.compareDocumentPosition(b.el)&4?-1:1;});
        gmAll.forEach(function(item){add(item.role,item.el);});
      }
    } else if (host.includes('doubao.com')) {
      pname = '豆包';
      var dbSeenU = new WeakSet();
      var dbAI = Array.from(document.querySelectorAll('[class*="flow-markdown-body"]')).filter(function(el){ return !el.parentElement || !el.parentElement.closest('[class*="flow-markdown-body"]'); });
      if (dbAI.length > 0) {
        dbAI.forEach(function(aiEl) {
          var node = aiEl;
          for (var di = 0; di < 15; di++) {
            if (!node.parentElement) break;
            node = node.parentElement;
            var prev = node.previousElementSibling;
            if (prev && !dbSeenU.has(prev) && !prev.querySelector('[class*="flow-markdown-body"]')) {
              var pt = (prev.innerText||'').trim();
              if (pt.length > 0||prev.querySelector('img,audio,video')) { add('用户', prev); dbSeenU.add(prev); break; }
            }
          }
          add('豆包', aiEl);
        });
      } else {
        document.querySelectorAll('[data-role=user],[data-role=assistant]').forEach(function(el){
          add(el.getAttribute('data-role')==='user'?'用户':'豆包',el);
        });
      }
    } else if ((host.includes('kimi.ai')||host.includes('kimi.com')) || host.includes('moonshot.cn')) {
      pname = 'Kimi';
      var kmU=Array.from(document.querySelectorAll('[data-role=user],[class*=userMessage],[class*=UserMessage],[class*=human-message],[class*=HumanMessage]')).filter(function(el){return (_I?_I.content(el):el.innerText).trim().length>0;});
      var kmA=Array.from(document.querySelectorAll('[data-role=assistant],[class*=assistantMessage],[class*=AssistantMessage],[class*=bot-message],[class*=BotMessage]')).filter(function(el){return (_I?_I.content(el):el.innerText).trim().length>0;});
      var kmAll=kmU.map(function(el){return{el:el,role:'用户'};}).concat(kmA.map(function(el){return{el:el,role:'Kimi'};}));
      kmAll.sort(function(a,b){return a.el.compareDocumentPosition(b.el)&4?-1:1;});
      kmAll.forEach(function(item){add(item.role,item.el);});
    } else if ((host.includes('tongyi.aliyun.com')||host.includes('tongyi.com')||host.includes('qianwen.com')||host.includes('qwenlm.ai')) || host.includes('qwenlm.ai')) {
      pname = '通义千问';
      var qwU=Array.from(document.querySelectorAll('[class*=UserQuestion],[class*=humanMessage],[class*=HumanMessage],[class*=userBubble]')).filter(function(el){return (_I?_I.content(el):el.innerText).trim().length>0;});
      var qwA=Array.from(document.querySelectorAll('[class*=MarkdownContent],[class*=assistantMessage],[class*=AssistantMessage],[class*=BotMessage]')).filter(function(el){
        return (_I?_I.content(el):el.innerText).trim().length>0&&!el.closest('[class*=UserQuestion],[class*=humanMessage],[class*=HumanMessage]');
      });
      var qwAll=qwU.map(function(el){return{el:el,role:'用户'};}).concat(qwA.map(function(el){return{el:el,role:'通义千问'};}));
      qwAll.sort(function(a,b){return a.el.compareDocumentPosition(b.el)&4?-1:1;});
      qwAll.forEach(function(item){add(item.role,item.el);});
    } else {
      var g = false;
      document.querySelectorAll('[data-role=user],[data-role=assistant],[data-author=user],[data-author=assistant]').forEach(function(el){
        var role=el.getAttribute('data-role')||el.getAttribute('data-author')||'';
        add(role==='user'?'用户':'AI',el); g=true;
      });
      if(!g) document.querySelectorAll('[class*=markdown],[class*=message-content]').forEach(function(el){ if((_I?_I.content(el):el.innerText).trim().length>0) add('内容',el); });
    }
    return msgs;
  }
  function doExtract(){
    if (!msgs.length) { alert('未找到对话内容。\n请确认：\n1. 已进入具体对话页面（不是首页）\n2. 页面已完全加载'); return; }
    var formatted = [];
    var i = 0;
    while (i < msgs.length) {
      var cur = msgs[i]; var versions = [cur];
      if (cur.role !== '用户') { while (i+1 < msgs.length && msgs[i+1].role === cur.role) { i++; versions.push(msgs[i]); } }
      if (versions.length > 1) {
        versions.forEach(function(m,vi){ formatted.push('【'+m.role+'说 - V'+(vi+1)+'】\n'+m.content); });
      } else { formatted.push('【'+cur.role+'说】\n'+cur.content); }
      i++;
    }
    var convTime = (function(){
      if(host==='gemini.google.com'){
        var nativeTime=document.querySelector('[data-test-id="chat-history-container"] time[datetime]');
        if(!nativeTime)return '';
        var nativeDate=new Date(nativeTime.getAttribute('datetime'));
        return isNaN(nativeDate)?'':nativeDate.toLocaleString('zh-CN');
      }
      var t = document.querySelector('time[datetime]');
      if(t){var d=new Date(t.getAttribute('datetime'));if(!isNaN(d))return d.toLocaleString('zh-CN');}
      var spans = Array.from(document.querySelectorAll('[class*=time],[class*=Time],[class*=date],[class*=Date]'));
      for(var s of spans){var txt=(s.innerText||'').trim();if(txt&&txt.length<30&&/[\d:\-\/年月日]/.test(txt))return txt;}
      return '';
    })();
    var convName=currentConversationName();
    var hdr = '平台：'+pname+'\n来源：'+convName+(_dbNote?'\n'+_dbNote:'')+'\n地址：'+location.origin+location.pathname+(convTime?'\n对话时间：'+convTime:'')+'\n提取时间：'+new Date().toLocaleString('zh-CN')+'\n共 '+msgs.length+' 条\n'+'='.repeat(50)+'\n\n';
    remember(msgs,hdr);
    _emit(format, hdr+formatted.join('\n\n'), convName, pname);
    return true;
  }

  // 带超时 fetch
  function _fetchT(url,opts,ms){ opts=opts||{}; var c=new AbortController(); opts.signal=c.signal; var tm=setTimeout(function(){try{c.abort();}catch(e){}},ms||12000); return fetch(url,opts).then(function(r){clearTimeout(tm);return r;},function(e){clearTimeout(tm);throw e;}); }
  // 把 msgs[] 按版本分组后排版并导出（与批量同款）
  function finishWithMsgs(msgs, convName){
    if(!msgs.length){ runDOM(); return; }   // 接口空了再退回页面提取
    var formatted=[], i=0;
    while(i<msgs.length){
      var cur=msgs[i], versions=[cur];
      if(cur.role!=='用户'){ while(i+1<msgs.length&&msgs[i+1].role===cur.role){ i++; versions.push(msgs[i]); } }
      if(versions.length>1){ versions.forEach(function(m,vi){ formatted.push('【'+m.role+'说 - V'+(vi+1)+'】\n'+m.content); }); }
      else { formatted.push('【'+cur.role+'说】\n'+cur.content); }
      i++;
    }
    var resolvedName=convName||currentConversationName();
    var hdr='平台：'+pname+'\n来源：'+resolvedName+'\n地址：'+_sourceAtStart+(_dbNote?'\n'+_dbNote:'')+'\n提取时间：'+new Date().toLocaleString('zh-CN')+'\n共 '+msgs.length+' 条\n'+'='.repeat(50)+'\n\n';
    remember(msgs,hdr);
    _emit(format, hdr+formatted.join('\n\n'), resolvedName, pname);
  }
  // Claude：官方接口直接拿全文（含被打断的半截回复，服务端有存）
  function runClaudeAPI(){
    pname='Claude';
    var convId=location.pathname.replace(/.*\/chat\//,'').replace(/[?#].*/,'');
    _fetchT('/api/organizations',{credentials:'include'},10000)
      .then(function(r){ if(!r.ok)throw 0; return r.json(); })
      .then(function(orgs){ var o=null; (orgs||[]).forEach(function(x){ if(!o&&x&&x.capabilities&&x.capabilities.indexOf('chat')>=0)o=x; }); if(!o&&orgs&&orgs.length)o=orgs[0]; if(!o)throw 0;
        return _fetchT('/api/organizations/'+o.uuid+'/chat_conversations/'+convId+'?tree=True&rendering_mode=messages&render_all_tools=true',{credentials:'include'},15000); })
      .then(function(r){ if(!r.ok)throw 0; return r.json(); })
      .then(function(d){ var msgs=_I.claude(d,convId);
        if(!location.pathname.endsWith('/chat/'+convId))throw Error('对话地址已改变');
        finishWithMsgs(msgs, d.name); })
      .catch(function(e){if(_I.currentPath()!==_I.path(_sourceAtStart)){alert('对话地址已改变，已停止本次导出。');return;}if(/身份与目标不符/.test(e&&e.message||'')){alert(e.message);return;}_dbNote='接口未完成读取；以下仅为页面可见内容。';runDOM();});
  }
  // ChatGPT：官方接口直接拿全文
  function runGPTAPI(){
    pname='ChatGPT';
    var convId=location.pathname.replace(/.*\/c\//,'').replace(/[?#].*/,''),auth=null;
    _fetchT('/api/auth/session',{credentials:'include'},10000).then(r=>r.ok?r.json():null).then(s=>{if(s&&s.accessToken)auth=s.accessToken;}).catch(()=>{})
      .then(()=>_fetchT('/backend-api/conversation/'+convId,{credentials:'include',headers:auth?{'Authorization':'Bearer '+auth}:{}},12000))
      .then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json();})
      .then(async d=>{
        if(!location.pathname.endsWith('/c/'+convId))throw Error('对话地址已改变');
        if(typeof AIExportChatGPT==='undefined')throw Error('ChatGPT适配模块未加载');
        var result=await AIExportChatGPT.prepare(d,{convId:convId,format:format});
        if(_I.currentPath()!==_I.path(_sourceAtStart))throw Error('对话地址已改变');
        _dbNote=result.note;finishWithMsgs(result.messages,d.title);
        if(_I)_I.notice(result.warnings.length?'已生成文件；部分内容已按文字保存，具体位置见文件说明。':(format==='pdf'?'已准备打印内容；是否保存PDF由打印窗口决定。':'已发起下载；保存结果请以浏览器下载记录为准。'));
      }).catch(function(e){if(!location.pathname.endsWith('/c/'+convId)){alert('对话地址已改变，已停止本次导出。');return;}if(/身份与目标不符|节点链不完整|缺少当前分支|仍在生成|正在加载|页面排版未就绪/.test(e.message)){alert(e.message);return;}_dbNote='接口读取失败：'+e.message+'；以下仅为页面可见内容。';runDOM();});
  }

  // 页面 DOM 提取（非 Claude/ChatGPT，或接口失败时兜底）
  function runDOM(){
    if(!_I){alert('完整性模块未加载，请重新加载扩展。');return;}
    _I.notice('正在收集页面消息；请保持当前对话。');
    (typeof AIExportGemini!=='undefined'&&AIExportGemini.ownsPage()?AIExportGemini:typeof AIExportText!=='undefined'?AIExportText:_I).collect(readDOM,{target:_I.path(_sourceAtStart)}).then(function(result){msgs=result.messages;_dbNote=(_dbNote?_dbNote+'\n':'')+result.note;if(doExtract())_I.notice(result.note+(format==='pdf'?' 已准备打印内容；是否保存PDF由打印窗口决定。':' 已发起下载；保存结果请以浏览器下载记录为准。'));else _I.notice('未生成文件：没有可读取的消息。');}).catch(function(e){alert(e.message);});
  }

  // 优先官方接口（最干净、能拿到被打断的半截回复），失败再退回页面提取
  if (typeof AIExportDoubao!=='undefined' && AIExportDoubao.ownsPage()) {
    pname='豆包';
    AIExportDoubao.startSingle(function(result){
      _dbNote=result.note;
      if(_rich){_rich.clear();result.messages.forEach(function(m){_rich.capture(m.role,m.content,m.element);});}
      finishWithMsgs(result.messages,result.title);
    });
  }
  else if (host.includes('claude.ai') && location.pathname.indexOf('/chat/')>=0) runClaudeAPI();
  else if ((host.includes('chatgpt.com')||host.includes('chat.openai.com')) && /\/c\//.test(location.pathname)) runGPTAPI();
  else runDOM();
}

function fnBatch(aiOnly, userOnly, format) {
  aiOnly = !!aiOnly;
  userOnly = !!userOnly;
  format = format || 'txt';
  var _rich = ['html','word','pdf'].indexOf(format)>=0 && typeof AIExportRich!=='undefined' ? AIExportRich.create(_parseConv) : null;
  var _pdfQueue = [];   // PDF 模式下批量先攒着，最后合成一份多页 PDF 一次打印
  var _mode = aiOnly ? 'ai' : (userOnly ? 'user' : 'all');

  // === 多格式输出：txt / md / html / word / pdf（与单条共用同一套）===
  var _I=typeof AIExportIntegrity!=='undefined'?AIExportIntegrity:null, _typed=null;
  function remember(messages,header){var options={groupVersions:!aiOnly};_typed=_I?_I.typed(messages,header,options):null;if(_rich)_rich.useMessages(messages,header,options);}
  function _parseConv(plain){
    if(_typed)return _typed;
    var marker='='.repeat(50);
    var mi=plain.indexOf(marker), header='', body=plain;
    if(mi>=0){ header=plain.slice(0,mi).trim(); body=plain.slice(mi+marker.length).replace(/^\s+/,''); }
    var blocks=body.split(/\n\n(?=【[^\n】]*?说(?: - V\d+)?】\n)/);
    var turns=[];
    blocks.forEach(function(b){
      var m=b.match(/^【([^\n】]*?说)(?: - (V\d+))?】\n?([\s\S]*)$/);
      if(m){ turns.push({label:m[1],version:m[2]||'',content:(m[3]||'').trim(),isUser:m[1].indexOf('用户')===0}); }
      else if(b.trim()){ turns.push({label:'',version:'',content:b.trim(),isUser:false}); }
    });
    return {header:header,turns:turns};
  }
  function _esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function _convHTML(plain){
    if(_rich)return _rich.conversation(plain,false);
    var c=_parseConv(plain), h='';
    if(c.header){ h+='<div class="meta">'+_esc(c.header).replace(/\n/g,'<br>')+'</div>'; }
    c.turns.forEach(function(t){
      var who=t.isUser?'user':'ai';
      var name=_esc(t.label.replace(/说$/,''))+(t.version?' · '+t.version:'');
      h+='<div class="turn '+who+'"><div class="who">'+name+'</div><div class="bubble">'+_esc(t.content)+'</div></div>';
    });
    return h;
  }
  function _htmlPage(inner,forWord,docTitle){
    if(_rich)return _rich.page(inner,docTitle);
    var css='body{font-family:-apple-system,"PingFang SC",sans-serif;background:#fff;color:#1a1a1a;max-width:780px;margin:0 auto;padding:32px 24px;line-height:1.75;}.meta{font-size:13px;color:#666;background:#f5f3ff;border-radius:10px;padding:12px 16px;margin-bottom:24px;white-space:pre-wrap;}.turn{margin-bottom:22px;}.who{font-size:13px;font-weight:700;margin-bottom:6px;}.turn.user .who{color:#6366F1;}.turn.ai .who{color:#0f9d77;}.bubble{white-space:pre-wrap;word-wrap:break-word;border-radius:12px;padding:14px 16px;font-size:15px;}.turn.user .bubble{background:#EEF2FF;}.turn.ai .bubble{background:#ECFDF5;}.conv-sep{page-break-after:always;height:0;}@media print{body{padding:0;max-width:none;}.turn{break-inside:avoid;}}';
    var head='<meta charset="utf-8"><title>'+_esc(docTitle||'AI对话导出')+'</title><style>'+css+'</style>';
    if(forWord){ return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head>'+head+'</head><body>'+inner+'</body></html>'; }
    return '<!DOCTYPE html><html><head>'+head+'</head><body>'+inner+'</body></html>';
  }
  function _toMD(plain){
    var c=_parseConv(plain), out=[];
    if(c.header){ c.header.split('\n').forEach(function(l){ out.push('> '+l); }); out.push(''); }
    c.turns.forEach(function(t){
      var name=t.label.replace(/说$/,'')+(t.version?' ('+t.version+')':'');
      out.push('## '+(t.isUser?'🧑':'🤖')+' '+name); out.push(''); out.push(t.content); out.push('');
    });
    return out.join('\n').trim()+'\n';
  }
  function _dlBlob(data,mime,fname){
    var blob=new Blob([data],{type:mime+';charset=utf-8'});
    var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=fname;
    document.body.appendChild(a); a.click(); setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(a.href);},600);
  }
  function _printHTML(htmlDoc){
    var ifr=document.createElement('iframe');
    ifr.setAttribute('style','position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;');
    document.body.appendChild(ifr);
    var d=ifr.contentWindow.document; d.open(); d.write(htmlDoc); d.close();
    setTimeout(function(){ try{ ifr.contentWindow.focus(); ifr.contentWindow.print(); }catch(e){ alert('唤起打印失败：'+(e&&e.message)); } setTimeout(function(){ if(ifr.parentNode) ifr.parentNode.removeChild(ifr); },60000); },400);
  }
  function _printMany(list,docTitle){ var inner=list.map(function(p){return _convHTML(p);}).join('<div class="conv-sep"></div>'); _printHTML(_htmlPage(inner,false,docTitle)); }
  function _cleanFilePart(value){
    return String(value||'')
      .replace(/[<>:"/\\|?*\u0000-\u001F\u007F]+/g,'_')
      .replace(/\s+/g,'_')
      .replace(/_+/g,'_')
      .replace(/^[._\-]+|[._\-]+$/g,'')
      .slice(0,80);
  }
  function _stripPlatform(rawName,pn){
    var name=String(rawName||'').trim();
    var aliases={
      'ChatGPT':['ChatGPT','OpenAI'],
      'Claude':['Claude'],
      'Gemini':['Gemini','Google Gemini'],
      'DeepSeek':['DeepSeek'],
      '豆包':['豆包'],
      'Kimi':['Kimi','Moonshot'],
      '通义千问':['通义千问','Qwen']
    }[pn]||[pn];
    aliases.filter(Boolean).forEach(function(alias){
      var escaped=String(alias).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      name=name.replace(new RegExp('^'+escaped+'(?:[\\s_\\-—–|·:：]+)','i'),'');
      name=name.replace(new RegExp('(?:[\\s_\\-—–|·:：]+)'+escaped+'$','i'),'');
      if(name.toLowerCase()===String(alias).toLowerCase())name='';
    });
    return name;
  }
  function _filenameBase(rawName,pn){
    var platform=_cleanFilePart(pn||'AI')||'AI';
    if(!/聊天记录$/.test(platform))platform+='聊天记录';
    var conversation=_cleanFilePart(_stripPlatform(rawName,pn))||'对话';
    return (platform+'_'+conversation).slice(0,100).replace(/[._\-]+$/g,'');
  }
  function _fname(rawName,pn,ext,source){ return _I.filename(_filenameBase(rawName,pn),ext,source===undefined?_fileSource:source); }
  // Word 专用渲染：Word 对 <style> class 和 div 背景支持差，改用「单元格表格 bgcolor + 行内样式 + 彩色左边框」做用户/AI 区分
  function _wordDoc(plain){
    if(_rich)return _rich.word(plain);
    var c=_parseConv(plain), b='';
    if(c.header){ b+='<p style="font-size:12px;color:#666;background:#F5F3FF;padding:8px 10px;margin:0 0 16px;">'+_esc(c.header).replace(/\n/g,'<br>')+'</p>'; }
    c.turns.forEach(function(t){
      var u=t.isUser, nameColor=u?'#4338CA':'#047857', bg=u?'#EEF2FF':'#ECFDF5', bd=u?'#6366F1':'#10B981';
      var name=_esc(t.label.replace(/说$/,''))+(t.version?' · '+t.version:'');
      b+='<p style="margin:0 0 4px;font-weight:bold;color:'+nameColor+';font-size:14px;">'+name+'</p>';
      b+='<table width="100%" cellspacing="0" cellpadding="9" style="border-collapse:collapse;margin:0 0 16px;"><tr><td bgcolor="'+bg+'" style="background:'+bg+';border-left:4px solid '+bd+';font-size:13px;line-height:1.7;color:#1a1a1a;">'+_esc(t.content).replace(/\n/g,'<br>')+'</td></tr></table>';
    });
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>AI对话导出</title></head><body style="font-family:\'PingFang SC\',sans-serif;">'+b+'</body></html>';
  }
  // HTML 导出专用：浏览器内可编辑。每段文字点开直接改，工具栏加粗/高亮/红字/删段/保存；保存后仍可继续编辑
  function _convEdit(plain){
    if(_rich)return _rich.conversation(plain,true);
    var c=_parseConv(plain), h='';
    if(c.header){ h+='<div class="meta" contenteditable="true">'+_esc(c.header).replace(/\n/g,'<br>')+'</div>'; }
    c.turns.forEach(function(t){
      var who=t.isUser?'user':'ai';
      var name=_esc(t.label.replace(/说$/,''))+(t.version?' · '+t.version:'');
      h+='<div class="turn '+who+'"><button class="del" title="删除本段" contenteditable="false">×</button><div class="who" contenteditable="true">'+name+'</div><div class="bubble" contenteditable="true">'+_esc(t.content)+'</div></div>';
    });
    return h;
  }
  function _htmlEditableDoc(plain,rawName){
    var css='body{font-family:-apple-system,"PingFang SC",sans-serif;background:#fff;color:#1a1a1a;max-width:780px;margin:0 auto;padding:32px 24px;line-height:1.75;}.meta{font-size:13px;color:#666;background:#f5f3ff;border-radius:10px;padding:12px 16px;margin-bottom:24px;white-space:pre-wrap;}.turn{margin-bottom:22px;}.who{font-size:13px;font-weight:700;margin-bottom:6px;}.turn.user .who{color:#6366F1;}.turn.ai .who{color:#0f9d77;}.bubble{white-space:pre-wrap;word-wrap:break-word;border-radius:12px;padding:14px 16px;font-size:15px;}.turn.user .bubble{background:#EEF2FF;}.turn.ai .bubble{background:#ECFDF5;}'
      +'body{padding-top:74px;}[contenteditable]:focus{outline:2px solid #818CF8;outline-offset:3px;border-radius:6px;}#ed-bar{position:fixed;top:14px;right:14px;display:flex;gap:8px;align-items:center;background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:8px 10px;box-shadow:0 6px 24px rgba(0,0,0,.12);z-index:99999;}#ed-bar button{font-family:inherit;font-size:13px;border:1px solid #E5E7EB;background:#fff;border-radius:8px;padding:6px 11px;cursor:pointer;font-weight:600;color:#444;}#ed-bar button:hover{background:#F5F3FF;}#ed-save{background:#818CF8;color:#fff;border-color:#818CF8;}#ed-tip{color:#999;font-size:12px;}.turn{position:relative;}.turn .del{position:absolute;top:-9px;left:-9px;width:22px;height:22px;border-radius:50%;border:none;background:#F87171;color:#fff;font-size:14px;line-height:22px;cursor:pointer;opacity:0;transition:.15s;padding:0;}.turn:hover .del{opacity:1;}@media print{#ed-bar,.turn .del{display:none!important;}}';
    var bar='<div id="ed-bar" contenteditable="false"><button onclick="edBold()">加粗</button><button onclick="edHi()">高亮</button><button onclick="edColor()">红字</button><button id="ed-save" onclick="edSave()">💾 保存</button><span id="ed-tip">点文字直接改 · 首次点💾选好文件，之后自动保存</span></div>';
    var sc='<scr'+'ipt>function edBold(){document.execCommand("bold",false,null);edMark();}function edHi(){document.execCommand("styleWithCSS",false,true);document.execCommand("backColor",false,"#FEF08A");edMark();}function edColor(){document.execCommand("styleWithCSS",false,true);document.execCommand("foreColor",false,"#DC2626");edMark();}var _edFh=null,_edDirty=false,_edTimer=null,_edSup=!!window.showSaveFilePicker;function _edSt(t){var s=document.getElementById("ed-save");if(s)s.textContent=t;}function _edHTML(){return "<!DOCTYPE html>\\n"+document.documentElement.outerHTML;}async function _edWrite(){try{var w=await _edFh.createWritable();await w.write(_edHTML());await w.close();_edDirty=false;_edSt("✅ 已自动保存");}catch(e){_edSt("⚠️ 保存失败，点我重试");}}function _edDl(){var b=new Blob([_edHTML()],{type:"text/html;charset=utf-8"});var a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=(document.title||"对话")+".html";document.body.appendChild(a);a.click();setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(a.href);},1500);_edDirty=false;_edSt("已发起下载，请核对浏览器记录");}async function edSave(){if(_edSup){try{if(!_edFh)_edFh=await window.showSaveFilePicker({suggestedName:(document.title||"对话")+".html",types:[{description:"网页",accept:{"text/html":[".html"]}}]});await _edWrite();}catch(e){if(e&&e.name==="AbortError")return;_edDl();}}else{_edDl();}}function edMark(){_edDirty=true;if(_edFh){_edSt("保存中…");clearTimeout(_edTimer);_edTimer=setTimeout(_edWrite,700);}else{_edSt(_edSup?"💾 点我保存到文件":"💾 点我下载保存");}}document.addEventListener("input",function(e){if(e.target&&e.target.isContentEditable)edMark();});document.addEventListener("click",function(e){if(e.target.classList&&e.target.classList.contains("del")){var t=e.target.closest(".turn");if(t&&confirm("删除这一段？")){t.remove();edMark();}}});window.addEventListener("beforeunload",function(e){if(_edDirty){e.preventDefault();e.returnValue="";}});</scr'+'ipt>';
    if(_rich)css+='\n'+_rich.css(true);
    var title=_esc(rawName||'AI对话导出');
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title><style>'+css+'</style></head><body>'+bar+_convEdit(plain)+sc+'</body></html>';
  }
  function _emit(fmt,plain,rawName,pn){
    if(fmt==='md'){ _dlBlob(_toMD(plain),'text/markdown',_fname(rawName,pn,'md')); }
    else if(fmt==='html'){ _dlBlob(_htmlEditableDoc(plain,_filenameBase(rawName,pn)),'text/html',_fname(rawName,pn,'html')); }
    else if(fmt==='word'){ _dlBlob('﻿'+_wordDoc(plain),'application/msword',_fname(rawName,pn,'doc')); }
    else if(fmt==='pdf'){ _printHTML(_htmlPage(_convHTML(plain),false,_filenameBase(rawName,pn))); }
    else { _dlBlob(plain,'text/plain',_fname(rawName,pn,'txt')); }
  }
  var PID = 'aie25';
  var ex = document.getElementById(PID);
  if (ex) {
    var sameMode = ex.getAttribute('data-mode') === _mode;
    if(ex._aiExportDispose)ex._aiExportDispose();
    ex.remove(); var ec=document.getElementById(PID+'c'); if(ec) ec.remove();
    if (sameMode) return;
  }
  var host = location.hostname, pname = 'AI';
  var _db=/(^|\.)doubao\.com$/i.test(host)&&typeof AIExportDoubao!=='undefined'?AIExportDoubao:null;
  var _dbMessages=null, _dbNote='', _exportFailures=[],_activeName='',_fileSource='';
  var _batchCancelled=function(){return false;};
  if (host.includes('chatgpt.com')) pname='ChatGPT';
  else if (host.includes('claude.ai')) pname='Claude';
  else if (host.includes('deepseek.com')) pname='DeepSeek';
  else if (host.includes('gemini.google.com')) pname='Gemini';
  else if (host.includes('doubao.com')) pname='豆包';
  else if ((host.includes('kimi.ai')||host.includes('kimi.com'))||host.includes('moonshot.cn')) pname='Kimi';
  else if ((host.includes('tongyi.aliyun.com')||host.includes('tongyi.com')||host.includes('qianwen.com')||host.includes('qwenlm.ai'))) pname='通义千问';

  var _panelColor = aiOnly ? '#C084FC' : (userOnly ? '#FBBF24' : '#34D399');
  // buildPanel 建好后会把这两个钩子指向真正的实现：边拉边往列表里塞、收尾时关掉加载态
  var _addConvLinks = function(){}, _finishLoading = function(){}, _listSync=null;
  function listAlive(){return !!(_listSync&&_listSync.alive());}

  function findConvs(){
    if(_db){var modernList=_db.listConversations();if(modernList.length)return modernList;}
    var isChatGPT=host.includes('chatgpt.com')||host.includes('chat.openai.com');
    var results=[];
    if(isChatGPT){
      // Only identified history links: navigation, contacts and links quoted in messages are not conversations.
      results=Array.from(document.querySelectorAll('nav a[href],aside a[href],[class*="sidebar"] a[href],[class*="Sidebar"] a[href],[data-testid*="conversation"] a[href],[data-testid*="history"] a[href],a[data-testid*="conversation"][href]')).filter(function(el){
        if(el.closest('main,[data-message-author-role],[data-chatgpt-selection-message-id]'))return false;
        try{var u=new URL(el.getAttribute('href'),location.href);return u.origin===location.origin&&/^\/(?:g\/[^/]+\/)?c\/[A-Za-z0-9_-]+\/?$/.test(u.pathname);}catch(ignore){return false;}
      });
    } else if(host==='gemini.google.com'){
      results=Array.from(document.querySelectorAll('nav a[href],aside a[href],[role="navigation"] a[href],conversations-list a[href]')).filter(function(el){
        if(el.closest('user-query,model-response,#aie25'))return false;
        try{var url=new URL(el.getAttribute('href'),location.href);return url.origin===location.origin&&/^\/(?:u\/\d+\/)?app\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);}catch(ignore){return false;}
      });
      if(!results.length)return [];
    } else {
      var platSels={'claude.ai':"nav a[href^='/chat/'],nav a[href*='/project/']",'deepseek.com':"a[href*='chat']",'doubao.com':"a[href*='thread'],a[href*='chat']",'kimi.com':"a[href*='/chat']",'kimi.ai':"a[href*='/chat']",'moonshot.cn':"a[href*='/chat']",'qwenlm.ai':"a[href*='/chat'],a[href*='conversation']",'qianwen.com':"a[href*='/chat/'],a[href*='conversation']",'tongyi.com':"a[href*='/chat/'],a[href*='conversation']",'tongyi.aliyun.com':"a[href*='conversation']"};
      var sel=null; for(var d in platSels){if(host.includes(d)){sel=platSels[d];break;}}
      if(sel){try{results=Array.from(document.querySelectorAll(sel));}catch(e){}}
    }
    var hasPrimary=results.length>0;
    if(!hasPrimary&&!isChatGPT){results=Array.from(document.querySelectorAll('a[href]')).filter(function(el){if(!el.offsetParent)return false;var rect=el.getBoundingClientRect();if(rect.left>window.innerWidth*0.42)return false;var t=(el.innerText||el.textContent||'').trim();return t.length>=2&&t.length<=150;});}
    var seen=new Set();
    return results.filter(function(el){var t=(el.innerText||el.textContent||'').trim().split('\n')[0];if(t.length<2)return false;if(!hasPrimary&&!el.offsetParent)return false;var key=(el.getAttribute&&el.getAttribute('href')||el.href||el.textContent||'')+t.slice(0,20);if(seen.has(key))return false;seen.add(key);return true;});
  }

  // Batch-list lifecycle only. Conversation extraction/rendering remains independent.
  function conversationKey(el){
    if(_db){var dbPath=_db.targetPath(el);if(dbPath)return dbPath;}
    var href=el.getAttribute&&el.getAttribute('href');
    if(href&&(host.includes('chatgpt.com')||host.includes('chat.openai.com'))){try{var chatUrl=new URL(href,location.href),chatPath=chatUrl.pathname.match(/^\/(?:g\/[^/]+\/)?c\/([A-Za-z0-9_-]+)\/?$/);if(chatUrl.origin===location.origin&&chatPath)return '/c/'+chatPath[1];}catch(ignore){}}
    if(href){try{var u=new URL(href,location.href);if(u.origin===location.origin&&u.pathname!=='/')return u.pathname.replace(/\/$/,'')+u.search;}catch(ignore){}}
    var id=el.getAttribute&& (el.getAttribute('data-conversation-id')||el.getAttribute('data-id'));
    return id?'id:'+id:'text:'+(el.textContent||'').trim();
  }
  function createListSync(panel,add,status){
    var stopped=false,exporting=false,auto=false,timer=null,debounce=null,observer=null;
    // Gemini history discovery is a bounded initial convenience, not a full-account crawl.
    var bounded=host==='gemini.google.com',initialDone=false,initialStarted=0,initialLimit=50,initialBudget=5000;
    var running=false,side=null,restoreTop=0,restoreBehavior='',started=0,lastChange=0,lastSignature='',knownKeys=new Set(),discovered=false,lastContainer=null;
    var roots='nav,aside,[data-testid="flow_chat_sidebar"],[data-testid="chat_list_wrapper"],[class*="sidebar"],[class*="Sidebar"]';
    if(host==='gemini.google.com')roots+=',mat-sidenav,side-navigation-v2,side-navigation-content,conversations-list,[role="navigation"]';
    function alive(){return !stopped&&panel.isConnected;}
    function links(){return findConvs().filter(function(e){return !panel.contains(e);});}
    function scrollable(n){return n&&n!==document.body&&n!==document.documentElement&&n.clientHeight>0&&/(auto|scroll)/.test(getComputedStyle(n).overflowY)&&n.scrollHeight>n.clientHeight+4;}
    function findSide(){
      var rows=links();
      for(var i=0;i<rows.length;i++)for(var n=rows[i].parentElement;n&&n!==document.body;n=n.parentElement)if(scrollable(n))return n;
      // Empty or freshly mounted history: the scroll area can be a nested child of nav.
      var containers=Array.from(document.querySelectorAll(roots));
      for(var j=0;j<containers.length;j++){
        if(panel.contains(containers[j]))continue;
        var all=[containers[j]].concat(Array.from(containers[j].querySelectorAll('*')));
        for(var k=0;k<all.length;k++)if(scrollable(all[k]))return all[k];
      }
      return null;
    }
    function read(){
      var rows=links();discovered=false;rows.forEach(function(e){var key=conversationKey(e);if(!knownKeys.has(key)){knownKeys.add(key);discovered=true;}});add(rows);
      var sig=rows.map(function(e){return conversationKey(e)+'|'+(e.textContent||'').trim();}).join('\n');
      if(sig!==lastSignature){lastSignature=sig;lastChange=Date.now();return true;}return false;
    }
    function restore(keepPosition){
      if(side&&side.isConnected){if(!keepPosition)side.scrollTop=restoreTop;side.style.scrollBehavior=restoreBehavior;}
      side=null;
    }
    function stopScan(message,keepPosition){
      if(bounded)initialDone=true;
      running=false;if(timer!==null)clearTimeout(timer);timer=null;
      // The last viewport is already collected. Restoring is not a new loading event.
      restore(keepPosition);status(message||(bounded?'随侧栏手动滚动同步':'持续同步中'));
    }
    function later(){if(alive()&&running)timer=setTimeout(tick,180);}
    function advance(s){
      var bottom=Math.max(0,s.scrollHeight-s.clientHeight),from=s.scrollTop;
      var edge=from+s.clientHeight*0.85,rect=s.getBoundingClientRect();
      // All currently mounted rows are already registered. Skip their covered span.
      links().forEach(function(e){if(s.contains(e)){var r=e.getBoundingClientRect();if(r.height>0)edge=Math.max(edge,r.bottom-rect.top+from-s.clientHeight*0.25);}});
      return Math.min(bottom,Math.max(from+80,edge));
    }
    function tick(){
      timer=null;if(!alive()){dispose();return;}if(exporting){stopScan('导出中，列表已保留');return;}
      try{
        var changed=read();
        if(bounded&&(knownKeys.size>=initialLimit||Date.now()-initialStarted>=initialBudget)){stopScan('初次加载已停止；向下滚动左侧对话列表可继续同步');return;}
        var candidate=findSide();
        if(candidate!==side){restore();side=candidate;lastContainer=candidate;if(side){restoreTop=side.scrollTop;restoreBehavior=side.style.scrollBehavior;side.style.scrollBehavior='auto';side.scrollTop=0;}lastChange=Date.now();}
        if(!side){stopScan('持续同步中；等待侧栏显示');return;}
        if(changed)started=lastChange=Date.now();
        if(Date.now()-started>12000){stopScan('历史加载暂无进展，后续出现的对话会继续同步');return;}
        var busy=side.querySelector('[aria-busy="true"],[role="progressbar"],[data-testid*="loading"]');
        var bottom=side.scrollTop+side.clientHeight>=side.scrollHeight-3;
        if(!bottom){var previousTop=side.scrollTop;side.scrollTop=advance(side);if(side.scrollTop!==previousTop)started=lastChange=Date.now();}
        else if(!busy&&Date.now()-lastChange>=1800){stopScan('持续同步中');return;}
        status('正在自动加载历史对话…');later();
      }catch(error){stopScan('自动加载暂不可用；新出现的对话仍会同步');}
    }
    function start(){
      if(!alive()||exporting||!auto||running||(bounded&&initialDone))return;
      if(bounded&&!initialStarted)initialStarted=Date.now();
      running=true;started=lastChange=Date.now();tick();
    }
    function relevant(m){
      var n=m.target.nodeType===1?m.target:m.target.parentElement;
      if(!n||panel.contains(n))return false;
      if(lastContainer&&lastContainer.contains(n))return true;
      var hints='a[href*="/chat"],a[href*="/c/"],a[href*="conversation"],[data-testid="conversation-list-v2-item"]';
      if(n.closest&&(n.closest(roots)||n.closest(hints)))return true;
      return Array.from(m.addedNodes||[]).concat(Array.from(m.removedNodes||[])).some(function(x){return x.nodeType===1&&x!==panel&&!panel.contains(x)&&((lastContainer&&x.contains(lastContainer))||x.matches(roots+','+hints)||x.querySelector(roots+','+hints));});
    }
    function onMutation(mutations){
      if(!alive()){dispose();return;}
      if(!mutations.some(relevant)||debounce!==null)return;
      debounce=setTimeout(function(){debounce=null;if(!alive()){dispose();return;}read();if(!exporting&&(discovered||findSide()!==lastContainer))start();},120);
    }
    function onUserIntent(event){
      if(!bounded||initialDone||!alive())return;
      var target=event.target&&event.target.nodeType===1?event.target:event.target&&event.target.parentElement;
      if(target&&!panel.contains(target)&&((side&&side.contains(target))||target.closest(roots))){read();stopScan('随侧栏手动滚动同步',true);}
    }
    function dispose(){
      if(stopped)return;stopped=true;
      if(bounded)['wheel','touchstart','pointerdown','keydown'].forEach(function(type){panel.ownerDocument.removeEventListener(type,onUserIntent,true);});
      if(observer)observer.disconnect();if(debounce!==null)clearTimeout(debounce);
      if(timer!==null)clearTimeout(timer);timer=debounce=null;running=false;restore();
    }
    async function reveal(el){
      var key=conversationKey(el),found=links().find(function(x){return conversationKey(x)===key;});
      if(found)return found;
      var s=findSide();if(!s)throw new Error('目标会话当前不可定位，已跳过');
      var original=s.scrollTop,behavior=s.style.scrollBehavior,until=Date.now()+20000;s.style.scrollBehavior='auto';s.scrollTop=0;
      try{
        while(alive()&&Date.now()<until){
          if(_batchCancelled())throw new Error('已停止导出');
          await new Promise(function(resolve){setTimeout(resolve,180);});
          found=links().find(function(x){return conversationKey(x)===key;});if(found)return found;
          var before=s.scrollTop;s.scrollTop=advance(s);if(s.scrollTop===before)break;
        }
        throw new Error('目标会话未能重新加载，已跳过');
      }finally{s.style.scrollBehavior=behavior;if(!found&&s.isConnected)s.scrollTop=original;}
    }
    if(bounded)['wheel','touchstart','pointerdown','keydown'].forEach(function(type){document.addEventListener(type,onUserIntent,{capture:true,passive:true});});
    observer=new MutationObserver(onMutation);observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['href','data-conversation-id','aria-busy','class','style']});
    read();
    return {enable:function(){auto=true;start();},setExporting:function(value){exporting=value;if(value)stopScan('导出中，列表已保留');else{read();status(bounded?'随侧栏手动滚动同步':'持续同步中');start();}},dispose:dispose,reveal:reveal,alive:alive};
  }

  function cleanText(t){ return String(t==null?'':t); }

  function extractPage(label,onlyRead){
    if(_rich)_rich.clear();
    var msgs=[],suW=new WeakSet(),seenK=new Set();
    function add(role,el){
      if(_I&&!_I.claim(seenK,el))return;
      var t=_I?_I.content(el):(typeof el==='string'?el:(el.innerText||el.textContent||''));
      if(!t.trim())return;
      var ident=_I&&_I.identity(el,role),html=_rich?_rich.capture(role,t,el):null;
      msgs.push({role:role,content:t,element:el,key:ident&&ident.key,stableId:ident&&ident.stable,richHTML:html});
    }
    if(_dbMessages){
      msgs=_dbMessages.map(function(m){return Object.assign({},m,{richHTML:m.richHTML||(_rich?_rich.capture(m.role,m.content,m.element):null)});});
    } else if(typeof AIExportChatGPT!=='undefined'&&AIExportChatGPT.snapshot(null,!!_rich).length){
      msgs=AIExportChatGPT.snapshot(null,!!_rich);
    } else if(host.includes('chatgpt.com')||host.includes('chat.openai.com')){
      document.querySelectorAll('[data-message-author-role]').forEach(function(el){var r=el.getAttribute('data-message-author-role')==='user'?'用户':'ChatGPT';add(r,el.querySelector('.whitespace-pre-wrap')||el.querySelector('[class*=prose]')||el);});
    } else if(host.includes('claude.ai')){
      var uEls=Array.from(document.querySelectorAll('[data-testid="user-message"]'));
      // 同 fnSingle：优先认 .font-claude-message，避免框到页脚/时间戳/模型切换器
      var aEls=Array.from(document.querySelectorAll('.font-claude-message,[class*="font-claude-message"]'));
      if(!aEls.length) aEls=Array.from(document.querySelectorAll('[data-testid="assistant-message"],[data-testid="ai-turn"]'));
      if(aEls.length>0){
        var cb2=uEls.map(function(e){return{el:e,role:'用户'};}).concat(aEls.map(function(e){return{el:e,role:'Claude'};}));
        cb2.sort(function(a,b){return a.el.compareDocumentPosition(b.el)&4?-1:1;});
        cb2.forEach(function(item){add(item.role,item.el);});
      } else if(uEls.length>0){
        uEls.forEach(function(uEl){
          add('用户',uEl); var node=uEl;
          for(var i=0;i<10;i++){if(!node.parentElement)break;node=node.parentElement;var nxt=node.nextElementSibling;if(nxt&&(nxt.innerText||'').trim().length>0&&!nxt.querySelector('[data-testid="user-message"]')){add('Claude',nxt);break;}}
        });
      } else {
        document.querySelectorAll('.font-claude-message,[class*=claude-message]').forEach(function(el){if((_I?_I.content(el):el.innerText).trim().length>0)add('Claude',el);});
      }
    } else if(host.includes('deepseek.com')){
      if(!_I || !_I.deepseek(add)){
      var dsAI=Array.from(document.querySelectorAll('.ds-markdown')).filter(function(el){return !el.parentElement||!el.parentElement.closest('.ds-markdown');});
      dsAI.forEach(function(aiEl){var node=aiEl;for(var i=0;i<10;i++){if(!node.parentElement)break;node=node.parentElement;var prev=node.previousElementSibling;if(prev&&!suW.has(prev)&&!prev.matches('.ds-markdown')&&!prev.querySelector('.ds-markdown')&&!prev.matches('nav,aside,header')){var pt=(prev.innerText||'').trim();if(pt.length>0||prev.querySelector('img,audio,video')){add('用户',prev);suW.add(prev);break;}}}add('DeepSeek',aiEl);});
      if(!msgs.length)dsAI.forEach(function(el){add('DeepSeek',el);});
      }
    } else if(host.includes('gemini.google.com')){
      var gAll=document.querySelectorAll('user-query,model-response');
      if(gAll.length>0){gAll.forEach(function(el){if(el.tagName.toLowerCase()==='model-response'&&(_I?_I.content(el):(el.innerText||'')).trim().length<1)return;add(el.tagName.toLowerCase()==='user-query'?'用户':'Gemini',el);});}
      else{var guEls=Array.from(document.querySelectorAll('[class*=user-query]')).filter(function(el){return !el.closest('model-response');});var gaEls=Array.from(document.querySelectorAll('[class*=model-response]')).filter(function(el){return !el.closest('user-query');});var gmAll=guEls.map(function(el){return{el:el,role:'用户'};}).concat(gaEls.map(function(el){return{el:el,role:'Gemini'};}));gmAll.sort(function(a,b){return a.el.compareDocumentPosition(b.el)&4?-1:1;});gmAll.forEach(function(item){add(item.role,item.el);});}
    } else if(host.includes('doubao.com')){
      var dbSeenU=new WeakSet();
      var dbAI=Array.from(document.querySelectorAll('[class*="flow-markdown-body"]')).filter(function(el){return !el.parentElement||!el.parentElement.closest('[class*="flow-markdown-body"]');});
      if(dbAI.length>0){
        dbAI.forEach(function(aiEl){
          var node=aiEl;
          for(var di=0;di<15;di++){if(!node.parentElement)break;node=node.parentElement;var prev=node.previousElementSibling;if(prev&&!dbSeenU.has(prev)&&!prev.querySelector('[class*="flow-markdown-body"]')){var pt=(prev.innerText||'').trim();if(pt.length>0||prev.querySelector('img,audio,video')){add('用户',prev);dbSeenU.add(prev);break;}}}
          add('豆包',aiEl);
        });
      } else {
        document.querySelectorAll('[data-role=user],[data-role=assistant]').forEach(function(el){add(el.getAttribute('data-role')==='user'?'用户':'豆包',el);});
      }
    } else if((host.includes('kimi.ai')||host.includes('kimi.com'))||host.includes('moonshot.cn')){
      var kmU=Array.from(document.querySelectorAll('[data-role=user],[class*=userMessage],[class*=UserMessage],[class*=human-message],[class*=HumanMessage]')).filter(function(el){return (_I?_I.content(el):el.innerText).trim().length>0;});var kmA=Array.from(document.querySelectorAll('[data-role=assistant],[class*=assistantMessage],[class*=AssistantMessage],[class*=bot-message],[class*=BotMessage]')).filter(function(el){return (_I?_I.content(el):el.innerText).trim().length>0;});var kmAll=kmU.map(function(el){return{el:el,role:'用户'};}).concat(kmA.map(function(el){return{el:el,role:'Kimi'};}));kmAll.sort(function(a,b){return a.el.compareDocumentPosition(b.el)&4?-1:1;});kmAll.forEach(function(item){add(item.role,item.el);});
    } else if((host.includes('tongyi.aliyun.com')||host.includes('tongyi.com')||host.includes('qianwen.com')||host.includes('qwenlm.ai'))||host.includes('qwenlm.ai')){
      var qwU=Array.from(document.querySelectorAll('[class*=UserQuestion],[class*=humanMessage],[class*=HumanMessage],[class*=userBubble]')).filter(function(el){return (_I?_I.content(el):el.innerText).trim().length>0;});var qwA=Array.from(document.querySelectorAll('[class*=MarkdownContent],[class*=assistantMessage],[class*=AssistantMessage],[class*=BotMessage]')).filter(function(el){return (_I?_I.content(el):el.innerText).trim().length>0&&!el.closest('[class*=UserQuestion],[class*=humanMessage],[class*=HumanMessage]');});var qwAll=qwU.map(function(el){return{el:el,role:'用户'};}).concat(qwA.map(function(el){return{el:el,role:'通义千问'};}));qwAll.sort(function(a,b){return a.el.compareDocumentPosition(b.el)&4?-1:1;});qwAll.forEach(function(item){add(item.role,item.el);});
    } else {
      var g=false;
      document.querySelectorAll('[data-role=user],[data-role=assistant],[data-author=user],[data-author=assistant]').forEach(function(el){var role=el.getAttribute('data-role')||el.getAttribute('data-author')||'';add(role==='user'?'用户':pname,el);g=true;});
      if(!g)document.querySelectorAll('[class*=markdown],[class*=message-content]').forEach(function(el){if((_I?_I.content(el):el.innerText).trim().length>0)add('内容',el);});
    }
    if(onlyRead)return msgs;
    if(aiOnly){ msgs=msgs.filter(function(m){return m.role!=='用户';}); }
    else if(userOnly){ msgs=msgs.filter(function(m){return m.role==='用户';}); }
    var formatted=[]; var i=0;
    while(i<msgs.length){
      var cur=msgs[i]; var versions=[cur];
      if(cur.role!=='用户'&&!aiOnly){while(i+1<msgs.length&&msgs[i+1].role===cur.role){i++;versions.push(msgs[i]);}}
      if(versions.length>1){versions.forEach(function(m,vi){formatted.push('【'+m.role+'说 - V'+(vi+1)+'】\n'+m.content);});}
      else{formatted.push('【'+cur.role+'说】\n'+cur.content);}
      i++;
    }
    var convTime=(function(){
      if(host==='gemini.google.com'){
        var nativeTime=document.querySelector('[data-test-id="chat-history-container"] time[datetime]');
        if(!nativeTime)return '';
        var nativeDate=new Date(nativeTime.getAttribute('datetime'));
        return isNaN(nativeDate)?'':nativeDate.toLocaleString('zh-CN');
      }
      var t=document.querySelector('time[datetime]');
      if(t){var d=new Date(t.getAttribute('datetime'));if(!isNaN(d))return d.toLocaleString('zh-CN');}
      var spans=Array.from(document.querySelectorAll('[class*=time],[class*=Time],[class*=date],[class*=Date]'));
      for(var s of spans){var txt=(s.innerText||'').trim();if(txt&&txt.length<30&&/[\d:\-\/年月日]/.test(txt))return txt;}
      return '';
    })();
    if(!msgs.length)throw new Error('没有识别到消息，或当前筛选条件下内容为空；未生成文件。');
    var hdr='平台：'+pname+'\n对话：'+label+'\n地址：'+location.origin+location.pathname+(_dbNote?'\n'+_dbNote:'')+(convTime?'\n对话时间：'+convTime:'')+(aiOnly?'\n模式：纯AI回复':(userOnly?'\n模式：纯用户提问':''))+'\n提取时间：'+new Date().toLocaleString('zh-CN')+'\n'+'='.repeat(50)+'\n\n';
    remember(msgs,hdr);
    return hdr+formatted.join('\n\n');
  }

  function dlFile(content,name){
    if(format==='pdf'){ _pdfQueue.push(_rich?_rich.freeze(content):content); return; }   // PDF 攒到最后一次性合并打印
    _emit(format, content, _activeName||name, pname);
  }

  // 带超时的 fetch：任一请求卡住超过 ms 毫秒就主动放弃，避免列表/内容拉取永久挂起导致面板永不出现
  var _activeFetchCtrls=[];
  function _abortActiveFetches(){
    _activeFetchCtrls.slice().forEach(function(ctrl){try{ctrl.abort();}catch(e){}});
    _activeFetchCtrls=[];
  }
  function _fetchT(url,opts,ms){
    opts=opts||{};
    var ctrl=new AbortController(); opts.signal=ctrl.signal;
    _activeFetchCtrls.push(ctrl);
    var timer=setTimeout(function(){try{ctrl.abort();}catch(e){}},ms||12000);
    function cleanup(){
      clearTimeout(timer);
      var idx=_activeFetchCtrls.indexOf(ctrl);
      if(idx>=0)_activeFetchCtrls.splice(idx,1);
    }
    return fetch(url,opts).then(function(r){cleanup();return r;},function(e){cleanup();throw e;});
  }

  // ChatGPT auth token (从 /api/auth/session 拿；失败则只用 cookie)
  var _gptAuth=null;
  function _gptFetch(url){
    var opts={credentials:'include'};
    if(_gptAuth) opts.headers={'Authorization':'Bearer '+_gptAuth};
    return _fetchT(url,opts,12000);
  }

  // ChatGPT 专用：直接用 API 拿对话内容，不跳页
  // onDone(ok, errMsg)
  function extractViaAPI(convId,label,onDone,navigate){
    var cancelled=_batchCancelled;
    _gptFetch('/backend-api/conversation/'+convId).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json();}).then(async function(d){
      if(cancelled())return;
      var result=await AIExportChatGPT.prepare(d,{convId:convId,format:format,cancelled:cancelled,navigate:navigate,role:aiOnly?'assistant':userOnly?'user':undefined});
      if(cancelled())return;
      var msgs=result.messages;
      if(aiOnly)msgs=msgs.filter(m=>m.role!=='用户');else if(userOnly)msgs=msgs.filter(m=>m.role==='用户');
      if(!msgs.length)throw Error('当前筛选条件下无消息');
      var hdr='平台：ChatGPT\n对话：'+(d.title||label)+'\n地址：'+location.origin+'/c/'+convId+'\n'+result.note+(aiOnly?'\n模式：纯AI回复':(userOnly?'\n模式：纯用户提问':''))+'\n共 '+msgs.length+' 条\n提取时间：'+new Date().toLocaleString('zh-CN')+'\n'+'='.repeat(50)+'\n\n';
      remember(msgs,hdr);
      var formatted=_typed.turns.map(t=>'【'+t.label+(t.version?' - '+t.version:'')+'】\n'+t.content);
      dlFile(hdr+formatted.join('\n\n'),label);onDone(true,'',result.warnings);
    }).catch(e=>onDone(false,e.message||'接口读取失败'));
  }

  // Claude.ai 专用：直接用 API 拿对话内容，不跳页（panel 不会消失，侧栏零干扰）
  var _claudeOrg=null;
  function extractClaudeViaAPI(convId,label,onDone){
    var cancelled=_batchCancelled;
    _fetchT('/api/organizations/'+_claudeOrg+'/chat_conversations/'+convId+'?tree=True&rendering_mode=messages&render_all_tools=true',{credentials:'include'},15000)
      .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
      .then(function(d){
        if(cancelled())return;
        var msgs=_I.claude(d,convId);
        if(aiOnly){msgs=msgs.filter(function(m){return m.role!=='用户';});}
        else if(userOnly){msgs=msgs.filter(function(m){return m.role==='用户';});}
        if(!msgs.length){onDone(false,'内容为空');return;}
        var formatted=[],fi=0;
        while(fi<msgs.length){var cur=msgs[fi];var versions=[cur];if(cur.role!=='用户'&&!aiOnly){while(fi+1<msgs.length&&msgs[fi+1].role===cur.role){fi++;versions.push(msgs[fi]);}}if(versions.length>1){versions.forEach(function(m,vi){formatted.push('【'+m.role+'说 - V'+(vi+1)+'】\n'+m.content);});}else{formatted.push('【'+cur.role+'说】\n'+cur.content);}fi++;}
        var nm=d.name||label;
        var hdr='平台：Claude\n对话：'+nm+'\n地址：'+location.origin+'/chat/'+convId+'\n接口返回 '+msgs.length+' 条筛选后的消息；附件仅包含可读取说明。'+(aiOnly?'\n模式：纯AI回复':(userOnly?'\n模式：纯用户提问':''))+'\n提取时间：'+new Date().toLocaleString('zh-CN')+'\n'+'='.repeat(50)+'\n\n';
        remember(msgs,hdr);
        dlFile(hdr+formatted.join('\n\n'),nm);
        onDone(true,'');
      }).catch(function(err){onDone(false,(err&&err.message)||'网络错误');});
  }


  function buildPanel(){
    var convs=[];               // 持续增长：DOM 扫到的 + API 拉到的对话，checkbox.value 就是这里的下标
    var _rowsByKey=new Map();   // 稳定地址去重，更新节点/标题不丢勾选
    var _lastRangeIndex=null;
    var styleEl = document.createElement('style'); styleEl.id=PID+'c';
    styleEl.textContent='#'+PID+'{all:initial!important;position:fixed!important;top:20px!important;right:20px!important;width:340px!important;max-height:85vh!important;background:#fff!important;border-radius:14px!important;box-shadow:0 12px 48px rgba(0,0,0,.28)!important;z-index:2147483647!important;font-family:sans-serif!important;font-size:14px!important;overflow:hidden!important;display:flex!important;flex-direction:column!important;color:#111!important;}#'+PID+' *{box-sizing:border-box;}#'+PID+' .'+PID+'r:hover{background:#f5f0ff;}';
    // Host pages reset input appearance. Keep the native control and its checked state visible.
    styleEl.textContent+='#'+PID+' input[type="checkbox"]{all:initial!important;-webkit-appearance:checkbox!important;appearance:auto!important;display:inline-block!important;position:static!important;width:16px!important;height:16px!important;min-width:16px!important;min-height:16px!important;margin:0!important;opacity:1!important;visibility:visible!important;flex:none!important;cursor:pointer!important;accent-color:'+_panelColor+'!important;color-scheme:light!important;}#'+PID+' .'+PID+'r[data-selected="true"]{background:#eefbf5!important;}#'+PID+' input[type="checkbox"]:focus-visible{outline:2px solid #2563eb!important;outline-offset:2px!important;}';
    document.head.appendChild(styleEl);
    var panel=document.createElement('div'); panel.id=PID; panel.setAttribute('data-mode',_mode);
    var hd=document.createElement('div'); hd.setAttribute('style','padding:13px 16px;background:'+_panelColor+';color:#fff;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;');
    var hdT=document.createElement('span'); hdT.setAttribute('style','font-weight:700;font-size:14px;'); hdT.textContent=(aiOnly?'纯AI回复 — ':(userOnly?'纯用户提问 — ':'批量导出 — '))+pname;
    var xBtn=document.createElement('button'); xBtn.setAttribute('style','background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;padding:0;'); xBtn.textContent='×'; panel._aiExportDispose=function(){_batchCancelled=function(){return true;};_abortActiveFetches();if(_listSync)_listSync.dispose();};
    xBtn.onclick=function(){panel._aiExportDispose();panel.remove();styleEl.remove();};
    hd.appendChild(hdT); hd.appendChild(xBtn);
    var tb=document.createElement('div'); tb.setAttribute('style','padding:9px 14px;border-bottom:1px solid #eee;display:flex;gap:7px;align-items:center;flex-wrap:wrap;flex-shrink:0;background:#fafafa;');
    var allBtn=document.createElement('button'); allBtn.textContent='全选'; allBtn.setAttribute('style','font-size:12px;padding:4px 10px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer;');
    var noneBtn=document.createElement('button'); noneBtn.textContent='清空'; noneBtn.setAttribute('style','font-size:12px;padding:4px 10px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer;');
    var rangeBtn=document.createElement('button'); rangeBtn.textContent='区间'; rangeBtn.title='输入 1-10，或按住 Shift 点击两端'; rangeBtn.setAttribute('style','font-size:12px;padding:4px 10px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer;');
    var cntEl=document.createElement('span'); cntEl.setAttribute('style','margin-left:auto;font-size:12px;color:#888;'); cntEl.textContent='已选 0 个';
    tb.appendChild(allBtn); tb.appendChild(noneBtn); tb.appendChild(rangeBtn); tb.appendChild(cntEl);
    var lst=document.createElement('div'); lst.setAttribute('style','overflow-y:auto;flex:1;padding:5px 0;');
    var loadEl=document.createElement('div'); loadEl.setAttribute('style','padding:16px;color:#999;text-align:center;font-size:12px;line-height:1.7;');
    loadEl.textContent='正在加载对话列表…';
    lst.appendChild(loadEl);
    var ft=document.createElement('div'); ft.setAttribute('style','padding:12px 14px;border-top:1px solid #eee;flex-shrink:0;');
    var goBtn=document.createElement('button'); goBtn.textContent='开始导出'; goBtn.setAttribute('style','width:100%;padding:10px;background:'+_panelColor+';color:#fff;border:none;border-radius:9px;font-size:14px;font-weight:600;cursor:pointer;');
    var ctl=document.createElement('div'); ctl.setAttribute('style','display:none;gap:8px;margin-top:8px;');
    var pauseBtn=document.createElement('button'); pauseBtn.textContent='暂停'; pauseBtn.setAttribute('style','flex:1;padding:8px;border:1px solid #D1D5DB;border-radius:8px;background:#fff;color:#374151;font-size:13px;cursor:pointer;');
    var stopBtn=document.createElement('button'); stopBtn.textContent='停止'; stopBtn.setAttribute('style','flex:1;padding:8px;border:1px solid #FCA5A5;border-radius:8px;background:#FEF2F2;color:#B91C1C;font-size:13px;cursor:pointer;');
    ctl.appendChild(pauseBtn); ctl.appendChild(stopBtn);
    var pgEl=document.createElement('div'); pgEl.setAttribute('style','margin-top:9px;font-size:12px;color:#555;text-align:center;line-height:1.65;display:none;');
    ft.appendChild(goBtn); ft.appendChild(ctl); ft.appendChild(pgEl);
    panel.appendChild(hd); panel.appendChild(tb); panel.appendChild(lst); panel.appendChild(ft);
    document.body.appendChild(panel);
    function _checks(){return Array.from(lst.querySelectorAll('input[type="checkbox"]'));}
    function updateCnt(){_checks().forEach(function(c){c.parentElement.setAttribute('data-selected',String(c.checked));});cntEl.textContent='已选 '+lst.querySelectorAll('input:checked').length+' 个';}
    function setRangeChecked(a,b,checked){
      if(convs.length===0)return;
      a=Math.max(0,Math.min(convs.length-1,a));
      b=Math.max(0,Math.min(convs.length-1,b));
      var from=Math.min(a,b),to=Math.max(a,b);
      _checks().forEach(function(c){var v=parseInt(c.value,10);if(v>=from&&v<=to)c.checked=checked;});
      updateCnt();
    }
    lst.addEventListener('change',updateCnt);
    lst.addEventListener('click',function(e){
      var cb=e.target;
      if(!cb||cb.tagName!=='INPUT'||cb.type!=='checkbox')return;
      var idx=parseInt(cb.value,10);
      if(e.shiftKey&&_lastRangeIndex!==null)setRangeChecked(_lastRangeIndex,idx,cb.checked);
      _lastRangeIndex=idx;
    });
    allBtn.onclick=function(){_checks().forEach(function(c){c.checked=true;});updateCnt();};
    noneBtn.onclick=function(){_checks().forEach(function(c){c.checked=false;});updateCnt();_lastRangeIndex=null;};
    rangeBtn.onclick=function(){
      var raw=prompt('输入要选择的区间，例如 1-10。也可以按住 Shift 点击两个端点。');
      if(!raw)return;
      var m=String(raw).match(/^\s*(\d+)\s*(?:-|~|到|至|,|，|\s+)\s*(\d+)\s*$/);
      if(!m){alert('请输入类似 1-10 的区间');return;}
      var a=parseInt(m[1],10)-1,b=parseInt(m[2],10)-1;
      if(isNaN(a)||isNaN(b)||a<0||b<0||a>=convs.length||b>=convs.length){alert('区间超出当前列表范围：1-'+convs.length);return;}
      setRangeChecked(a,b,true); _lastRangeIndex=b;
    };

    // 把一批对话条目追加进列表（去重）；加载提示始终留在最底部
    var listMessage='正在加载对话列表…';
    function _appendRows(newEls){
      (newEls||[]).forEach(function(el){
        if(!el)return;
        var href=(el.getAttribute&&el.getAttribute('href'))||el.href||'';
        var t=(el.innerText||el.textContent||'').trim().split('\n')[0];
        if(t.length<2)return;
        var key=conversationKey(el),previous=_rowsByKey.get(key);
        if(previous){
          convs[previous.index]=el.cloneNode(true);
          if(previous.title!==t){previous.title=t;previous.text.textContent=(previous.index+1)+'. '+t.slice(0,55);}
          return;
        }
        var idx=convs.length; convs.push(el.cloneNode(true));
        var row=document.createElement('label'); row.className=PID+'r'; row.setAttribute('style','display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;');
        var cb=document.createElement('input'); cb.type='checkbox'; cb.value=idx; cb.setAttribute('style','width:15px;height:15px;cursor:pointer;flex-shrink:0;accent-color:'+_panelColor+';');
        var tx=document.createElement('span'); tx.setAttribute('style','overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:#333;');
        tx.textContent=(idx+1)+'. '+t.slice(0,55);
        row.appendChild(cb); row.appendChild(tx); lst.insertBefore(row,loadEl);
        _rowsByKey.set(key,{index:idx,title:t,text:tx});
      });
      listStatus(listMessage);
    }
    _addConvLinks=function(els){_appendRows(els);};
    function listStatus(message){
      listMessage=message;
      if(!panel.isConnected)return;
      var text='已发现 '+convs.length+' 个对话 · '+message;
      if(loadEl.textContent!==text)loadEl.textContent=text;
    }
    _finishLoading=function(errMsg){
      if(!panel.isConnected)return;
      listStatus(errMsg?'列表加载异常（'+errMsg+'），已找到的对话可导出；持续同步中':'持续同步中');
    };
    _appendRows(findConvs());
    _listSync=createListSync(panel,_appendRows,listStatus);

    function startExport(){
      var sel=[];
      lst.querySelectorAll('input:checked').forEach(function(cb){var idx=parseInt(cb.value);sel.push({index:idx,state:'pending',el:convs[idx],label:(convs[idx].innerText||convs[idx].textContent||'对话').trim().split('\n')[0]});});
      if(!sel.length){alert('请先勾选要导出的对话');return;}
      var names=new Set();sel.forEach(function(item){var name=item.label,base=_filenameBase(name,pname),n=1;while(names.has(base)){name=_cleanFilePart(_stripPlatform(item.label,pname)).slice(0,55)+'_'+(item.index+1)+'_'+(n++);base=_filenameBase(name,pname);}names.add(base);item.exportName=name;});
      var oldReport=ft.querySelector('[data-export-report]');if(oldReport)oldReport.remove();

      if(_listSync)_listSync.setExporting(true);
      goBtn.disabled=true; goBtn.style.opacity='0.6'; ctl.style.display='flex'; pgEl.style.display='block';
      pauseBtn.disabled=false; stopBtn.disabled=false; pauseBtn.textContent='暂停';
      _exportFailures=[];
      _pdfQueue=[];   // 每次开始导出前清空 PDF 队列，避免跨次累积
      var i=0,_okCount=0,_errCount=0,_paused=false,_stopExport=false,_busy=false,_finished=false,_nextTimer=null;
      _batchCancelled=function(){return _finished||_stopExport||!panel.isConnected;};
      function isHardStop(errMsg){
        return /HTTP\s*(401|403|429)|captcha|验证码|验证|verify|verification|rate limit|too many requests|forbidden|blocked|access denied|unusual activity|suspicious|风控|限流/i.test(errMsg||'');
      }
      function resetExportUI(){
        if(_nextTimer){clearTimeout(_nextTimer);_nextTimer=null;}
        _busy=false; ctl.style.display='none';
        if(_listSync&&panel.isConnected)_listSync.setExporting(false);
        pauseBtn.disabled=false; stopBtn.disabled=false; pauseBtn.textContent='暂停';
        goBtn.textContent='开始导出'; goBtn.disabled=false; goBtn.style.opacity='1'; goBtn.onclick=startExport;
      }
      function finishReport(reason){
        sel.forEach(function(item){if(item.state==='running')item.state='pending';});
        var generated=sel.filter(x=>x.state==='generated'||x.state==='needs-review'),failed=sel.filter(x=>x.state==='failed'),pending=sel.filter(x=>x.state==='pending'),review=sel.filter(x=>x.state==='needs-review');
        _checks().forEach(function(cb){var item=sel.find(x=>x.index===Number(cb.value));if(item)cb.checked=item.state!=='generated';});updateCnt();
        var summary=(reason?reason+'；':'')+'预期 '+sel.length+' = 已生成 '+generated.length+' + 失败 '+failed.length+' + 未处理 '+pending.length+'。';
        if(format==='pdf'&&_pdfQueue.length){_printMany(_pdfQueue,_filenameBase('批量对话',pname));summary+=' 已打开打印内容；保存或取消由打印窗口决定，未确认PDF落盘。';}
        else if(generated.length)summary+=' 已发起下载，是否保存请以浏览器下载记录为准。';
        else summary+=' 没有生成文件，也未发起下载或打印。';
        if(review.length)summary+=' '+review.length+' 个文件含范围/未转换说明，仍保留勾选。';
        if(failed.length)summary+=' 首项失败：'+failed[0].label.slice(0,24)+'：'+failed[0].error.slice(0,100)+'。完整失败原因见本次清单。';
        pgEl.textContent=summary;
        var report={createdAt:new Date().toISOString(),format:format,expected:sel.length,generated:generated.length,failed:failed.length,pending:pending.length,downloadState:generated.length?(format==='pdf'?'print-opened-not-saved':'initiated-not-confirmed'):'not-started',items:sel.map(x=>({title:x.label,source:conversationKey(x.el),filename:format==='pdf'?'合并打印内容':_fname(x.exportName,pname,format==='word'?'doc':format,x.el.getAttribute('href')),status:x.state,error:x.error||'',note:x.note||''}))};
        var button=document.createElement('button');button.textContent='下载本次清单';button.setAttribute('data-export-report','');button.style.cssText='margin-top:8px;padding:8px 12px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer';button.onclick=function(){_dlBlob(JSON.stringify(report,null,2),'application/json','AI对话导出_本次清单.json');};ft.appendChild(button);
      }
      function finishStopped(reason){
        if(_finished)return;_finished=true;_stopExport=true;_abortActiveFetches();resetExportUI();finishReport(reason||'已停止');
      }
      function finishDone(){
        if(_finished)return;_finished=true;resetExportUI();finishReport('本批次处理结束');
      }
      function scheduleNext(delay){
        _busy=false;
        if(_finished||!panel.isConnected)return;
        if(_stopExport){finishStopped();return;}
        if(_paused){pgEl.textContent='已暂停：已生成 '+_okCount+' 个，点击「继续」恢复';return;}
        if(_nextTimer)clearTimeout(_nextTimer);
        _nextTimer=setTimeout(function(){_nextTimer=null;next();},delay);
      }
      pauseBtn.onclick=function(){
        if(_finished)return;
        _paused=!_paused;
        pauseBtn.textContent=_paused?'继续':'暂停';
        if(_paused){
          if(_nextTimer){clearTimeout(_nextTimer);_nextTimer=null;}
          pgEl.textContent='已暂停：当前请求完成后会停住';
        }else{
          pgEl.textContent='继续中...';
          if(!_busy&&!_nextTimer)next();
        }
      };
      stopBtn.onclick=function(){
        if(_finished)return;
        pauseBtn.disabled=true; stopBtn.disabled=true;
        finishStopped('已手动停止：已生成 '+_okCount+' 个，失败 '+_errCount+' 个，已发起的下载不会撤销');
      };
      function next(){
        if(_finished||!panel.isConnected)return;
        if(_stopExport){finishStopped();return;}
        if(_paused){pgEl.textContent='已暂停：已生成 '+_okCount+' 个，点击「继续」恢复';return;}
        if(i>=sel.length){finishDone();return;}
        _busy=true;var item=sel[i++];item.state='running';_activeName=item.exportName;_fileSource=item.el.getAttribute('href')||location.href;
        pgEl.textContent='('+i+'/'+sel.length+') '+item.label.slice(0,20)+'…';
        var cancelled=()=>_finished||_stopExport||!panel.isConnected;
        async function processItem(){
          var href=item.el.getAttribute&&item.el.getAttribute('href')||'';
          if(_isChatGPT&&/\/c\//.test(href)){
            var id=new URL(href,location.href).pathname.split('/c/')[1];
            return new Promise((resolve,reject)=>extractViaAPI(id,item.label,(ok,error,warnings)=>ok?resolve({note:(warnings||[]).join('；')}):reject(Error(error)),async()=>{var live=await _listSync.reveal(item.el);if(cancelled())throw Error('已停止');await _I.navigate(live,{cancelled:cancelled});}));
          }
          if(_isClaude&&_claudeOrg&&/\/chat\//.test(href)){
            var id=new URL(href,location.href).pathname.split('/chat/')[1];
            return new Promise((resolve,reject)=>extractClaudeViaAPI(id,item.label,(ok,error)=>ok?resolve({}):reject(Error(error))));
          }
          var result;
          if(_db&&_db.ownsPage()){
            var options={cancelled:cancelled};await _db.navigate(item.el,options);if(cancelled())throw Error('已停止');result=await _db.collect(options);
          }else{
            var live=await _listSync.reveal(item.el);if(cancelled())throw Error('已停止');var target=await _I.navigate(live,{cancelled:cancelled});
            result=await (typeof AIExportGemini!=='undefined'&&AIExportGemini.ownsPage()?AIExportGemini:typeof AIExportText!=='undefined'?AIExportText:_I).collect(()=>extractPage(item.label,true),{target:target,cancelled:cancelled});
          }
          if(cancelled())throw Error('已停止');
          _dbMessages=result.messages;_dbNote=result.note||'';
          try{dlFile(extractPage(item.label),item.label);}finally{_dbMessages=null;_dbNote='';}
          return {note:result.complete===false?result.note:''};
        }
        processItem().then(function(result){
          if(cancelled())return;_okCount++;item.note=result.note||'';item.state=item.note?'needs-review':'generated';pgEl.textContent='('+i+'/'+sel.length+') 已生成 '+item.label.slice(0,18)+(item.note?'（含说明）':'');scheduleNext(0);
        }).catch(function(error){
          if(cancelled())return;_errCount++;item.state='failed';item.error=error.message||'提取失败';_exportFailures.push(item.label+'：'+item.error);
          if(isHardStop(item.error)){finishStopped('接口要求验证或限流，已停止后续请求');return;}
          pgEl.textContent='('+i+'/'+sel.length+') 失败：'+item.error.slice(0,160);scheduleNext(800);
        });
      }

      next();
    }
    goBtn.onclick=startExport;
  }

  var _isChatGPT=host.includes('chatgpt.com')||host.includes('chat.openai.com');
  var _isClaude=host.includes('claude.ai');

  // Observer remains active after the initial automatic scan finishes.
  function _scrollMore(onDone){if(_listSync)_listSync.enable();}

  if(_isChatGPT){
    // ChatGPT：先弹面板（已铺侧栏可见对话），再后台拿 token 并分页拉全量，拉到一页就补一页
    buildPanel();
    var _listedGPT=new Set();
    function _fetchPage(offset){
      if(!listAlive())return;
      _gptFetch('/backend-api/conversations?limit=100&offset='+offset+'&order=updated')
        .then(function(r){
          if(!r.ok) throw new Error('HTTP '+r.status);
          return r.json();
        })
        .then(function(d){
          if(!listAlive())return;
          var items=Array.isArray(d.items)?d.items:[],links=[],newIds=0;
          items.forEach(function(c){
            if(!c||!c.id)return;if(!_listedGPT.has(c.id)){_listedGPT.add(c.id);newIds++;}
            var a=document.createElement('a');
            a.href='/c/'+c.id;
            a.textContent=c.title||'对话';
            links.push(a);
          });
          _addConvLinks(links);
          var total=Number.isFinite(d.total)?d.total:null,got=offset+items.length;
          if(items.length&&!newIds){_finishLoading('接口重复返回相同页面，历史列表未完整加载');return;}
          if(items.length&&(total!==null?got<total:items.length===100))_fetchPage(got);
          else if(total!==null&&got<total)_finishLoading('接口提前返回空页，历史列表未完整加载');
          else _finishLoading('');
        })
        .catch(function(err){if(!listAlive())return;_finishLoading((err&&err.message)||'API失败');_scrollMore();});
    }
    // 先尝试拿 accessToken（失败也无所谓，cookie 兜底）
    _fetchT('/api/auth/session',{credentials:'include'},10000)
      .then(function(r){return r.ok?r.json():null;})
      .then(function(s){if(s&&s.accessToken)_gptAuth=s.accessToken;})
      .catch(function(){})
      .then(function(){_fetchPage(0);});
  } else if(_isClaude){
    // Claude.ai：先弹面板，再后台调官方接口全量拉对话（含 Projects / 未展开分组），拉到一页就补一页
    buildPanel();
    function _claudeListPage(offset){
      if(!listAlive())return Promise.resolve();
      return _fetchT('/api/organizations/'+_claudeOrg+'/chat_conversations?limit=50&offset='+offset,{credentials:'include'},12000)
        .then(function(r){if(!r.ok)throw new Error('list HTTP '+r.status);return r.json();})
        .then(function(items){
          if(!listAlive())return;
          items=items||[]; var links=[];
          items.forEach(function(c){
            var a=document.createElement('a');
            a.href='/chat/'+c.uuid; a.textContent=c.name||'对话';
            links.push(a);
          });
          _addConvLinks(links);
          if(items.length===50&&offset+50<3000){return _claudeListPage(offset+50);}
        });
    }
    _fetchT('/api/organizations',{credentials:'include'},10000)
      .then(function(r){if(!r.ok)throw new Error('org HTTP '+r.status);return r.json();})
      .then(function(orgs){
        if(!listAlive())return;
        var chatOrg=null;
        (orgs||[]).forEach(function(o){if(!chatOrg&&o&&o.capabilities&&o.capabilities.indexOf('chat')>=0)chatOrg=o;});
        if(!chatOrg&&orgs&&orgs.length)chatOrg=orgs[0];
        if(!chatOrg)throw new Error('无组织');
        _claudeOrg=chatOrg.uuid;
        return _claudeListPage(0);
      })
      .then(function(){_finishLoading('');})
      .catch(function(err){if(!listAlive())return;_finishLoading((err&&err.message)||'API失败');_scrollMore();});
  } else {
    // DeepSeek / 豆包 / Kimi / 通义 等：先弹面板（已铺侧栏可见对话），再后台滚动补全
    buildPanel();
    _scrollMore(function(){_finishLoading('');});
  }
}

// 导出格式选择（chip 切换），默认 txt
var _fmt='txt';
Array.prototype.forEach.call(document.querySelectorAll('.fmt'),function(el){
  el.addEventListener('click',function(){
    _fmt=el.getAttribute('data-fmt');
    Array.prototype.forEach.call(document.querySelectorAll('.fmt'),function(x){x.classList.remove('on');});
    el.classList.add('on');
  });
});

document.getElementById('b1').addEventListener('click',function(){runInPageWithArgs(fnSingle,[_fmt]);});

document.getElementById('b2').addEventListener('click',function(){runInPageWithArgs(fnBatch,[false,false,_fmt]);});

document.getElementById('b3').addEventListener('click',function(){runInPageWithArgs(fnBatch,[true,false,_fmt]);});

document.getElementById('b4').addEventListener('click',function(){runInPageWithArgs(fnBatch,[false,true,_fmt]);});
