// Original block and inline renderer. All document state belongs to one parse call.
const entities = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
const punctuation = /[\p{P}\p{S}]/u;
const whitespace = /\s/u;
const blockTags = new Set('address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem meta nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul'.split(' '));
function escape(s, all=false) { if(!/[&<>"']/.test(s))return s;if(!all&&s.includes('&#'))s=s.replace(/&#(?:(\d{1,7})|[xX]([a-fA-F0-9]{1,6}));/g,(_,d,h)=>{const n=parseInt(d||h,d?10:16);return n===0||n>0x10ffff||(n>=0xd800&&n<=0xdfff)?'�':String.fromCodePoint(n);});return s.replace(all ? /[&<>"']/g : /[<>"']|&(?!(?:#\d{1,7}|#[xX][a-fA-F0-9]{1,6}|\w+);)/g, c=>entities[c]); }
function unescape(s) { return s.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g,'$1'); }
function key(s) { return s.trim().replace(/\s+/g,' ').toLowerCase().toUpperCase().toLowerCase(); }
function url(s) { try { return encodeURI(s).replace(/%25/g,'%'); } catch { return null; } }
function tabs(s, start=0) { if(!s.includes('\t'))return s;let out=''; for(const c of s){ if(c==='\t'){const n=4-start%4;out+=' '.repeat(n);start+=n;}else{out+=c;start++;} } return out; }
function cells(s) { s=s.trim();if(s[0]==='|')s=s.slice(1);if(s.endsWith('|')&&!s.endsWith('\\|'))s=s.slice(0,-1);const result=[];let cell='';for(let i=0;i<s.length;i++){if(s[i]==='|' ){let n=0;for(let k=i-1;k>=0&&s[k]==='\\';k--)n++;if(n%2){cell=cell.slice(0,-1)+'|';continue;}result.push(cell.trim());cell='';}else cell+=s[i];}result.push(cell.trim());return result; }
const bullet = /^ {0,3}([*+-]|\d{1,9}[.)])(?:([ \t]+)(.*)|$)/;
const hr = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/;
function htmlStart(line, interrupt=false) {
 const m=/^ {0,3}<(?:(script|pre|style|textarea)(?:\s|>|$)|(!--)|(\?)|(!\[CDATA\[)|(![A-Z])|\/?([a-z][\w-]*)(?:\s|\/?>|$))/i.exec(line);
 if(!m)return null;
 if(m[1])return {end:new RegExp('</'+m[1]+'>','i')};
 if(m[2])return {end:/-->/};if(m[3])return {end:/\?>/};if(m[4])return {end:/\]\]>/};if(m[5])return {end:/>/};
 if(blockTags.has(m[6]?.toLowerCase()))return {blank:true};
 if(!interrupt && /^ {0,3}(?:<\/[a-z][\w-]*\s*>|<[a-z][\w-]*(?:\s+[a-zA-Z_:][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>)\s*$/i.test(line))return {blank:true};
 return null;
}
function tableAt(lines,i) { if(i+1>=lines.length||!lines[i].trim())return null;const d=lines[i+1].trim();if(!/[:|]/.test(d)||!/^[ |:\-]+$/.test(d))return null;const a=cells(d);if(!a.every(x=>/^:?-+:?$/.test(x)))return null;const h=cells(lines[i]);return h.length===a.length?{h,a:a.map(x=>x.endsWith(':')?(x.startsWith(':')?'center':'right'):x.startsWith(':')?'left':null)}:null; }
function interrupt(lines,i) { const l=lines[i]??'';const b=bullet.exec(l);return !l.trim()||hr.test(l)||/^ {0,3}#{1,6}(?:\s|$)/.test(l)||/^ {0,3}>/.test(l)||(fence.test(l)&&!(fence.exec(l)[1][0]==='`'&&fence.exec(l)[2].includes('`')))||!!htmlStart(l,true)||!!(b&&(!/\d/.test(b[1])||/^1[.)]$/.test(b[1]))&&b[3])||!!tableAt(lines,i); }
function readDefinition(lines,i) {
 if(!/^ {0,3}\[/.test(lines[i]))return null;
 let closed=false;for(let j=i;j<lines.length&&!closed;j++){if(j>i&&!lines[j].trim())return null;const line=lines[j];for(let k=j===i?line.indexOf('[')+1:0;k<line.length;k++){if(line[k]==='\\'){k++;continue;}if(line[k]==='[')return null;if(line[k]===']'){if(line[k+1]!==':')return null;closed=true;break;}}}if(!closed)return null;const source=lines.slice(i).join('\n');
 const m=/^ {0,3}\[((?:\\.|[^\[\]\\]|\n(?![ \t]*\n))+)\]:[ \t]*(?:\n[ \t]*)?(<[^<>\n]*>|[^<\s][^\s]*)(.*)/.exec(source);
 if(!m||!key(m[1]))return null;
 let href=m[2];if(href[0]==='<')href=href.slice(1,-1);else {let n=0;for(let k=0;k<href.length;k++){if(href[k]==='\\'){k++;continue;}if(href[k]==='(')n++;if(href[k]===')')n--;if(n<0)return null;}if(n)return null;}
 let consumed=m[0].length-m[3].length;let rest=source.slice(consumed),title='';
 const t=/^(?:[ \t]+|[ \t]*\n[ \t]*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^()\\])*\))[ \t]*(?=\n|$)/.exec(rest);
 if(t){title=t[1].slice(1,-1);if(/\n[ \t]*\n/.test(title))return null;consumed+=t[0].length;rest=source.slice(consumed);}
 else {const spaces=/^[ \t]*/.exec(rest)[0];consumed+=spaces.length;rest=rest.slice(spaces.length);}
 if(rest&&rest[0]!=='\n')return null;
 return {key:key(m[1]),href:unescape(href),title:unescape(title),end:i+source.slice(0,consumed).split('\n').length};
}
function blocks(src, refs, top=true) {
 const lines=src.split('\n');const out=[];let i=0;
 while(i<lines.length){let l=lines[i],m;
 if(!l.trim()){let n=i;while(i<lines.length&&!lines[i].trim())i++;out.push({type:'space',n:i-n});continue;}
 if((m=fence.exec(l))&&!(m[1][0]==='`'&&m[2].includes('`'))){const mark=m[1][0],len=m[1].length,indent=mark==='`'?l.search(/\S/):0;const closing=new RegExp('^ {0,3}'+mark+'{'+len+',} *$');let body=[];i++;while(i<lines.length&&!closing.test(lines[i])){let s=lines[i];let lead=s.match(/^\s*/)[0].length;body.push(s.slice(Math.min(lead,indent)));i++;}if(i<lines.length)i++;else if(body.at(-1)==='')body.pop();out.push({type:'code',text:body.join('\n'),lang:unescape(m[2].trim()).split(/\s/)[0]});continue;}
 if(/^(?: {4}| {0,3}\t)/.test(l)){let body=[];while(i<lines.length){if(/^(?: {4}| {0,3}\t)/.test(lines[i]))body.push(lines[i++].replace(/^(?: {0,3}\t| {4})/,''));else if(!lines[i].trim())body.push(lines[i++].replace(/^ +$/,''));else break;}while(body.at(-1)==='')body.pop();const prior=out.at(-1);if(prior?.type==='text'||prior?.type==='paragraph')prior.text+='\n'+body.join('\n');else out.push({type:'code',text:body.join('\n'),lang:''});continue;}
 if((m=/^ {0,3}(#{1,6})(?=\s|$)(.*)$/.exec(l))){let s=m[2].trim().replace(/(?:^|[ \t]+)#+$/,'').trim();out.push({type:'heading',level:m[1].length,text:s});i++;continue;}
 if(hr.test(l)){out.push({type:'hr'});i++;continue;}
 if(/^ {0,3}>/.test(l)){
 let body=[],lazy=[],lazyAllowed=null;while(i<lines.length){
 if(/^ {0,3}>/.test(lines[i])){let line=lines[i++].replace(/^( {0,3}>)([ \t]+)/,(_,mark,space)=>mark+tabs(space,mark.length));body.push(line.replace(/^ {0,3}> ?/,''));lazyAllowed=null;continue;}
 if(!lines[i].trim()||!body.at(-1)?.trim())break;
 if(lazyAllowed===null){const parsed=blocks(body.join('\n'),new Map(refs),true);let last=parsed.filter(n=>n.type!=='space').at(-1);while(last?.type==='quote')last=last.children.filter(n=>n.type!=='space').at(-1);lazyAllowed=last&&['paragraph','text','list'].includes(last.type);}if(!lazyAllowed||interrupt(lines,i))break;
 const isSetext=/^ {0,3}(=+|-+)[ \t]*$/.test(lines[i]);if(!isSetext)lazy.push(lines[i]);body.push(isSetext?'    '+lines[i].trim():lines[i]);i++;
 }
 const children=blocks(body.join('\n'),refs,true);for(const n of children)if(n.type==='paragraph')for(const line of lazy)if(/^ {4}|^ {0,3}\t/.test(line))n.text=n.text.replace(line,line.replace(/^(?: {4}| {0,3}\t)/,''));out.push({type:'quote',children});continue;
 }
 if((m=bullet.exec(l))){const ordered=/\d/.test(m[1]),marker=ordered?m[1].at(-1):m[1],items=[];let loose=false;
 while(i<lines.length){const b=bullet.exec(lines[i]);if(!b||hr.test(lines[i])||(ordered?(!/\d/.test(b[1])||b[1].at(-1)!==marker):b[1]!==marker))break;
 const prefix=lines[i].indexOf(b[1])+b[1].length;let lead=tabs(b[2]||'',prefix).length;if(lead>4)lead=1;if(!(b[3]||'').trim())lead=1;const indent=prefix+(lead||1);let first=(b[2]||'')+(b[3]||'');first=first.replace(/^[ \t]+/,space=>tabs(space,prefix)).slice(lead);let body=[first],blank=false;i++;if(!first.trim()&&!lines[i]?.trim()){if(i<lines.length){i++;loose=true;}items.push({children:[],task:false,checked:false});continue;}
 while(i<lines.length){let s=lines[i];if(s.includes('\t'))s=s.replace(/^[ \t]+/,space=>tabs(space));const spaces=s.search(/\S/);if(s.trim()===''){body.push('');blank=true;i++;continue;}
 const next=bullet.exec(s);if(spaces<indent&&(next||hr.test(s)||/^ {0,3}(?:#{1,6}(?:\s|$)|>|`{3,}|~{3,})/.test(s)||htmlStart(s,true)))break;
 if(spaces>=indent){body.push(s.slice(indent));i++;blank=false;continue;}
 if(blank||!body.at(-1)?.trim()||interrupt(lines,i)||fence.test(body.at(-1))||/^(?: {4}| {0,3}\t)/.test(body[0]))break;
 body.push(s);i++;
 }
 let trailing=0;for(let k=body.length-1;k>0&&body[k]==='';k--)trailing++;const following=bullet.exec(lines[i]||'');const same=following&&(ordered?(/\d/.test(following[1])&&following[1].at(-1)===marker):following[1]===marker);if(trailing&&same&&body.some(x=>x.trim()))loose=true;else if(trailing&&!same)i-=trailing;
 while(body.at(-1)==='')body.pop();while(body[0]===''||body[0]?.trim()==='')body.shift();
 let task=/^\[[ xX]\][ \t]+\S/.test(body[0]||'');let checked=task&&body[0][1]!==' ';if(task)body[0]=body[0].replace(/^\[[ xX]\][ \t]+/,'');
 const children=body.length?blocks(body.join('\n'),refs,false):[];if(children.some(x=>x.type==='space'&&x.n>0)&&children.some(x=>x.type!=='space'))loose=true;items.push({children,task,checked});
 }
 out.push({type:'list',ordered,start:ordered?parseInt(m[1]):1,items,loose});continue;
 }
 const html=htmlStart(l);if(html){let body=[];while(i<lines.length){if(html.blank&&!lines[i].trim())break;let s=lines[i++];body.push(s);if(html.end?.test(s))break;}out.push({type:'html',text:body.join('\n')+(i<lines.length&&(lines[i].trim()||i===lines.length-1||html.end&&lines[i]!=='')?'\n':'')});continue;}
 const definition=readDefinition(lines,i);if(definition){if(!refs.has(definition.key))refs.set(definition.key,definition);i=definition.end;continue;}
 const table=tableAt(lines,i);if(table){i+=2;const rows=[];while(i<lines.length&&!/^ *$/.test(lines[i])&&(!interrupt(lines,i)||/^[ \t]*\t[ \t]*$/.test(lines[i]))){rows.push(cells(lines[i++]));}out.push({type:'table',...table,rows});continue;}
 if(!top&&out.at(-1)?.type!=='text'){let end=i+1;while(end<lines.length&&!interrupt(lines,end)&&!bullet.test(lines[end])&&!/^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[end]))end++;if(/^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[end]||'')){out.push({type:'heading',level:lines[end].trim()[0]==='='?1:2,text:lines.slice(i,end).join('\n').trim()});i=end+1;continue;}}let body=[l];i++;
 while(top&&i<lines.length){if(/^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[i])){out.push({type:'heading',level:lines[i].trim()[0]==='='?1:2,text:body.join('\n').trim()});i++;body=null;break;}if(interrupt(lines,i)||(!top&&bullet.test(lines[i]))) {if(i===lines.length-1&&/^[ \t]+$/.test(lines[i]))body.push(lines[i++]);break;}body.push(lines[i++]);}
 if(body){const prior=out.at(-1);if(!top&&prior?.type==='text')prior.text+='\n'+body.join('\n');else out.push({type:top?'paragraph':'text',text:body.join('\n')});}
 }
 return out;
}
function backpedal(s){let i=0,last=0;while(i<s.length){const c=s[i];if(c==='('){const end=s.indexOf(')',i+1);if(end<0)break;i=end+1;last=i;continue;}if(c==='&'&&/^&[A-Za-z0-9]+;$/.test(s.slice(i)))break;if("?!.,:;*_'\"~)".includes(c)){i++;continue;}i++;last=i;}return s.slice(0,last);}
function emphasisEnd(text,start,count,ch,refs){
 let origin=start;while(origin>0&&text[origin-1]===ch)origin--;const before=origin?text[origin-1]:'\n',after=text[start+count]||'\n';
 const bp=punctuation.test(before),ap=punctuation.test(after),bs=whitespace.test(before),as=whitespace.test(after);
 if(as||ap&&!(bs||bp)||ch==='_'&&!bs&&!bp)return null;
 let balance=count,extra=0;
 for(let j=start+count;j<text.length;){
 if(text[j]==='\\'){j+=2;continue;}
 if(text[j]==='`'){const run=/^`+/.exec(text.slice(j))[0];let k=j+run.length,end=-1;while((k=text.indexOf(run,k))>=0){if(text[k-1]!=='`'&&text[k+run.length]!=='`'){end=k+run.length;break;}k+=run.length;}if(end>=0){j=end;continue;}j+=run.length;continue;}
 if(text[j]==='<'){const end=text.indexOf('>',j+1);if(end>=0){j=end+1;continue;}}
 if(text[j]==='['){let n=1,k=j+1;for(;k<text.length;k++){if(text[k]==='\\'){k++;continue;}if(text[k]==='[')n++;if(text[k]===']'&&!--n)break;}if(n===0){let end=k+1;const dest=/^\((?:\\.|[^()\\]|\((?:\\.|[^()\\])*\))*\)/.exec(text.slice(end));if(dest){j=end+dest[0].length;continue;}const ref=/^\[([^\]]*)\]/.exec(text.slice(end));if(ref&&refs.has(key(ref[1]||text.slice(j+1,k)))){j=end+ref[0].length;continue;}if(refs.has(key(text.slice(j+1,k)))){j=end;continue;}}}
 if((text[j]==='_'&&ch==='*'||text[j]==='*'&&ch==='_')){const other=text[j];let n=1;while(text[j+n]===other)n++;const match=n>=2?emphasisEnd(text,j,n,other,refs):null;if(match){j=match.end;continue;}}
 if(text[j]!==ch){j++;continue;}
 let n=1;while(text[j+n]===ch)n++;const p=text[j-1]||'\n',q=text[j+n]||'\n';const pp=punctuation.test(p),qp=punctuation.test(q),ps=whitespace.test(p),qs=whitespace.test(q);
 let open=!qs&&(!qp||ps||pp),close=!ps&&(!pp||qs||qp);if(ch==='_'){const left=open;open=open&&(!close||pp);close=close&&(!left||qp);}
 if(open&&!close){balance+=n;j+=n;continue;}
 if(close){if((open||(!bs&&!bp))&&count%3&&(count+n)%3===0){extra+=n;j+=n;continue;}balance-=n;if(balance<=0){const used=Math.min(n,n+balance+extra);const width=Math.min(count,used)%2?1:2;return {end:j+used,width};}}
 j+=n;
 }
 return null;
}
// Inline masking patterns informed by Marked's MIT-licensed masking helper.
// Copyright (c) 2018-2026 MarkedJS; (c) 2011-2018 Christopher Jeffrey.
// These small compatibility expressions share the permission notice in LICENSE.
const protectEscapesAndCode = /(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\([\p{P}\p{S}])/gu;
const simpleCode = /^(`+)[^`]+\1(?!`)/;
function maskInline(text,refs){
 let source=text.replace(protectEscapesAndCode,(span,ticks,escaped)=>escaped?'+'.repeat(span.length):ticks?ticks+span.slice(ticks.length,-ticks.length).replace(/`/g,'+')+ticks:span);
 // Reference masks precede code masks, and protect only resolved references.
 source=source.replace(/!?\[((?:\\.|[^\[\]])+)\](?:\[([^\[\]]*)\])?/g,(span,label,reference)=>refs.has(key(reference||label))?'['+'a'.repeat(span.length-2)+']':span);
 const spans=[];
 for(let i=0;i<source.length;i++){
 if(source[i]==='['){let j=i+1,validLabel=true;for(;j<source.length;j++){if(source[j]==='\\'){j++;continue;}if(source[j]==='['){validLabel=false;break;}if(source[j]==='`'){let n=1;while(source[j+n]==='`')n++;let end=source.indexOf('`',j+n);if(end<0){validLabel=false;break;}let m=1;while(source[end+m]==='`')m++;if(m!==n){validLabel=false;break;}j=end+m-1;continue;}if(source[j]===']')break;}
 if(validLabel&&source[j]===']'&&source[j+1]==='('){let k=j+2,n=1;for(;k<source.length;k++){if(source[k]==='\\'){k++;continue;}if(source[k]==='(')n++;if(source[k]===')'&&!--n)break;}if(!n){spans.push([i,k+1]);i=k;continue;}}}
 if(source[i]==='`'&&source[i-1]!=='`'){const match=simpleCode.exec(source.slice(i));if(match){spans.push([i,i+match[0].length]);i+=match[0].length-1;continue;}}
 if(source[i]==='<'&&source[i+1]!==' '){const end=source.indexOf('>',i+1);if(end>=0&&!source.slice(i+1,end).includes('<')){spans.push([i,end+1]);i=end;}}
 }
 if(!spans.length)return source;let result='',start=0;for(const [a,b]of spans){result+=source.slice(start,a)+'['+'a'.repeat(b-a-2)+']';start=b;}return result+source.slice(start);
}
function inline(text,refs,inLink=false,rawState={raw:false}) {
 const parts=[];const masked=/[*_~]/.test(text)?maskInline(text,refs):text;let i=0;
 const add=s=>parts.push(s);
 while(i<text.length){let c=text[i],m;const tail=text.slice(i);
 if(c==='\\'&&(m=/^\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/.exec(tail))){add(escape(m[1]));i+=2;continue;}
 if((c===' '||c==='\\')&&(m=/^(?: {2,}|\\)\n(?!\s*$)[ \t]*/.exec(tail))){add('<br>');i+=m[0].length;continue;}
 if(c==='`'){let n=1;while(text[i+n]==='`')n++;let end=i+n;let found=-1;while((end=text.indexOf('`'.repeat(n),end))!==-1){if(text[end-1]!=='`'&&text[end+n]!=='`'){found=end;break;}while(text[end]==='`')end++;}if(found!==-1){let s=text.slice(i+n,found).replace(/\n/g,' ');if(s.startsWith(' ')&&s.endsWith(' ')&&/[^ ]/.test(s))s=s.slice(1,-1);add('<code>'+escape(s,true)+'</code>');i=found+n;continue;}add('`'.repeat(n));i+=n;continue;}
 if(c==='<'&&(m=/^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s\x00-\x1f<>]*|[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*)>/.exec(tail))){const s=m[1];add('<a href="'+escape(url((s.includes('@')&&!/^[\w+.-]+:/.test(s)?'mailto:':'')+s))+'">'+escape(s)+'</a>');i+=m[0].length;continue;}
 if(c==='<'&&(m=/^(?:<!--(?:-?>|[\s\S]*?(?:-->|$))|<\?[\s\S]*?\?>|<![A-Z][\s\S]*?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/[a-zA-Z][\w-]*\s*>|<[a-zA-Z][\w-]*(?:\s+[a-zA-Z_:][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>)/.exec(tail))){const tag=m[0];add(tag);if(/^<a /i.test(tag))refs.inLink=true;if(/^<\/a>/i.test(tag))refs.inLink=false;if(/^<(pre|code|kbd|script)(?:\s|>)/i.test(tag))rawState.raw=true;if(/^<\/(pre|code|kbd|script)(?:\s|>)/i.test(tag))rawState.raw=false;i+=tag.length;continue;}
 if(c==='['||(c==='!'&&text[i+1]==='[')){
 const image=c==='!',open=i+(image?1:0);let depth=1,end=open+1;
 for(;end<text.length;end++){if(text[end]==='\\'){end++;continue;}if(text[end]==='`'){let k=end;while(text[k]==='`')k++;if(k-end>=2&&text[k]===']'){end=k-1;continue;}let stop=text.indexOf('`',k);if(stop<0){if(k-end>=2&&text[k]===']'){end=k-1;continue;}depth=-1;break;}while(text[stop]==='`')stop++;end=stop-1;continue;}if(text[end]==='<'){const tag=/^(?:<[^<>]*>|<!--(?:-?>|[\s\S]*?-->))/.exec(text.slice(end));if(tag){end+=tag[0].length-1;continue;}}if(text[end]==='[')depth++;if(text[end]===']'&&!--depth)break;}
 if(depth===0){const label=text.slice(open+1,end);let after=end+1,link=null;
 if(text[after]==='('){let p=after+1;while(/\s/.test(text[p]||'')&&p<text.length)p++;let href='',valid=true;
 if(text[p]==='<'){let close=text.indexOf('>',p+1);if(close<0||(text.slice(p+1,close).includes('\n')||text[close-1]==='\\'))valid=false;else{href=text.slice(p+1,close);p=close+1;}}
 else {let n=0,start=p;for(;p<text.length;p++){if(text[p]==='\\'){p++;continue;}if(text[p]==='(')n++;else if(text[p]===')'){if(n===0)break;n--;}if(/[ \t\n]/.test(text[p]))break;}href=text.slice(start,p);if(n)valid=false;}
 const before=p;while(p<text.length&&/\s/.test(text[p]))p++;let title='';if(p>before&&/^["'(]$/.test(text[p]||'')){const q=text[p]==='('?')':text[p];let start=++p;while(p<text.length){if(text[p]==='\\'){p+=2;continue;}if(text[p]===q)break;p++;}title=text.slice(start,p);if(p===text.length)valid=false;else p++;while(p<text.length&&/\s/.test(text[p]))p++;}
 if(text[p]===')'&&valid){link={href:unescape(href),title:unescape(title)};after=p+1;}
 }else {let ref=label;if(text[after]==='['){const close=text.indexOf(']',after+1);if(close>=0){ref=text.slice(after+1,close)||label;after=close+1;}}link=refs.get(key(ref));}
 if(!link&&text[end+1]!=='[')link=refs.get(key(label));if(link&&!(!image&&label.includes('[')&&inline(label,refs,true).includes('<a '))){const href=url(link.href);if(href!==null){let title=link.title?' title="'+escape(link.title)+'"':'';if(image){const alt=inline(label,refs,false).replace(/<img [^>]*alt="([^"]*)"[^>]*>/g,'$1').replace(/<[^>]*>/g,'');add('<img src="'+escape(href)+'" alt="'+alt+'"'+title+'>');}else add('<a href="'+escape(href)+'"'+title+'>'+inline(label,refs,true)+'</a>');i=after;continue;}}
 }
 }
 if(!inLink&&!refs.inLink&&(m=/^(?:(?:[hH][tT][tT][pP][sS]?|[fF][tT][pP]):\/\/|www\.)(?:[^\s<]+)|^(?:(?:mailto|xmpp):)?[A-Za-z0-9._+-]+@[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*[A-Za-z0-9])+(?![\w-])(?:\/[A-Za-z0-9@.]+)?/.exec(tail))){let s=m[0];const email=!/^(?:https?|ftp):\/\/|^www\./i.test(s);if(email&&/[-_]$/.test(s)){add(escape(s));i+=s.length;continue;}if(!email)s=backpedal(s);const href=s.startsWith('www.')?'http://'+s:(!s.includes('://')&&!/^(?:mailto|xmpp):/.test(s)?'mailto:':'')+s;add('<a href="'+escape(url(href))+'">'+escape(s)+'</a>');i+=s.length;continue;}
 if((c==='*'||c==='_')&&!rawState.raw){let count=1;while(text[i+count]===c)count++;const found=emphasisEnd(masked,i,count,c,refs);if(found){const tag=found.width===2?'strong':'em';add('<'+tag+'>'+inline(text.slice(i+found.width,found.end-found.width),refs,inLink,rawState)+'</'+tag+'>');i=found.end;continue;}add(c);i++;continue;}
 if(c==='~'&&!rawState.raw){let count=1;while(text[i+count]===c)count++;let balance=count,found=-1;if(count<=2&&!whitespace.test(text[i+count]||' ')&&(!punctuation.test(text[i+count])||!i||/[\s\p{P}\p{S}]/u.test(text[i-1]))){for(let j=i+count;j<text.length;j++){if(masked[j]!==c)continue;let n=1;while(masked[j+n]===c)n++;if(n!==count){j+=n-1;continue;}const p=text[j-1],q=text[j+n]||' ';const open=!whitespace.test(q)&&(!punctuation.test(q)||/[\s\p{P}\p{S}]/u.test(p)),close=!whitespace.test(p)&&(!punctuation.test(p)||/[\s\p{P}\p{S}]/u.test(q));if(open&&!close)balance+=n;else if(close)balance-=n;if(balance===0){found=j;break;}j+=n-1;}}if(found>=0){add('<del>'+inline(text.slice(i+count,found),refs,inLink,rawState)+'</del>');i=found+count;continue;}add(c.repeat(count));i+=count;continue;}
 const offset=text.slice(i+1).search(/[\\`<!\[*_~]| {2,}\n|[hH][tT][tT][pP][sS]?:\/\/|[fF][tT][pP]:\/\/|www\.|(?:mailto|xmpp):|[A-Za-z0-9._+-]+@/);let end=offset<0?text.length:i+1+offset;
 add(rawState.raw?text.slice(i,end):escape(text.slice(i,end)));i=end;
 }
 return parts.join('');
}
function render(nodes,refs,tight=false){let out='';for(const n of nodes){switch(n.type){case 'space':break;case 'html':out+=n.text;break;case 'code':out+='<pre><code'+(n.lang?' class="language-'+escape(n.lang)+'"':'')+'>'+escape(n.text.replace(/\n$/,''),true)+(n.text?'\n':'')+'</code></pre>\n';break;case 'hr':out+='<hr>\n';break;case 'heading':out+='<h'+n.level+'>'+inline(n.text,refs)+'</h'+n.level+'>\n';break;case 'quote':out+='<blockquote>\n'+render(n.children,refs)+'</blockquote>\n';break;case 'text':case 'paragraph':out+=tight?inline(n.text,refs):'<p>'+inline(n.text,refs)+'</p>\n';break;case 'list':{const tag=n.ordered?'ol':'ul';out+='<'+tag+(n.ordered&&n.start!==1?' start="'+n.start+'"':'')+'>\n';for(const item of n.items){let s=render(item.children,refs,!n.loose);if(item.task){const check='<input '+(item.checked?'checked="" ':'')+'disabled="" type="checkbox"> ';if(n.loose&&s.startsWith('<p>'))s='<p>'+check+s.slice(3);else s=check+s;}out+='<li>'+s+'</li>\n';}out+='</'+tag+'>\n';break;}case 'table':{out+='<table>\n<thead>\n<tr>\n';const cell=(s,j,tag)=>'<'+tag+(n.a[j]?' align="'+n.a[j]+'"':'')+'>'+inline(s,refs)+'</'+tag+'>\n';n.h.forEach((s,j)=>out+=cell(s,j,'th'));out+='</tr>\n</thead>\n';if(n.rows.length){out+='<tbody>';for(const row of n.rows){out+='<tr>\n';n.h.forEach((_,j)=>out+=cell(row[j]||'',j,'td'));out+='</tr>\n';}out+='</tbody>';}out+='</table>\n';break;}}}return out;}
export function parse(markdown) { const refs=new Map();const tree=blocks(markdown.replace(/\r\n?/g,'\n'),refs);return render(tree,refs); }
