/* Rich exports only. Local rendering; never fetches or mutates source messages. */
(function (root) {
  'use strict';
  var VERSION = '1.5.0';
  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function readableText(node) {
    if(!node)return '';
    if(node.nodeType===3)return node.nodeValue||'';
    if(node.nodeType!==1)return '';
    var tag=String(node.localName||'').toLowerCase();
    if(/^(script|style|noscript|template)$/.test(tag)||node.hidden||node.getAttribute('aria-hidden')==='true')return '';
    try{var s=getComputedStyle(node);if(s.display==='none'||s.visibility==='hidden')return '';}catch(_){}
    if(tag==='br')return '\n';
    if(tag==='input')return node.type==='checkbox'?(node.checked?'☑':'☐'):String(node.value||'');
    if(tag==='textarea')return node.value||node.textContent||'';
    if(tag==='select')return Array.from(node.selectedOptions||[]).map(o=>o.textContent).join('、');
    var value=Array.from(node.childNodes||[]).map(readableText).join('');
    var label=node.getAttribute('aria-label')||node.getAttribute('alt')||node.getAttribute('title')||'';
    if(label&&!value.includes(label))value=label+(value?'\n'+value:'');
    var now=node.getAttribute('aria-valuetext')||node.getAttribute('aria-valuenow');if(now&&!value.includes(now))value+=' '+now;
    return /^(p|div|section|li|tr|h[1-6]|pre|svg|foreignobject)$/.test(tag)?'\n'+value+'\n':value;
  }
  function fallbackMarkup(text,emptyNote) {
    text=String(text||'').trim();
    return '<div data-export-fallback="text"><p>［'+(text?'这部分排版或图形未完整保存，已保留可读取的文字和数值。':emptyNote||'这部分没有可读取的文字，原图或附件请在原对话查看。')+'］</p>'+(text?'<div style="white-space:pre-wrap">'+escapeHTML(text)+'</div>':'')+'</div>';
  }
  function safeURL(value, base) {
    try {
      var url = new URL(String(value || '').trim(), base || location.href);
      return /^(https?:|mailto:)$/.test(url.protocol) ? url.href : '';
    } catch (_) { return ''; }
  }
  var tags = new Set('p div span h1 h2 h3 h4 h5 h6 strong b em i u s del mark sub sup blockquote ul ol li pre code br hr table thead tbody tfoot tr td th caption a dl dt dd'.split(' '));
  function copyNode(node, fromPage) {
    if (node.nodeType === 3) return document.createTextNode(node.nodeValue);
    if (node.nodeType !== 1) return document.createTextNode('');
    var tag = node.tagName.toLowerCase();
    if (/^(script|style|iframe|object|embed|link|meta|button|textarea|select|noscript)$/.test(tag)) return document.createTextNode('');
    if (fromPage && node.matches('[hidden],[aria-hidden="true"],[role="button"],.sr-only,.screen-reader-user-query-label,.screen-reader-model-response-label,[data-rich-export-control]')) return document.createTextNode('');
    if (fromPage) { var visibility=getComputedStyle(node); if(visibility.display==='none'||visibility.visibility==='hidden')return document.createTextNode(''); }
    if (tag === 'input') return document.createTextNode(node.type === 'checkbox' ? (node.checked ? '☑ ' : '☐ ') : '');
    if (tag === 'img') {
      var src = node.getAttribute('src') || '', alt = node.getAttribute('alt') || '图片';
      if (/^data:image\/(png|jpeg|gif|webp);base64,[a-z\d+/=\s]+$/i.test(src)) {
        var image = document.createElement('img'); image.setAttribute('src', src); image.setAttribute('alt', alt); return image;
      }
      var link = safeURL(src, node.baseURI);
      var item = document.createElement(link ? 'a' : 'span');
      item.textContent = '［图片：' + alt + '］';
      if (link) item.setAttribute('href', link);
      return item;
    }
    // Preserve a formula's source once instead of copying hidden and visual twins.
    if (fromPage && node.matches('.katex')) {
      var math = node.querySelector('annotation[encoding="application/x-tex"]');
      if (math) { var formula = document.createElement('code'); formula.textContent = math.textContent; return formula; }
    }
    if (tag === 'svg') return document.createTextNode(node.getAttribute('aria-label') || '');
    var out = document.createElement(tags.has(tag) ? tag : 'div');
    if (tag === 'a') {
      var href = safeURL(node.getAttribute('href'), node.baseURI);
      if (href) { out.setAttribute('href', href); out.setAttribute('rel', 'noopener noreferrer'); }
    }
    ['start', 'value', 'colspan', 'rowspan'].forEach(function (key) {
      var value = node.getAttribute(key);
      if (value && /^\d{1,5}$/.test(value) && ((key === 'start' && tag === 'ol') || (key === 'value' && tag === 'li') || (/span$/.test(key) && /^(td|th)$/.test(tag)))) out.setAttribute(key, value);
    });
    if (tag === 'ol' && node.hasAttribute('reversed')) out.setAttribute('reversed', '');
    var style = node.style;
    if (fromPage) {
      try { style = getComputedStyle(node); } catch (_) {}
    }
    if (style) {
      if (/^(span|div|p|a)$/.test(tag) && (parseInt(style.fontWeight, 10) >= 600 || style.fontWeight === 'bold')) out.style.fontWeight = '700';
      if (/^(span|div|p|a)$/.test(tag) && style.fontStyle === 'italic') out.style.fontStyle = 'italic';
      if (/^(span|a)$/.test(tag) && /underline|line-through/.test(style.textDecorationLine || '')) out.style.textDecorationLine = style.textDecorationLine;
      if (/^(th|td|p)$/.test(tag) && /^(left|right|center)$/.test(style.textAlign)) out.style.textAlign = style.textAlign;
      if (fromPage && /^(p|div|span)$/.test(tag) && /^(pre-wrap|pre-line)$/.test(style.whiteSpace)) out.style.whiteSpace = style.whiteSpace;
    }
    Array.prototype.forEach.call(node.childNodes, function (child) { out.appendChild(copyNode(child, fromPage)); });
    return out;
  }
  function cleanMarkup(html) {
    var template = document.createElement('template'); template.innerHTML = html;
    var container = document.createElement('div');
    Array.prototype.forEach.call(template.content.childNodes, function (node) { container.appendChild(copyNode(node, false)); });
    return container.innerHTML;
  }
  var BASE_CSS = [
    '*{box-sizing:border-box}',
    'html{background:#fff}',
    'body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2937;background:#fff;max-width:860px;margin:0 auto;padding:40px;line-height:1.75;font-size:14px}',
    '.doc-title{font-size:22px;font-weight:700;line-height:1.4;margin:0 0 12px;overflow-wrap:anywhere}',
    '.meta{font-size:12px;color:#6b7280;background:none;border-radius:0;padding:0 0 18px;margin:0 0 26px;border-bottom:1px solid #d1d5db;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.turn{margin:0 0 28px;position:relative;break-inside:auto}',
    '.who,.turn.user .who,.turn.ai .who{font-size:12px;color:#6b7280;font-weight:600;margin:0 0 8px;break-after:avoid-page;page-break-after:avoid}',
    '.bubble,.turn.user .bubble,.turn.ai .bubble{padding:0;border-radius:0;background:transparent;font-size:14px;line-height:1.75;white-space:normal;overflow-wrap:anywhere;word-wrap:break-word}',
    '.bubble p{margin:0 0 10px;orphans:2;widows:2}.bubble p:last-child{margin-bottom:0}',
    '.bubble h1,.bubble h2,.bubble h3,.bubble h4,.bubble h5,.bubble h6{color:#1f2937;font-weight:700;line-height:1.45;margin:24px 0 12px;break-after:avoid-page;page-break-after:avoid;overflow-wrap:anywhere}',
    '.bubble h1{font-size:28px}.bubble h2{font-size:21px}.bubble h3{font-size:18px}.bubble h4{font-size:16px}.bubble h5{font-size:14px}.bubble h6{font-size:13px}',
    '.bubble>:first-child{margin-top:0}.bubble strong,.bubble b{font-weight:700}.bubble em,.bubble i{font-style:italic}',
    '.bubble blockquote{margin:12px 0;padding:0 0 0 14px;border-left:3px solid #d1d5db;color:#374151}',
    '.bubble ul,.bubble ol{margin:10px 0;padding-left:28px}.bubble li{margin:4px 0}.bubble li>ul,.bubble li>ol{margin:4px 0}.bubble li>p{margin-bottom:4px}',
    '.bubble table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:13px;line-height:1.6;margin:16px 0}.bubble td,.bubble th{border:1px solid #d1d5db;padding:8px 10px;text-align:left;vertical-align:top;overflow-wrap:anywhere;word-break:break-word}.bubble th{background:#f3f4f6;font-weight:700}.bubble thead{display:table-header-group}.bubble tr{break-inside:avoid}',
    '.bubble pre{background:#f3f4f6;border:1px solid #e5e7eb;border-radius:4px;padding:12px 14px;margin:14px 0;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;line-height:1.6;break-inside:auto}',
    '.bubble code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em;background:#f3f4f6;padding:1px 4px;border-radius:3px;white-space:pre-wrap}.bubble pre code{background:none;padding:0;font-size:12px}',
    '.bubble a{color:#1f2937;text-decoration:underline;overflow-wrap:anywhere}.bubble hr{border:0;border-top:1px solid #d1d5db;margin:22px 0}.bubble img{max-width:100%;height:auto}.bubble mark{background:#fef08a}.bubble dt{font-weight:700}.bubble dd{margin-left:24px}.plain-source{white-space:pre-wrap}',
    '.conv-sep{page-break-after:always;height:0}',
    '@media(max-width:600px){body{padding:24px 18px}.bubble h1{font-size:24px}.bubble h2{font-size:20px}.bubble td,.bubble th{padding:6px}.bubble ul,.bubble ol{padding-left:22px}}',
    '@page{size:A4;margin:14mm}',
    '@media print{html,body{max-width:none;margin:0;padding:0!important;background:#fff!important;font-size:10.5pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}.bubble,.turn.user .bubble,.turn.ai .bubble{font-size:10.5pt}.turn{break-inside:auto;page-break-inside:auto}.bubble h1{font-size:21pt}.bubble h2{font-size:15.75pt}.bubble h3{font-size:13.5pt}.bubble h4{font-size:12pt}.bubble h5{font-size:10.5pt}.bubble h6{font-size:10pt}#ed-bar,.turn .del{display:none!important}.bubble table{font-size:9.75pt}.bubble pre code{font-size:9pt}}'
  ].join('\n');
  function css(editable) {
    return BASE_CSS + (editable ? '\nbody{padding-top:105px}#ed-bar{left:18px;right:18px;max-width:820px;margin:auto;flex-wrap:wrap;justify-content:center}#ed-tip{white-space:normal}#ed-bar button{flex-shrink:0}.turn .del{left:-14px}@media(max-width:600px){body{padding-top:142px}#ed-tip{width:100%;font-size:11px;text-align:center}}' : '');
  }
  function create(parseConv) {
    if (!root.marked || !root.marked.Marked) throw new Error('本地 Markdown 渲染库未加载');
    var parser = new root.marked.Marked({gfm:true,breaks:true,async:false,renderer:{html:function(token){return escapeHTML(token.text);}}});
    var captured = new Map(), current = null;
    // Typed messages avoid interpreting a user's literal 【…说】 or \\n as export delimiters.
    function useMessages(messages, header, options) {
      var turns = [];
      for(var i=0;i<messages.length;i++){
        var first=messages[i], versions=[first];
        if(first.role!=='用户'&&(!options||options.groupVersions!==false))while(i+1<messages.length&&messages[i+1].role===first.role)versions.push(messages[++i]);
        versions.forEach(function(message,index){turns.push({label:message.role+'说',version:versions.length>1?'V'+(index+1):'',isUser:message.role==='用户',content:message.content,richHTML:message.richHTML});});
      }
      current={header:String(header||'').split('='.repeat(50))[0].trim(),turns:turns};
    }
    function key(role, content) { return role + '\u0000' + content; }
    function capture(role, content, element) {
      if (!element || typeof element === 'string' || element.nodeType !== 1) return;
      var box = document.createElement('div');
      try{box.appendChild(copyNode(element, true));}catch(_){box.innerHTML=fallbackMarkup(content||readableText(element));}
      captured.set(key(role, content), box.innerHTML);
      return box.innerHTML;
    }
    function freeze(plain) {
      if (plain && plain.richExportVersion === VERSION) return plain;
      var conv = current || parseConv(String(plain || ''));
      return {richExportVersion:VERSION,header:conv.header,turns:conv.turns.map(function(turn){
        var role = turn.label.replace(/说$/, '');
        var saved = turn.richHTML || captured.get(key(role,turn.content));
        var html;
        try{html = saved || (turn.isUser ? '<p class="plain-source">'+escapeHTML(turn.content)+'</p>' : cleanMarkup(parser.parse(turn.content)));}
        catch(_){html=fallbackMarkup(turn.content);}
        return {label:turn.label,version:turn.version,isUser:turn.isUser,html:html};
      })};
    }
    function conversation(plain, editable) {
      var conv = freeze(plain), edit = editable ? ' contenteditable="true"' : '', html = '';
      var match = conv.header.match(/(?:^|\n)(?:来源|对话)：([^\n]*)/);
      if (match) html += '<h1 class="doc-title"'+edit+'>'+escapeHTML(match[1])+'</h1>';
      if (conv.header) html += '<div class="meta"'+edit+'>'+escapeHTML(conv.header).replace(/\n/g,'<br>')+'</div>';
      conv.turns.forEach(function(turn){
        var name = turn.label.replace(/说$/, '')+(turn.version ? ' · '+turn.version : '');
        html += '<div class="turn '+(turn.isUser?'user':'ai')+'">'+(editable?'<button class="del" title="删除本段" contenteditable="false">×</button>':'')+'<div class="who"'+edit+'>'+escapeHTML(name)+'</div><div class="bubble"'+edit+'>'+turn.html+'</div></div>';
      });
      return html;
    }
    function page(inner, title) {
      return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escapeHTML(title||'AI对话导出')+'</title><style>'+css(false)+'</style></head><body>'+inner+'</body></html>';
    }
    function word(plain) {
      var box = document.createElement('div'); box.innerHTML = conversation(plain,false);
      // Word imports div borders/margins onto each paragraph; use real paragraphs here.
      box.querySelectorAll('.meta,.who').forEach(function(el){var p=document.createElement('p');p.className=el.className;while(el.firstChild)p.appendChild(el.firstChild);el.replaceWith(p);});
      box.querySelectorAll('th,td').forEach(function(cell){if(!cell.querySelector('p,div,ul,ol,pre,table')){var p=document.createElement('p');while(cell.firstChild)p.appendChild(cell.firstChild);cell.appendChild(p);}});
      var styles = {
        p:'font-size:11pt;margin:0 0 6pt;line-height:150%;text-align:left;orphans:2;widows:2;',
        h1:'font-size:18pt;',h2:'font-size:15pt;',h3:'font-size:13pt;',h4:'font-size:12pt;',h5:'font-size:11pt;',h6:'font-size:11pt;',
        strong:'font-weight:bold;',b:'font-weight:bold;',em:'font-style:italic;',i:'font-style:italic;',
        blockquote:'border-left:2.25pt solid #d1d5db;padding-left:10.5pt;margin:9pt 0;color:#374151;',
        ul:'margin:0 0 6pt 22pt;padding:0;',ol:'margin:0 0 6pt 22pt;padding:0;',li:'font-size:11pt;line-height:150%;margin-top:0;margin-bottom:3pt;',
        table:'border-collapse:collapse;table-layout:fixed;width:100%;max-width:451.3pt;margin:9pt 0;font-size:9.5pt;',
        tr:'page-break-inside:avoid;',
        td:'border:0.75pt solid #d1d5db;padding:6pt 7.5pt;vertical-align:top;word-wrap:break-word;',
        th:'border:0.75pt solid #d1d5db;padding:6pt 7.5pt;vertical-align:top;background:#f3f4f6;font-weight:bold;',
        pre:'font-family:Consolas,monospace;font-size:9pt;line-height:135%;background:#f3f4f6;border:0.75pt solid #e5e7eb;padding:6pt 9pt;margin:0 0 6pt;white-space:pre-wrap;word-wrap:break-word;word-break:break-all;',
        code:'font-family:Consolas,monospace;font-size:9pt;white-space:pre-wrap;word-wrap:break-word;word-break:break-all;',
        a:'color:#1f2937;text-decoration:underline;',hr:'border:0;border-top:0.75pt solid #d1d5db;margin:16.5pt 0;',mark:'background:#fef08a;',img:'max-width:100%;height:auto;'
      };
      box.querySelectorAll('*').forEach(function(el){
        var tag=el.tagName.toLowerCase(), extra=styles[tag]||'';
        if (/^h[1-6]$/.test(tag)) extra+='font-family:Arial,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2937;font-weight:bold;margin:12pt 0 6pt;line-height:130%;page-break-after:avoid;';
        if(el.classList.contains('doc-title')) extra='font-size:18pt;font-weight:bold;line-height:130%;margin:0 0 9pt;page-break-after:avoid;';
        if(el.classList.contains('meta')) extra='font-size:9pt;color:#6b7280;line-height:135%;margin:0 0 12pt;padding-bottom:9pt;border-bottom:0.75pt solid #d1d5db;';
        if(el.classList.contains('who')) extra='font-size:10pt;color:#6b7280;font-weight:bold;line-height:135%;margin:12pt 0 4pt;page-break-after:avoid;';
        if(el.classList.contains('turn')) extra='page-break-inside:auto;';
        if(el.classList.contains('bubble')) extra='font-size:11pt;line-height:150%;color:#1f2937;';
        if(el.classList.contains('plain-source')) extra+='white-space:pre-wrap;';
        if(tag==='p'&&el.closest('th,td'))extra='margin:0;line-height:135%;font-size:9.5pt;page-break-inside:avoid;';
        // Long URLs / raw attachment metadata must wrap without changing copied text.
        if(/^(p|li|td|th)$/.test(tag)&&/[^\s\u3000-\u9fff]{60}/.test(el.textContent))extra+='word-wrap:break-word;word-break:break-all;';
        el.setAttribute('style',extra+(el.getAttribute('style')||''));
        if(!/^(pre|code)$/.test(tag))el.style.fontFamily='"PingFang SC", "Microsoft YaHei", Arial, sans-serif';
        if(tag==='table'){el.setAttribute('width','100%');el.setAttribute('cellspacing','0');el.setAttribute('cellpadding','8');el.setAttribute('border','1');}
        if(tag==='th')el.setAttribute('bgcolor','#f3f4f6');
        if(tag==='hr'){el.setAttribute('noshade','noshade');el.setAttribute('size','1');}
        // HTML whitespace is not portable to Word; preserve literal code/typed line breaks.
        if(tag==='pre'||el.classList.contains('plain-source')){
          var walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),nodes=[],n;
          while((n=walker.nextNode()))nodes.push(n);
          nodes.forEach(function(textNode){var span=document.createElement('span');span.innerHTML=escapeHTML(textNode.nodeValue).replace(/\t/g,'    ').replace(/ {2}/g,'&nbsp; ').replace(/\n/g,'<br>');textNode.replaceWith(span);});
        }
      });
      // A named Word section fixes the paper/text area in Word's print layout.
      // Keep legacy page-break and mso rules in CSS: CSSOM rewrites inline rules.
      var wordCSS='@page{size:595.3pt 841.9pt;margin:72pt}'+
        '@page WordSection1{size:595.3pt 841.9pt;margin:72pt;mso-header-margin:36pt;mso-footer-margin:36pt}'+
        'div.WordSection1{page:WordSection1}'+
        'body{margin:0;font-family:Arial,"PingFang SC","Microsoft YaHei",sans-serif;font-size:11pt;line-height:150%;color:#1f2937}'+
        'p,li{mso-pagination:widow-orphan;mso-line-height-rule:at-least}'+
        'h1,h2,h3,h4,h5,h6,.who{page-break-after:avoid;mso-keep-next:yes}'+
        'thead{display:table-header-group}tr{page-break-inside:avoid}'+
        'table{mso-table-layout-alt:fixed;mso-table-lspace:0pt;mso-table-rspace:0pt}';
      // A view preference for supporting Word importers, not a viewer-side guarantee.
      var wordSettings='<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->';
      return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>AI对话导出</title>'+wordSettings+'<style>'+wordCSS+'</style></head><body><div class="WordSection1">'+box.innerHTML+'</div></body></html>';
    }
    return {capture:capture,useMessages:useMessages,clear:function(){captured.clear();current=null;},freeze:freeze,conversation:conversation,page:page,word:word,css:css};
  }
  // Only used for a live ChatGPT message body. Never parse/execute component source.
  // Keep the existing document design; freeze the page's component layout and values.
  function capturePage(element,issues) {
    issues=issues||[];
    var svgTags=new Set('svg g a path rect circle ellipse line polyline polygon text tspan defs lineargradient radialgradient stop clippath title desc foreignobject mask filter fegaussianblur feoffset feblend fecolormatrix fecomponenttransfer fefuncr fefuncg fefuncb fefunca fecomposite femerge femergenode feflood fedropshadow marker pattern symbol use textpath switch'.split(' '));
    var svgAttrs=new Set('id viewBox width height x y x1 y1 x2 y2 cx cy r rx ry d points fill fill-rule fill-opacity clip-path clip-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset transform opacity offset stop-color stop-opacity text-anchor dominant-baseline font-size font-weight preserveAspectRatio gradientUnits gradientTransform clipPathUnits mask maskUnits maskContentUnits filter filterUnits primitiveUnits in in2 result type values stdDeviation dx dy mode operator k1 k2 k3 k4 flood-color flood-opacity color-interpolation-filters slope intercept amplitude exponent tableValues marker-start marker-mid marker-end markerUnits markerWidth markerHeight refX refY orient patternUnits patternContentUnits patternTransform startOffset lengthAdjust textLength'.split(' '));
    var layout=['display','flex-direction','flex-wrap','flex-grow','flex-shrink','flex-basis','align-items','justify-content','gap','row-gap','column-gap','padding','margin','border','border-radius','background-color','color','font-size','font-weight','line-height','text-align','white-space'];
    function image(node){
      try{var c=node;if(node.tagName.toLowerCase()==='img'){if(!node.complete||!node.naturalWidth)throw Error();c=document.createElement('canvas');c.width=node.naturalWidth;c.height=node.naturalHeight;c.getContext('2d').drawImage(node,0,0);}var img=document.createElement('img');img.src=c.toDataURL('image/png');img.alt=node.getAttribute('alt')||node.getAttribute('aria-label')||'图表';img.style.maxWidth='100%';return img;}catch(_){if(node.tagName.toLowerCase()==='canvas')throw Error('页面排版未就绪：画布图形无法读取，未将缺失图形当作完整导出。');return copyNode(node,true);}
    }
    function walk(node,inComponent,inSVG,foreignHTML){
      try{return renderNode(node,inComponent,inSVG,foreignHTML);}
      catch(error){
        // Keep a chart atomic: an invalid SVG child falls back at this SVG root,
        // while the rest of the message keeps its original formatting.
        if(inSVG)throw error;
        var plain=readableText(node),box=document.createElement('div');
        box.innerHTML=fallbackMarkup(plain);issues.push({type:String(node.localName||'element'),text:plain?'已保留文字和数值':'无可读取文字，需查看原对话'});
        return box.firstChild;
      }
    }
    function renderNode(node,inComponent,inSVG,foreignHTML){
      if(node.nodeType===3)return document.createTextNode(node.nodeValue);
      if(node.nodeType!==1)return document.createTextNode('');
      var tag=node.tagName.toLowerCase(),s=getComputedStyle(node);
      if(node.hidden||node.getAttribute('aria-hidden')==='true'||s.display==='none'||s.visibility==='hidden'||node.matches('script,style,link,meta,.sr-only,[data-conversation-role],[data-rich-export-control]'))return document.createTextNode('');
      if(/^(iframe|object|embed|video|audio)$/.test(tag))throw Error('嵌入内容改用文字保存');
      inComponent=inComponent||/^(box|row|grid|grid-item|slider|segmented-control|chart)$/.test(node.getAttribute('data-d-component')||'');
      if(tag==='pre'||tag==='code')return copyNode(node,true);
      if(tag==='canvas'||tag==='img')return image(node);
      if(node.getAttribute('data-d-component')==='slider'){
        var slider=node.querySelector('[role="slider"]');
        if(slider){var value=document.createElement('span');value.textContent='当前值：'+slider.getAttribute('aria-valuenow')+'（范围 '+slider.getAttribute('aria-valuemin')+'–'+slider.getAttribute('aria-valuemax')+'）';return value;}
      }
      if(tag==='svg'||inSVG){
        if(!svgTags.has(tag))throw Error('页面排版未就绪：SVG 含暂不支持的 '+tag+' 元素，未将缺失图形当作完整导出。');
        var context=inSVG||{prefix:'export-svg-'+Math.random().toString(36).slice(2)+'-',ids:new Set(Array.from(node.querySelectorAll('[id]')).map(x=>x.id))};
        function svgValue(value){var match=String(value).match(/^url\(["']?#([^\s)"']+)["']?\)$/);if(match){if(!context.ids.has(match[1]))throw Error('页面排版未就绪：SVG 引用的图形不在当前消息中。');return 'url(#'+context.prefix+match[1]+')';}if(/url\(|javascript:|data:|https?:/i.test(value))throw Error('页面排版未就绪：SVG 包含外部资源引用。');return value;}
        var v=document.createElementNS('http://www.w3.org/2000/svg',tag==='a'?'g':node.tagName);
        Array.from(node.attributes).forEach(a=>{if(svgAttrs.has(a.name))v.setAttribute(a.name,a.name==='id'?context.prefix+a.value:svgValue(a.value));});
        ['fill','stroke','color','font-size','font-family','font-weight','font-style','text-anchor','dominant-baseline','opacity','filter','clip-path','mask','stroke-width','stroke-dasharray','stroke-linecap','stroke-linejoin','stop-color','stop-opacity','flood-color','flood-opacity'].forEach(p=>{var value=s.getPropertyValue(p);if(value)v.style.setProperty(p,svgValue(value));});
        if(tag==='use'||tag==='textpath'){
          var ref=node.getAttribute('href')||node.getAttributeNS('http://www.w3.org/1999/xlink','href')||'';
          if(/^#[^\s]+$/.test(ref)&&context.ids.has(ref.slice(1)))v.setAttribute('href','#'+context.prefix+ref.slice(1));
          else throw Error('页面排版未就绪：SVG 引用的图形不在当前消息中。');
        }
        if(tag==='svg'){v.style.maxWidth='100%';v.setAttribute('xmlns','http://www.w3.org/2000/svg');}
        if(tag==='foreignobject'){
          // foreignObject is SVG; its children are ordinary (X)HTML. Passing the
          // SVG context into those children rejects valid div/span/p elements.
          ['x','y','width','height'].forEach(p=>{var value=s.getPropertyValue(p);if(value&&value!=='auto'&&!/url\(|expression|javascript/i.test(value))v.style.setProperty(p,value);});
          Array.from(node.childNodes).forEach(c=>{var child=walk(c,true,false,true);if(child.nodeType===1)child.setAttribute('xmlns','http://www.w3.org/1999/xhtml');v.appendChild(child);});
        }else Array.from(node.childNodes).forEach(c=>v.appendChild(walk(c,inComponent,context,false)));
        return v;
      }
      if(tag==='input'||tag==='select'||tag==='textarea'){
        var value=tag==='select'?Array.from(node.selectedOptions).map(x=>x.textContent).join('、'):node.type==='checkbox'?(node.checked?'☑':'☐'):node.value;
        var control=document.createElement('span');control.textContent=value;control.setAttribute('title','导出时的控件值');control.style.fontWeight='600';return control;
      }
      if((tag==='button'||node.getAttribute('role')==='button')&&!inComponent)return document.createTextNode('');
      var out=document.createElement(tags.has(tag)?tag:(tag==='button'?'span':'div'));
      if(node.getAttribute('role')==='radio'){out.appendChild(document.createTextNode(node.getAttribute('aria-checked')==='true'?'● ':'○ '));out.style.fontWeight=node.getAttribute('aria-checked')==='true'?'700':'400';}
      if(tag==='a'){var href=safeURL(node.getAttribute('href'),node.baseURI);if(href)out.setAttribute('href',href);}
      ['colspan','rowspan','start'].forEach(k=>{var n=node.getAttribute(k);if(/^\d{1,5}$/.test(n||''))out.setAttribute(k,n);});
      if(node.hasAttribute('data-d-default-strong'))out.style.fontWeight='700';
      if(inComponent){
        layout.forEach(p=>{var value=s.getPropertyValue(p);if(p==='color'&&!node.style.color)return;if(value&&!/url\(|expression|javascript/i.test(value))out.style.setProperty(p,value);});
        if(/var\(--color-text/.test(node.style.color))out.style.color=/secondary|tertiary/.test(node.style.color)?'#6b7280':'#1f2937';
        if(/var\(--color-surface/.test(node.style.backgroundColor))out.style.backgroundColor='#f3f4f6';
        if(s.display==='grid'){var cols=s.gridTemplateColumns.split(/\s+/).length;out.style.gridTemplateColumns='repeat('+Math.min(6,cols)+',minmax(0,1fr))';}
        if(node.style.width)out.style.width=node.style.width;
        if(node.style.height)out.style.height=node.style.height;
        out.style.maxWidth='100%';out.style.minWidth='0';
      }else if(/^(pre-wrap|pre-line)$/.test(s.whiteSpace))out.style.whiteSpace=s.whiteSpace;
      if(foreignHTML){
        ['position','left','top','right','bottom','width','height','min-width','min-height','max-width','max-height','box-sizing','overflow','transform','transform-origin','opacity','filter','background-image','font-family','font-size','font-weight','font-style','color','line-height','letter-spacing','white-space','word-break','overflow-wrap','text-decoration-line'].forEach(p=>{var value=s.getPropertyValue(p);if(value&&!/url\(|expression|javascript/i.test(value))out.style.setProperty(p,value);});
      }
      Array.from(node.childNodes).forEach(c=>out.appendChild(walk(c,inComponent,false,foreignHTML)));return out;
    }
    var box=document.createElement('div');box.appendChild(walk(element,false,false));return box.innerHTML;
  }
  root.AIExportRich = {version:VERSION,create:create,capturePage:capturePage,readableText:readableText,fallbackMarkup:fallbackMarkup};
})(globalThis);

/* Gemini editable HTML only; original popup and PDF/Word remain unchanged. */
(() => {
  if (location.hostname !== "gemini.google.com") return;
  function htmlFactory(api) {
    if (!api || typeof api.create !== 'function') return api;
    const create = api.create;
    api.create = function (...args) {
      const original = create.apply(this, args), html = create.apply(this, args);
      const fixes = new WeakMap();
      const capture = original.capture, use = original.useMessages;
      const conversation = original.conversation, clear = original.clear;
      function eligible(element) {
        if (!element || element.nodeType !== 1) return false;
        if (element.querySelector('source-footnote,sources-carousel-inline,source-inline-chip')) return true;
        return [...element.querySelectorAll('button,[role="button"]')].some(n =>
          n.closest('follow-up,sources-carousel-inline,source-inline-chip') ||
          (element.localName === 'user-query' && n.querySelector('img,audio,video')));
      }
      function staticClone(element) {
        const clone = element.cloneNode(true);
        const from = [element, ...element.querySelectorAll('*')];
        const to = [clone, ...clone.querySelectorAll('*')];
        from.forEach((node, i) => {
          const dest = to[i];
          if (!dest.style) return;
          let s; try { s = getComputedStyle(node); } catch (_) { return; }
          for (const prop of ['display', 'visibility', 'font-weight', 'font-style', 'text-decoration-line', 'text-align', 'white-space']) {
            const value = s.getPropertyValue(prop); if (value) dest.style.setProperty(prop, value);
          }
          if (node.localName === 'input') dest.checked = node.checked;
        });
        from.forEach((node, i) => {
          if (!node.matches('button,[role="button"]')) return;
          const media = element.localName === 'user-query' && node.querySelector('img,audio,video');
          const choice = node.closest('follow-up,sources-carousel-inline,source-inline-chip');
          if (!media && !choice) return;
          const dest = to[i], replacement = document.createElement('span');
          replacement.style.cssText = dest.style.cssText;
          if (node.hidden || node.getAttribute('aria-hidden') === 'true') replacement.hidden = true;
          while (dest.firstChild) replacement.appendChild(dest.firstChild);
          dest.replaceWith(replacement);
        });
        // Omit citation controls by their semantic source elements. Content
        // with the same filename outside these controls is not touched.
        from.forEach((node, i) => {
          if (node.matches('source-footnote,sources-carousel-inline,source-inline-chip')) to[i].remove();
        });
        // Citation components are inline in Gemini. Serializing them as divs
        // closes the surrounding p when the saved HTML is parsed again.
        from.forEach((node, i) => {
          const dest = to[i];
          if (!dest.parentNode) return;
          const citation = node.closest('source-footnote,sources-carousel-inline,source-inline-chip');
          const footnoteHost = node.localName === 'response-element' && node.querySelector('source-footnote');
          if (!footnoteHost && !(citation && (node.localName.includes('-') || node.localName === 'div'))) return;
          const inline = document.createElement('span');
          inline.style.cssText = dest.style.cssText;
          if (node.hidden || node.getAttribute('aria-hidden') === 'true') inline.hidden = true;
          while (dest.firstChild) inline.appendChild(dest.firstChild);
          dest.replaceWith(inline);
        });
        return clone;
      }
      original.capture = function (role, content, element) {
        const value = capture.call(original, role, content, element);
        if (eligible(element)) {
          try { fixes.set(element, html.capture(role, content, staticClone(element))); }
          catch (_) { fixes.set(element, api.fallbackMarkup(content)); }
        }
        return value;
      };
      original.useMessages = function (messages, header, options) {
        use.call(original, messages, header, options);
        html.useMessages(messages.map(m => {
          const fixed = m.element && fixes.get(m.element);
          return fixed ? {...m, richHTML: fixed} : m;
        }), header, options);
      };
      original.conversation = function (plain, editable) {
        return editable ? html.conversation(plain, true) : conversation.call(original, plain, editable);
      };
      original.clear = function () { clear.call(original); html.clear(); };
      return original;
    };
    return api;
  }
  globalThis.AIExportRich = htmlFactory(globalThis.AIExportRich);
})();
