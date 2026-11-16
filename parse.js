// A document-local Markdown reader. No external modules or retained document state.
const htmlEntities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const unicodePunctuation = /[\p{P}\p{S}]/u;
const escapedPunctuation = /\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g;

function htmlEscape(value, literal = false) {
  if (!/[&<>"']/.test(value)) return value;
  if (!literal && value.indexOf('&#') !== -1) {
    value = value.replace(/&#(\d{1,7}|[xX][\da-fA-F]{1,6});/g, (whole, digits) => {
      const number = digits[0].toLowerCase() === 'x' ? parseInt(digits.substring(1), 16) : +digits;
      return !number || number > 1114111 || number >= 55296 && number <= 57343
        ? '\ufffd' : String.fromCodePoint(number);
    });
  }
  return value.replace(literal ? /[&<>"']/g : /[<>"']|&(?!(?:\w+|#\d{1,7}|#[xX][\da-fA-F]{1,6});)/g,
    character => htmlEntities[character]);
}

function unquote(value) { return value.replace(escapedPunctuation, '$1'); }
function referenceName(value) { return value.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase().toLowerCase(); }
function encodeAddress(value) {
  try { return encodeURI(value).replace(/%25/g, '%'); } catch { return null; }
}
function spaceAt(value, position) {
  const code = value.charCodeAt(position);
  return position < 0 || position >= value.length || code === 32 || code >= 9 && code <= 13 ||
    code > 127 && /\s/u.test(value[position]);
}
function punctuationAt(value, position) {
  const code = value.charCodeAt(position);
  if (code < 128) return code >= 33 && code <= 47 || code >= 58 && code <= 64 ||
    code >= 91 && code <= 96 || code >= 123 && code <= 126;
  return code >= 128 && unicodePunctuation.test(value[position]);
}
function runEnd(value, position, code) {
  while (value.charCodeAt(position) === code) ++position;
  return position;
}
function expandTabs(value, column = 0) {
  if (value.indexOf('\t') < 0) return value;
  let expanded = '';
  for (const character of value) {
    const width = character === '\t' ? 4 - column % 4 : 1;
    expanded += character === '\t' ? ' '.repeat(width) : character;
    column += width;
  }
  return expanded;
}

const listLine = /^ {0,3}([*+-]|\d{1,9}[.)])(?:([ \t]+)(.*)|$)/;
const ruleLine = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/;
const fenceLine = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const headingLine = /^ {0,3}(#{1,6})(?=\s|$)(.*)$/;
const underlineLine = /^ {0,3}(=+|-+)[ \t]*$/;
const quoteLine = /^ {0,3}>/;
const indentedLine = /^(?: {4}| {0,3}\t)/;
const blockElements = new Set(('address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem meta nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul').split(' '));
const rawEnds = {script: /<\/script>/i, pre: /<\/pre>/i, style: /<\/style>/i, textarea: /<\/textarea>/i};
const completeHtmlTag = /^ {0,3}(?:<\/[a-z][\w-]*\s*>|<[a-z][\w-]*(?:\s+[a-z_:][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>)\s*$/i;
function htmlBlock(line, withinParagraph = false) {
  const match = /^ {0,3}<(?:(script|pre|style|textarea)(?:\s|>|$)|(!--)|(\?)|(!\[CDATA\[)|(![A-Z])|\/?([a-z][\w-]*)(?:\s|\/?>|$))/i.exec(line);
  if (!match) return null;
  if (match[1]) return rawEnds[match[1].toLowerCase()];
  if (match[2]) return /-->/;
  if (match[3]) return /\?>/;
  if (match[4]) return /\]\]>/;
  if (match[5]) return />/;
  if (blockElements.has(match[6]?.toLowerCase()) || !withinParagraph && completeHtmlTag.test(line)) return true;
  return null;
}
function validFence(line) {
  const match = fenceLine.exec(line);
  return match && !(match[1][0] === '`' && match[2].includes('`')) ? match : null;
}
function splitCells(line) {
  let start = 0, end = line.length;
  while (start < end && /\s/.test(line[start])) ++start;
  while (end > start && /\s/.test(line[end - 1])) --end;
  if (line[start] === '|') ++start;
  if (line[end - 1] === '|' && line[end - 2] !== '\\') --end;
  const result = [];
  let piece = '', slashes = 0;
  for (let cursor = start; cursor < end; ++cursor) {
    const character = line[cursor];
    if (character === '|') {
      if (slashes & 1) piece = piece.substring(0, piece.length - 1) + '|';
      else { result.push(piece.trim()); piece = ''; }
    } else piece += character;
    slashes = character === '\\' ? slashes + 1 : 0;
  }
  result.push(piece.trim());
  return result;
}
function tableHeader(lines, row) {
  const separator = lines[row + 1];
  if (!separator || !lines[row].trim() || !/[:|]/.test(separator) || !/^[ |:\-]+$/.test(separator)) return null;
  const widths = splitCells(separator);
  if (widths.some(cell => !/^:?-+:?$/.test(cell))) return null;
  const labels = splitCells(lines[row]);
  if (labels.length !== widths.length) return null;
  return [labels, widths.map(cell => cell.endsWith(':') ? cell.startsWith(':') ? 'center' : 'right' : cell.startsWith(':') ? 'left' : '')];
}
function paragraphStops(lines, row) {
  const line = lines[row] || '';
  // Most continuation lines begin with a letter. Only tables need a lookahead there.
  let first = 0;
  while (line.charCodeAt(first) === 32 && first < 4) ++first;
  const code = line.charCodeAt(first);
  if (code >= 65 && code <= 90 || code >= 97 && code <= 122) return !!tableHeader(lines, row);
  if (!line.trim() || ruleLine.test(line) || headingLine.test(line) || quoteLine.test(line) ||
      validFence(line) || htmlBlock(line, true)) return true;
  const item = listLine.exec(line);
  if (item && item[3] && (!/^\d/.test(item[1]) || /^1[.)]$/.test(item[1]))) return true;
  return !!tableHeader(lines, row);
}

function definitionAt(lines, row) {
  if (!/^ {0,3}\[/.test(lines[row])) return null;
  // Read only the candidate definition's paragraph, rather than the whole document.
  let limit = row + 1;
  while (limit < lines.length && lines[limit].trim()) ++limit;
  const candidate = lines.slice(row, limit).join('\n');
  const label = /^ {0,3}\[((?:\\.|[^\[\]\\])+)\]:[ \t]*(?:\n[ \t]*)?(<[^<>\n]*>|[^<\s][^\s]*)([^\n]*)/.exec(candidate);
  if (!label || !referenceName(label[1])) return null;
  let address = label[2];
  if (address[0] === '<') address = address.substring(1, address.length - 1);
  else {
    let depth = 0;
    for (let p = 0; p < address.length; ++p) {
      if (address[p] === '\\') { ++p; continue; }
      if (address[p] === '(') ++depth;
      if (address[p] === ')' && --depth < 0) return null;
    }
    if (depth) return null;
  }
  let consumed = label[0].length - label[3].length;
  const titlePattern = /(?:[ \t]+|[ \t]*\n[ \t]*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^()\\])*\))[ \t]*(?=\n|$)/y;
  titlePattern.lastIndex = consumed;
  const title = titlePattern.exec(candidate);
  let description = '';
  if (title) {
    description = title[1].substring(1, title[1].length - 1);
    if (/\n[ \t]*\n/.test(description)) return null;
    consumed = titlePattern.lastIndex;
  } else while (candidate[consumed] === ' ' || candidate[consumed] === '\t') ++consumed;
  if (consumed < candidate.length && candidate[consumed] !== '\n') return null;
  let endRow = row + 1;
  for (let p = 0; p < consumed; ++p) if (candidate.charCodeAt(p) === 10) ++endRow;
  return {name: referenceName(label[1]), address: unquote(address), title: unquote(description), endRow};
}

// Nodes are compact tuples: kind followed by the data used by that kind.
class DocumentReader {
  constructor() { this.references = new Map(); }

  read(source, paragraphs = true, references = this.references) {
    const lines = source.split('\n');
    const nodes = [];
    let row = 0;
    while (row < lines.length) {
      const line = lines[row];
      let match;
      if (!line.trim()) {
        const beginning = row;
        do { ++row; } while (row < lines.length && !lines[row].trim());
        nodes.push(['blank', row - beginning]);
      } else if ((match = validFence(line))) {
        const marker = match[1][0], width = match[1].length;
        const indent = marker === '`' ? line.search(/\S/) : 0;
        const close = new RegExp('^ {0,3}' + marker + '{' + width + ',} *$');
        const content = [];
        for (++row; row < lines.length && !close.test(lines[row]); ++row) {
          const padding = /^\s*/.exec(lines[row])[0].length;
          content.push(lines[row].substring(Math.min(indent, padding)));
        }
        if (row < lines.length) ++row;
        else if (content.at(-1) === '') content.pop();
        nodes.push(['code', content.join('\n'), unquote(match[2].trim()).split(/\s/)[0]]);
      } else if (indentedLine.test(line)) {
        const content = [];
        while (row < lines.length) {
          if (indentedLine.test(lines[row])) content.push(lines[row++].replace(/^(?: {0,3}\t| {4})/, ''));
          else if (!lines[row].trim()) content.push(lines[row++].replace(/^ +$/, ''));
          else break;
        }
        while (content.at(-1) === '') content.pop();
        const previous = nodes.at(-1);
        if (previous && (previous[0] === 'p' || previous[0] === 'text')) previous[1] += '\n' + content.join('\n');
        else nodes.push(['code', content.join('\n'), '']);
      } else if ((match = headingLine.exec(line))) {
        nodes.push(['h', match[2].trim().replace(/(?:^|[ \t]+)#+$/, '').trim(), match[1].length]);
        ++row;
      } else if (ruleLine.test(line)) {
        nodes.push(['hr']); ++row;
      } else if (quoteLine.test(line)) {
        const quoted = [], lazy = [];
        let allowsLazy;
        while (row < lines.length) {
          if (quoteLine.test(lines[row])) {
            const expanded = lines[row++].replace(/^( {0,3}>)([ \t]+)/,
              (_, prefix, padding) => prefix + expandTabs(padding, prefix.length));
            quoted.push(expanded.replace(/^ {0,3}> ?/, ''));
            allowsLazy = undefined;
          } else {
            if (!lines[row].trim() || !quoted.at(-1)?.trim()) break;
            if (allowsLazy === undefined) {
              let last = this.read(quoted.join('\n'), true, new Map(references)).filter(n => n[0] !== 'blank').at(-1);
              while (last?.[0] === 'quote') last = last[1].filter(n => n[0] !== 'blank').at(-1);
              allowsLazy = !!last && ['p', 'text', 'list'].includes(last[0]);
            }
            if (!allowsLazy || paragraphStops(lines, row)) break;
            const setext = underlineLine.test(lines[row]);
            if (!setext) lazy.push(lines[row]);
            quoted.push(setext ? '    ' + lines[row].trim() : lines[row]);
            ++row;
          }
        }
        const children = this.read(quoted.join('\n'), true, references);
        for (const child of children) if (child[0] === 'p') {
          for (const continuation of lazy) if (indentedLine.test(continuation)) {
            child[1] = child[1].replace(continuation, continuation.replace(/^(?: {4}| {0,3}\t)/, ''));
          }
        }
        nodes.push(['quote', children]);
      } else if ((match = listLine.exec(line))) {
        const ordered = /^\d/.test(match[1]);
        const delimiter = ordered ? match[1].at(-1) : match[1];
        const belongs = item => item && (ordered ? /^\d/.test(item[1]) && item[1].at(-1) === delimiter : item[1] === delimiter);
        const items = [];
        let loose = false;
        while (row < lines.length) {
          const item = listLine.exec(lines[row]);
          if (!belongs(item) || ruleLine.test(lines[row])) break;
          const prefixLength = lines[row].indexOf(item[1]) + item[1].length;
          let padding = expandTabs(item[2] || '', prefixLength).length;
          if (padding > 4 || !(item[3] || '').trim()) padding = 1;
          const indent = prefixLength + (padding || 1);
          const initial = ((item[2] || '') + (item[3] || '')).replace(/^[ \t]+/, s => expandTabs(s, prefixLength)).substring(padding);
          const body = [initial];
          ++row;
          if (!initial.trim() && !lines[row]?.trim()) {
            if (row < lines.length) { ++row; loose = true; }
            items.push([[], false, false]);
            continue;
          }
          let afterBlank = false;
          while (row < lines.length) {
            const current = lines[row].replace(/^[ \t]+/, s => expandTabs(s));
            if (!current.trim()) { body.push(''); afterBlank = true; ++row; continue; }
            const indentation = current.search(/\S/);
            if (indentation < indent && (listLine.test(current) || ruleLine.test(current) ||
                /^ {0,3}(?:#{1,6}(?:\s|$)|>|`{3,}|~{3,})/.test(current) || htmlBlock(current, true))) break;
            if (indentation >= indent) {
              body.push(current.substring(indent)); ++row; afterBlank = false; continue;
            }
            if (afterBlank || !body.at(-1)?.trim() || paragraphStops(lines, row) || fenceLine.test(body.at(-1)) || indentedLine.test(body[0])) break;
            body.push(current); ++row;
          }
          let blanks = 0;
          for (let p = body.length - 1; p > 0 && body[p] === ''; --p) ++blanks;
          const anotherItem = belongs(listLine.exec(lines[row] || ''));
          if (blanks && anotherItem && body.some(s => s.trim())) loose = true;
          else if (blanks && !anotherItem) row -= blanks;
          while (body.at(-1) === '') body.pop();
          while (body.length && !body[0].trim()) body.shift();
          const task = /^\[[ xX]\][ \t]+\S/.test(body[0] || '');
          const checked = task && body[0][1] !== ' ';
          if (task) body[0] = body[0].replace(/^\[[ xX]\][ \t]+/, '');
          const children = body.length ? this.read(body.join('\n'), false, references) : [];
          if (children.some(n => n[0] === 'blank' && n[1]) && children.some(n => n[0] !== 'blank')) loose = true;
          items.push([children, task, checked]);
        }
        nodes.push(['list', items, ordered, ordered ? parseInt(match[1]) : 1, loose]);
      } else {
        const html = htmlBlock(line);
        if (html) {
          const content = [];
          while (row < lines.length && !(html === true && !lines[row].trim())) {
            const current = lines[row++];
            content.push(current);
            if (html !== true && html.test(current)) break;
          }
          const newline = row < lines.length && (lines[row].trim() || row === lines.length - 1 || html !== true && lines[row] !== '');
          nodes.push(['html', content.join('\n') + (newline ? '\n' : '')]);
          continue;
        }
        const definition = definitionAt(lines, row);
        if (definition) {
          if (!references.has(definition.name)) references.set(definition.name, definition);
          row = definition.endRow;
          continue;
        }
        const table = tableHeader(lines, row);
        if (table) {
          row += 2;
          const body = [];
          while (row < lines.length && !/^ *$/.test(lines[row]) &&
              (!paragraphStops(lines, row) || /^[ \t]*\t[ \t]*$/.test(lines[row]))) body.push(splitCells(lines[row++]));
          nodes.push(['table', table[0], table[1], body]);
          continue;
        }
        if (!paragraphs && nodes.at(-1)?.[0] !== 'text') {
          let next = row + 1;
          while (next < lines.length && !paragraphStops(lines, next) && !listLine.test(lines[next]) && !underlineLine.test(lines[next])) ++next;
          if (underlineLine.test(lines[next] || '')) {
            nodes.push(['h', lines.slice(row, next).join('\n').trim(), lines[next].trim()[0] === '=' ? 1 : 2]);
            row = next + 1;
            continue;
          }
        }
        const body = [line];
        ++row;
        let heading = false;
        while (paragraphs && row < lines.length) {
          if (underlineLine.test(lines[row])) {
            nodes.push(['h', body.join('\n').trim(), lines[row].trim()[0] === '=' ? 1 : 2]);
            ++row; heading = true; break;
          }
          if (paragraphStops(lines, row)) {
            if (row === lines.length - 1 && /^[ \t]+$/.test(lines[row])) body.push(lines[row++]);
            break;
          }
          body.push(lines[row++]);
        }
        if (!heading) {
          const prior = nodes.at(-1);
          if (!paragraphs && prior?.[0] === 'text') prior[1] += '\n' + body.join('\n');
          else nodes.push([paragraphs ? 'p' : 'text', body.join('\n')]);
        }
      }
    }
    return nodes;
  }
}

// Sticky expressions always match at the supplied index in the original input.
function at(pattern, text, index) { pattern.lastIndex = index; return pattern.exec(text); }
const inlineTag = /<!--(?:-?>|[\s\S]*?(?:-->|$))|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![A-Z][\s\S]*?>|<\/[a-z][\w-]*\s*>|<[a-z][\w-]*(?:\s+[a-z_:][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/iy;
const angleAddress = /<([a-z][a-z\d+.-]{1,31}:[^\s\x00-\x1f<>]*|[a-z\d.!#$%&'*+/=?^_`{|}~\-]+@[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)*)>/iy;
const automaticAddress = /(?:(?:[hH][tT][tT][pP][sS]?|[fF][tT][pP]):\/\/|www\.)[^\s<]+|(?:(?:mailto|xmpp):)?[A-Za-z\d._+\-]+@[A-Za-z\d_\-]+(?:\.[A-Za-z\d_\-]*[A-Za-z\d])+(?![\w-])(?:\/[A-Za-z\d@.]+)?/y;
// This expression locates a possible token, not its entire trailing remainder.
const nextInlineToken = /[\\`<!\[*_~]| {2,}\n|[hH][tT][tT][pP][sS]?:\/\/|[fF][tT][pP]:\/\/|www\.|(?:mailto|xmpp):|[A-Za-z\d._+\-]+@/g;
const hardBreak = /(?: {2,}|\\)\n(?!\s*$)[ \t]*/y;
const asciiEscape = /\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/y;
const maskTriggers = /[\[`<]/g;

function closingTicks(text, opening, width) {
  const ticks = '`'.repeat(width);
  let cursor = opening + width;
  while ((cursor = text.indexOf(ticks, cursor)) !== -1) {
    if (text.charCodeAt(cursor - 1) !== 96 && text.charCodeAt(cursor + width) !== 96) return cursor;
    cursor = runEnd(text, cursor, 96);
  }
  return -1;
}

function maskInline(text, references) {
  if (!/[`\\[<]/.test(text)) return text;
  // Escaped punctuation must not become delimiters; inner ticks in code are inert.
  let protectedText = '', copied = 0;
  const protectionTriggers = /[`\\]/g;
  for (let cursor = 0; cursor < text.length;) {
    protectionTriggers.lastIndex = cursor;
    const trigger = protectionTriggers.exec(text);
    if (!trigger) break;
    cursor = trigger.index;
    if (text[cursor] === '\\') {
      if (cursor + 1 < text.length && punctuationAt(text, cursor + 1)) {
        protectedText += text.substring(copied, cursor) + '++';
        copied = cursor += 2;
      } else ++cursor;
    } else {
      const width = runEnd(text, cursor, 96) - cursor;
      const close = closingTicks(text, cursor, width);
      if (close > cursor + width) {
        const interior = text.substring(cursor + width, close);
        if (interior.includes('`')) {
          protectedText += text.substring(copied, cursor + width) + interior.replace(/`/g, '+');
          copied = close;
        }
        cursor = close + width;
      } else cursor += width;
    }
  }
  let source = copied ? protectedText + text.substring(copied) : text;
  if (references.size) {
    source = source.replace(/!?\[((?:\\.|[^\[\]])+)\](?:\[([^\[\]]*)\])?/g,
      (span, label, name) => references.has(referenceName(name || label)) ? '[' + 'a'.repeat(span.length - 2) + ']' : span);
  }
  const regions = [];
  let cursor = 0;
  while (cursor < source.length) {
    maskTriggers.lastIndex = cursor;
    const trigger = maskTriggers.exec(source);
    if (!trigger) break;
    const begin = trigger.index;
    cursor = begin + 1;
    if (source[begin] === '[') {
      let labelEnd = cursor, valid = true;
      for (; labelEnd < source.length; ++labelEnd) {
        const code = source.charCodeAt(labelEnd);
        if (code === 92) { ++labelEnd; continue; }
        if (code === 91) { valid = false; break; }
        if (code === 93) break;
        if (code === 96) {
          const afterRun = runEnd(source, labelEnd, 96);
          const nextTick = source.indexOf('`', afterRun);
          if (nextTick < 0) { valid = false; break; }
          const afterClose = runEnd(source, nextTick, 96);
          if (afterClose - nextTick !== afterRun - labelEnd) { valid = false; break; }
          labelEnd = afterClose - 1;
        }
      }
      if (valid && source[labelEnd] === ']' && source[labelEnd + 1] === '(') {
        let depth = 1, finish = labelEnd + 2;
        for (; finish < source.length && depth; ++finish) {
          if (source[finish] === '\\') { ++finish; continue; }
          if (source[finish] === '(') ++depth;
          if (source[finish] === ')') --depth;
        }
        if (!depth) { regions.push([begin, finish]); cursor = finish; }
      }
    } else if (source[begin] === '`' && source[begin - 1] !== '`') {
      const width = runEnd(source, begin, 96) - begin;
      const nextTick = source.indexOf('`', begin + width);
      if (nextTick > begin + width && runEnd(source, nextTick, 96) - nextTick === width) {
        cursor = nextTick + width;
        regions.push([begin, cursor]);
      }
    } else if (source[begin] === '<' && source[begin + 1] !== ' ') {
      const end = source.indexOf('>', begin + 1);
      const nested = source.indexOf('<', begin + 1);
      if (end >= 0 && (nested < 0 || nested > end)) { cursor = end + 1; regions.push([begin, cursor]); }
    }
  }
  if (!regions.length) return source;
  const parts = [];
  let position = 0;
  for (const [begin, end] of regions) {
    parts.push(source.substring(position, begin), '[', 'a'.repeat(end - begin - 2), ']');
    position = end;
  }
  parts.push(source.substring(position));
  return parts.join('');
}

function delimiterFlags(text, start, end, underscore = false) {
  const beforeSpace = spaceAt(text, start - 1), afterSpace = spaceAt(text, end);
  const beforePunctuation = punctuationAt(text, start - 1), afterPunctuation = punctuationAt(text, end);
  let opens = !afterSpace && (!afterPunctuation || beforeSpace || beforePunctuation);
  let closes = !beforeSpace && (!beforePunctuation || afterSpace || afterPunctuation);
  if (underscore) {
    const left = opens;
    opens = opens && (!closes || beforePunctuation);
    closes = closes && (!left || afterPunctuation);
  }
  return (opens ? 1 : 0) | (closes ? 2 : 0);
}

function emphasisEnd(text, beginning, width, marker) {
  let origin = beginning;
  while (origin && text.charCodeAt(origin - 1) === marker) --origin;
  const beforeSpace = spaceAt(text, origin - 1), beforePunctuation = punctuationAt(text, origin - 1);
  if (spaceAt(text, beginning + width) || punctuationAt(text, beginning + width) && !beforeSpace && !beforePunctuation ||
      marker === 95 && !beforeSpace && !beforePunctuation) return null;
  let outstanding = width, skipped = 0;
  for (let cursor = beginning + width; cursor < text.length;) {
    const character = text.charCodeAt(cursor);
    if (character === 92) { cursor += 2; continue; }
    if (character === 96) {
      const count = runEnd(text, cursor, 96) - cursor;
      const close = closingTicks(text, cursor, count);
      cursor = close < 0 ? cursor + count : close + count;
      continue;
    }
    if (character === 60) {
      const close = text.indexOf('>', cursor + 1);
      if (close >= 0) { cursor = close + 1; continue; }
    }
    if (character === (marker === 42 ? 95 : 42)) {
      const otherWidth = runEnd(text, cursor, character) - cursor;
      const nested = otherWidth > 1 ? emphasisEnd(text, cursor, otherWidth, character) : null;
      if (nested) { cursor = nested.end; continue; }
    }
    if (character !== marker) { ++cursor; continue; }
    const end = runEnd(text, cursor, marker), count = end - cursor;
    const flags = delimiterFlags(text, cursor, end, marker === 95);
    if (flags === 1) outstanding += count;
    else if (flags & 2) {
      if ((flags & 1 || !beforeSpace && !beforePunctuation) && width % 3 && (width + count) % 3 === 0) skipped += count;
      else {
        outstanding -= count;
        if (outstanding <= 0) {
          const used = Math.min(count, count + outstanding + skipped);
          return {end: cursor + used, width: Math.min(width, used) % 2 ? 1 : 2};
        }
      }
    }
    cursor = end;
  }
  return null;
}

function trimAutomaticAddress(address) {
  let cursor = 0, goodEnd = 0;
  while (cursor < address.length) {
    const character = address[cursor];
    if (character === '(') {
      const close = address.indexOf(')', cursor + 1);
      if (close < 0) break;
      cursor = goodEnd = close + 1;
    } else if (character === '&' && /^&[a-z\d]+;$/i.test(address.substring(cursor))) break;
    else if ("?!.,:;*_'\"~)".includes(character)) ++cursor;
    else goodEnd = ++cursor;
  }
  return address.substring(0, goodEnd);
}

function bracketEnd(text, open) {
  let depth = 1;
  for (let cursor = open + 1; cursor < text.length; ++cursor) {
    const character = text.charCodeAt(cursor);
    if (character === 92) { ++cursor; continue; }
    if (character === 96) {
      const after = runEnd(text, cursor, 96);
      if (after - cursor > 1 && text[after] === ']') { cursor = after - 1; continue; }
      const close = text.indexOf('`', after);
      if (close < 0) return -1;
      cursor = runEnd(text, close, 96) - 1;
      continue;
    }
    if (character === 60) {
      const tag = at(inlineTag, text, cursor);
      // Bracket matching also treats syntactically incomplete angle contents as opaque.
      const end = text.indexOf('>', cursor + 1), nested = text.indexOf('<', cursor + 1);
      if (tag) { cursor += tag[0].length - 1; continue; }
      if (end >= 0 && (nested < 0 || nested > end)) { cursor = end; continue; }
    }
    if (character === 91) ++depth;
    if (character === 93 && --depth === 0) return cursor;
  }
  return -1;
}

function destinationAt(text, open) {
  let cursor = open + 1;
  while (cursor < text.length && spaceAt(text, cursor)) ++cursor;
  let address;
  if (text[cursor] === '<') {
    const close = text.indexOf('>', cursor + 1);
    const newline = text.indexOf('\n', cursor + 1);
    if (close < 0 || newline >= 0 && newline < close || text[close - 1] === '\\') return null;
    address = text.substring(cursor + 1, close);
    cursor = close + 1;
  } else {
    const start = cursor;
    let depth = 0;
    for (; cursor < text.length; ++cursor) {
      const code = text.charCodeAt(cursor);
      if (code === 92) { ++cursor; continue; }
      if (code === 40) ++depth;
      if (code === 41) { if (!depth) break; --depth; }
      if (code === 32 || code === 9 || code === 10) break;
    }
    if (depth) return null;
    address = text.substring(start, cursor);
  }
  const beforeSpace = cursor;
  while (cursor < text.length && spaceAt(text, cursor)) ++cursor;
  let title = '';
  if (cursor > beforeSpace && (text[cursor] === '"' || text[cursor] === "'" || text[cursor] === '(')) {
    const delimiter = text[cursor] === '(' ? ')' : text[cursor];
    const start = ++cursor;
    for (; cursor < text.length; ++cursor) {
      if (text[cursor] === '\\') { ++cursor; continue; }
      if (text[cursor] === delimiter) break;
    }
    if (cursor === text.length) return null;
    title = text.substring(start, cursor++);
    while (cursor < text.length && spaceAt(text, cursor)) ++cursor;
  }
  return text[cursor] === ')' ? {address: unquote(address), title: unquote(title), end: cursor + 1} : null;
}

function inline(text, references, insideLink = false, state = {raw: false}) {
  const result = [];
  const masked = /[*_~]/.test(text) ? maskInline(text, references) : text;
  let position = 0;
  while (position < text.length) {
    const code = text.charCodeAt(position);
    let token;
    if (code === 92 && (token = at(asciiEscape, text, position))) {
      result.push(htmlEscape(token[1])); position += 2; continue;
    }
    if ((code === 32 || code === 92) && (token = at(hardBreak, text, position))) {
      result.push('<br>'); position += token[0].length; continue;
    }
    if (code === 96) {
      const width = runEnd(text, position, 96) - position;
      const close = closingTicks(text, position, width);
      if (close < 0) { result.push('`'.repeat(width)); position += width; }
      else {
        let content = text.substring(position + width, close).replace(/\n/g, ' ');
        if (content[0] === ' ' && content.at(-1) === ' ' && /[^ ]/.test(content)) content = content.substring(1, content.length - 1);
        result.push('<code>', htmlEscape(content, true), '</code>'); position = close + width;
      }
      continue;
    }
    if (code === 60) {
      token = at(angleAddress, text, position);
      if (token) {
        const label = token[1];
        const email = label.includes('@') && !/^[\w+.-]+:/.test(label);
        result.push('<a href="', htmlEscape(encodeAddress((email ? 'mailto:' : '') + label)), '">', htmlEscape(label), '</a>');
        position += token[0].length; continue;
      }
      token = at(inlineTag, text, position);
      if (token) {
        const tag = token[0];
        result.push(tag);
        if (/^<a /i.test(tag)) references.inLink = true;
        else if (/^<\/a>/i.test(tag)) references.inLink = false;
        if (/^<(?:pre|code|kbd|script)(?:\s|>)/i.test(tag)) state.raw = true;
        else if (/^<\/(?:pre|code|kbd|script)(?:\s|>)/i.test(tag)) state.raw = false;
        position += tag.length; continue;
      }
    }
    if (code === 91 || code === 33 && text[position + 1] === '[') {
      const image = code === 33, opening = position + +image;
      const closing = bracketEnd(text, opening);
      if (closing >= 0) {
        const label = text.substring(opening + 1, closing);
        let next = closing + 1, link;
        if (text[next] === '(') {
          link = destinationAt(text, next);
          if (link) next = link.end;
        } else {
          let name = label;
          if (text[next] === '[') {
            const end = text.indexOf(']', next + 1);
            if (end >= 0) { name = text.substring(next + 1, end) || label; next = end + 1; }
          }
          link = references.get(referenceName(name));
        }
        if (!link && text[closing + 1] !== '[') link = references.get(referenceName(label));
        if (link && !( !image && label.includes('[') && inline(label, references, true).includes('<a '))) {
          const address = encodeAddress(link.address);
          if (address !== null) {
            const title = link.title ? ' title="' + htmlEscape(link.title) + '"' : '';
            if (image) {
              const alt = inline(label, references).replace(/<img [^>]*alt="([^"]*)"[^>]*>/g, '$1').replace(/<[^>]*>/g, '');
              result.push('<img src="', htmlEscape(address), '" alt="', alt, '"', title, '>');
            } else result.push('<a href="', htmlEscape(address), '"', title, '>', inline(label, references, true), '</a>');
            position = next; continue;
          }
        }
      }
    }
    if (!insideLink && !references.inLink && (token = at(automaticAddress, text, position))) {
      let address = token[0];
      const email = !/^(?:https?|ftp):\/\/|^www\./i.test(address);
      if (email && /[-_]$/.test(address)) { result.push(htmlEscape(address)); position += address.length; continue; }
      if (!email) address = trimAutomaticAddress(address);
      const target = address.startsWith('www.') ? 'http://' + address :
        (!address.includes('://') && !/^(?:mailto|xmpp):/.test(address) ? 'mailto:' : '') + address;
      result.push('<a href="', htmlEscape(encodeAddress(target)), '">', htmlEscape(address), '</a>');
      position += address.length; continue;
    }
    if ((code === 42 || code === 95) && !state.raw) {
      const width = runEnd(text, position, code) - position;
      const end = emphasisEnd(masked, position, width, code);
      if (end) {
        const tag = end.width === 2 ? 'strong' : 'em';
        result.push('<', tag, '>', inline(text.substring(position + end.width, end.end - end.width), references, insideLink, state), '</', tag, '>');
        position = end.end; continue;
      }
      result.push(text[position++]); continue;
    }
    if (code === 126 && !state.raw) {
      const width = runEnd(text, position, code) - position;
      let balance = width, closing = -1;
      if (width <= 2 && !spaceAt(text, position + width) &&
          (!punctuationAt(text, position + width) || !position || spaceAt(text, position - 1) || punctuationAt(text, position - 1))) {
        for (let cursor = position + width; cursor < text.length; ++cursor) {
          if (masked.charCodeAt(cursor) !== 126) continue;
          const end = runEnd(masked, cursor, 126);
          if (end - cursor === width) {
            const flags = delimiterFlags(text, cursor, end);
            if (flags === 1) balance += width;
            else if (flags & 2) balance -= width;
            if (!balance) { closing = cursor; break; }
          }
          cursor = end - 1;
        }
      }
      if (closing >= 0) {
        result.push('<del>', inline(text.substring(position + width, closing), references, insideLink, state), '</del>');
        position = closing + width;
      } else { result.push('~'.repeat(width)); position += width; }
      continue;
    }
    nextInlineToken.lastIndex = position + 1;
    const next = nextInlineToken.exec(text);
    const finish = next ? next.index : text.length;
    const content = text.substring(position, finish);
    result.push(state.raw ? content : htmlEscape(content));
    position = finish;
  }
  return result.join('');
}

function renderNodes(nodes, references, tight = false) {
  const pieces = [];
  for (const node of nodes) {
    const kind = node[0];
    if (kind === 'blank') continue;
    if (kind === 'html') pieces.push(node[1]);
    else if (kind === 'hr') pieces.push('<hr>\n');
    else if (kind === 'code') {
      pieces.push('<pre><code', node[2] ? ' class="language-' + htmlEscape(node[2]) + '"' : '', '>',
        htmlEscape(node[1].replace(/\n$/, ''), true), node[1] ? '\n' : '', '</code></pre>\n');
    } else if (kind === 'h') pieces.push('<h', node[2], '>', inline(node[1], references), '</h', node[2], '>\n');
    else if (kind === 'quote') pieces.push('<blockquote>\n', renderNodes(node[1], references), '</blockquote>\n');
    else if (kind === 'text' || kind === 'p') {
      if (!tight) pieces.push('<p>');
      pieces.push(inline(node[1], references));
      if (!tight) pieces.push('</p>\n');
    } else if (kind === 'list') {
      const tag = node[2] ? 'ol' : 'ul';
      pieces.push('<', tag, node[2] && node[3] !== 1 ? ' start="' + node[3] + '"' : '', '>\n');
      for (const [children, task, checked] of node[1]) {
        let content = renderNodes(children, references, !node[4]);
        if (task) {
          const checkbox = '<input ' + (checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ';
          content = node[4] && content.startsWith('<p>') ? '<p>' + checkbox + content.substring(3) : checkbox + content;
        }
        pieces.push('<li>', content, '</li>\n');
      }
      pieces.push('</', tag, '>\n');
    } else if (kind === 'table') {
      const cell = (text, column, tag) => '<' + tag + (node[2][column] ? ' align="' + node[2][column] + '"' : '') + '>' + inline(text, references) + '</' + tag + '>\n';
      pieces.push('<table>\n<thead>\n<tr>\n');
      for (let column = 0; column < node[1].length; ++column) pieces.push(cell(node[1][column], column, 'th'));
      pieces.push('</tr>\n</thead>\n');
      if (node[3].length) {
        pieces.push('<tbody>');
        for (const row of node[3]) {
          pieces.push('<tr>\n');
          for (let column = 0; column < node[1].length; ++column) pieces.push(cell(row[column] || '', column, 'td'));
          pieces.push('</tr>\n');
        }
        pieces.push('</tbody>');
      }
      pieces.push('</table>\n');
    }
  }
  return pieces.join('');
}

export function parse(markdown) {
  const reader = new DocumentReader();
  const source = markdown.includes('\r') ? markdown.replace(/\r\n?/g, '\n') : markdown;
  return renderNodes(reader.read(source), reader.references);
}
