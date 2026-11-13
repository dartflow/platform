import { Lexer } from 'marked';

export type BlogAttrs = {src?:string;assetId?:string;alt?:string;width?:number;height?:number;x?:number;y?:number;ratio?:string;displayWidth?:number;title?:string|null;level?:number;textAlign?:string;start?:number;checked?:boolean;language?:string|null;colspan?:number;rowspan?:number;colwidth?:number[]|null};
export type BlogMark = {type:string;attrs?:{href:string;target?:string|null}};
export type BlogNode = {type:string;text?:string;attrs?:BlogAttrs;marks?:BlogMark[];content?:BlogNode[]};
export type BlogDoc = BlogNode & {type:'doc'};
type Budget = {nodes:number;characters:number};
type MdToken = {type:string;text?:string;href?:string;depth?:number;lang?:string;tokens?:MdToken[];header?:{tokens:MdToken[]}[];rows?:{tokens:MdToken[]}[][];items?:{task?:boolean;checked?:boolean;tokens:MdToken[]}[];ordered?:boolean;start?:number};


export class BlogContentError extends Error {}

export const escapeBlogHtml = (value:unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]!));

const clean = (value:unknown, limit:number) => typeof value === 'string'
  ? value.normalize('NFC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, limit)
  : '';
export const blogSlug = (value:unknown) => clean(value, 160).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100).replace(/-$/, '');

const assetPattern = /^\/api\/blog\/media\/([a-f0-9-]{36})$/i;
const seedPattern = /^\/assets\/blog\/[a-z0-9-]+\.(?:webp|png|jpg|jpeg)$/i;
const defaultSeedPattern = /^\/assets\/marketing-(?:hero\.webp|venue\.webp|share\.jpg)$/;
const mediaSource = (value:unknown) => {
  const src = clean(value, 300);
  return assetPattern.test(src) || seedPattern.test(src) || defaultSeedPattern.test(src) ? src : '';
};

const within = (value:unknown, min:number, max:number, fallback:number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
const ratio = (value:string | undefined) => ['4:5', '3:4', '2:3', '1:1', '16:9', '9:16'].includes(value ?? '') ? value! : '4:5';
function normalizeMedia(image:BlogAttrs | null | undefined) {
  if (!image || typeof image !== 'object') return null;
  const src = mediaSource(image.src);
  const assetId = assetPattern.exec(src)?.[1];
  if (!src) return null;
  return {
    src, ...(assetId ? {assetId} : {}), alt: clean(image.alt, 300),
    width: Math.floor(within(image.width, 1, 9000, 0)), height: Math.floor(within(image.height, 1, 9000, 0)),
    x: within(image.x, 0, 1, 0.5), y: within(image.y, 0, 1, 0.5), ratio: ratio(image.ratio)
  };
}

function linkSource(value:unknown) {
  const href = clean(value, 1700);
  if (!href || /[\\\p{Cc}\p{Cf}]/u.test(href)) return '';
  if (/^\/(?!\/)|^#[a-z0-9-]+$/i.test(href)) return href;
  try {
    const url = new URL(href);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.href;
    if (url.protocol === 'mailto:' && !url.search && /^[^\s<>@]+@[^\s<>@]+$/.test(url.pathname)) return url.href;
  } catch { /* A malformed link is rendered as text. */ }
  return '';
}

const inline = ['text', 'hardBreak'];
const blocks = ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'taskList', 'codeBlock', 'horizontalRule', 'image', 'table', 'callout'];
const childTypes:Record<string,string[]> = {
  doc: blocks, paragraph: inline, heading: inline, blockquote: blocks, callout: blocks,
  codeBlock: ['text'], bulletList: ['listItem'], orderedList: ['listItem'], listItem: blocks,
  taskList: ['taskItem'], taskItem: blocks, table: ['tableRow'], tableRow: ['tableHeader', 'tableCell'],
  tableHeader: blocks, tableCell: blocks
};
const simpleMarks = ['bold', 'italic', 'strike', 'underline', 'code', 'highlight', 'subscript', 'superscript'];
function normalizeMarks(marks:BlogMark[] | undefined):BlogMark[] {
  if (!Array.isArray(marks)) return [];
  return marks.slice(0, 12).flatMap(mark => {
    if (simpleMarks.includes(mark?.type)) return [{type: mark.type}];
    if (mark?.type !== 'link') return [];
    const href = linkSource(mark.attrs?.href);
    return href ? [{type: 'link', attrs: {href, target: href.startsWith('http') ? '_blank' : null}}] : [];
  });
}

function normalizeNode(node:BlogNode, depth:number, budget:Budget):BlogNode | null {
  if (!node || typeof node !== 'object' || Array.isArray(node) || typeof node.type !== 'string' || depth > 18 || --budget.nodes < 0) throw new BlogContentError('De artikelinhoud bevat te veel of ongeldige blokken.');
  const {type} = node;
  if (node.content !== undefined && !Array.isArray(node.content)) throw new BlogContentError('Ongeldige blokstructuur.');
  if (node.attrs !== undefined && (node.attrs === null || typeof node.attrs !== 'object' || Array.isArray(node.attrs))) throw new BlogContentError('Ongeldige blokeigenschappen.');
  if (['text','hardBreak','horizontalRule','image'].includes(type) && node.content?.length) throw new BlogContentError('Dit artikelblok kan geen onderliggende blokken bevatten.');
  if (type === 'text' && typeof node.text !== 'string') throw new BlogContentError('Ongeldige artikeltekst.');
  if (type !== 'text' && node.text !== undefined) throw new BlogContentError('Ongeldige artikeltekst.');
  if (!['doc','text','hardBreak',...blocks,'listItem','taskItem','tableRow','tableHeader','tableCell'].includes(type)) throw new BlogContentError('Onbekend artikelblok.');
  const attrs = node.attrs ?? {};
  if (type === 'text') {
    const text = typeof node.text === 'string' ? node.text.replace(/\u0000/g, '') : '';
    budget.characters -= text.length;
    if (budget.characters < 0) throw new BlogContentError('De artikeltekst is te lang.');
    if (!text) return null;
    const marks = normalizeMarks(node.marks);
    return marks.length ? {type, text, marks} : {type, text};
  }
  if (type === 'image') {
    const image = normalizeMedia(attrs);
    if (!image) throw new BlogContentError('Gebruik een afbeelding uit de DartFlow-mediabibliotheek.');
    const displayWidth = Math.floor(within(attrs.displayWidth, 80, 1600, 0));
    return {type, attrs: {...image, ...(displayWidth ? {displayWidth} : {}), title: clean(attrs.title, 200) || null}};
  }
  const normalized:BlogNode = {type};
  if (type === 'heading') normalized.attrs = {level: Math.max(2, Math.min(4, Number.isInteger(attrs.level) ? attrs.level! : 2))};
  if (['paragraph', 'heading'].includes(type) && ['left','center','right','justify'].includes(attrs.textAlign ?? '')) {
    normalized.attrs = {...normalized.attrs, textAlign: attrs.textAlign};
  }
  if (type === 'orderedList') normalized.attrs = {start: Math.floor(within(attrs.start, 1, 1000, 1))};
  if (type === 'taskItem') normalized.attrs = {checked: attrs.checked === true};
  if (type === 'codeBlock') normalized.attrs = {language: /^[\w+-]{1,25}$/.test(attrs.language ?? '') ? attrs.language! : null};
  if (type === 'tableHeader' || type === 'tableCell') normalized.attrs = {
    colspan: Math.floor(within(attrs.colspan, 1, 12, 1)), rowspan: Math.floor(within(attrs.rowspan, 1, 30, 1)),
    colwidth: Array.isArray(attrs.colwidth) ? attrs.colwidth.slice(0, 12).map(width => Math.floor(within(width, 1, 1200, 0))) : null
  };
  const allowed = childTypes[type];
  if (allowed && Array.isArray(node.content)) {
    if (node.content.some(child => !allowed.includes(child?.type))) throw new BlogContentError('Ongeldige blokstructuur.');
    const content = node.content.map(child => normalizeNode(child, depth + 1, budget)).filter((child):child is BlogNode => Boolean(child));
    if (content.length) normalized.content = content;
  }
  if (['listItem', 'taskItem', 'tableCell', 'tableHeader'].includes(type) && !normalized.content?.length) normalized.content = [{type: 'paragraph'}];
  if (['bulletList', 'orderedList', 'taskList', 'table', 'tableRow', 'blockquote', 'callout'].includes(type) && !normalized.content?.length) return null;
  return normalized;
}

export function validateBlogDocument(input:unknown):BlogDoc {
  if (!input || typeof input !== 'object' || (input as BlogNode).type !== 'doc') throw new BlogContentError('Ongeldig artikeldocument.');
  return normalizeNode(input as BlogNode,0,{nodes:3500,characters:95000}) as BlogDoc;
}
export function collectBlogMediaIds(input:BlogDoc):string[] {
  const ids = new Set<string>();
  const walk = (node:BlogNode) => {if(node.type==='image' && node.attrs?.assetId) ids.add(node.attrs.assetId);node.content?.forEach(walk);};
  walk(validateBlogDocument(input)); return [...ids];
}

const inlineTokenMarks:Record<string,string> = {strong: 'bold', em: 'italic', del: 'strike'};
function markdownInline(tokens:MdToken[] | undefined, marks:BlogMark[] = []):BlogNode[] {
  return (tokens ?? []).flatMap(token => {
    if (token.type === 'br') return [{type: 'hardBreak'}];
    if (token.type === 'image') return token.text ? [{type: 'text', text: token.text, marks}] : [];
    if (token.type === 'codespan') return [{type: 'text', text: token.text, marks: [...marks, {type: 'code'}]}];
    if (token.type === 'link') {
      const href = linkSource(token.href);
      return markdownInline(token.tokens, href ? [...marks, {type: 'link', attrs: {href}}] : marks);
    }
    if (inlineTokenMarks[token.type]) return markdownInline(token.tokens, [...marks, {type: inlineTokenMarks[token.type]}]);
    if (token.tokens) return markdownInline(token.tokens, marks);
    if (token.type === 'html') return [];
    return token.text ? [{type: 'text', text: token.text, marks}] : [];
  });
}

function markdownBlocks(tokens:MdToken[] | undefined):BlogNode[] {
  return (tokens ?? []).flatMap(token => {
    if (['space', 'html', 'def'].includes(token.type)) return [];
    if (token.type === 'heading') return [{type: 'heading', attrs: {level: Math.max(2,Math.min(4,token.depth ?? 2))}, content: markdownInline(token.tokens)}];
    if (token.type === 'blockquote') return [{type: 'blockquote', content: markdownBlocks(token.tokens)}];
    if (token.type === 'hr') return [{type: 'horizontalRule'}];
    if (token.type === 'code') return [{type: 'codeBlock', attrs: {language: token.lang ?? null}, content: [{type: 'text', text: token.text ?? ''}]}];
    if (token.type === 'table') {
      const row = (cells:{tokens:MdToken[]}[], type:string) => ({type: 'tableRow', content: cells.map(cell => ({type, content: [
        {type: 'paragraph', content: markdownInline(cell.tokens)}
      ]}))});
      return [{type: 'table', content: [row(token.header ?? [], 'tableHeader'), ...(token.rows ?? []).map(cells => row(cells, 'tableCell'))]}];
    }
    if (token.type === 'list') {
      // GFM can combine ordinary bullets and checkboxes into one list. Preserve
      // each checked value by splitting consecutive runs into Tiptap list types.
      const runs:{tasks:boolean;start:number;items:NonNullable<MdToken['items']>}[] = [];
      for (const [index,item] of (token.items ?? []).entries()) {
        const tasks = item.task === true;
        if (!runs.length || runs[runs.length - 1].tasks !== tasks) runs.push({tasks,start:(token.start ?? 1)+index,items:[]});
        runs[runs.length - 1].items.push(item);
      }
      return runs.map(run => ({
        type: run.tasks ? 'taskList' : token.ordered ? 'orderedList' : 'bulletList',
        attrs: {start: run.start},
        content: run.items.map(item => ({type: run.tasks ? 'taskItem' : 'listItem', attrs: {checked: item.checked}, content: markdownBlocks(item.tokens)}))
      }));
    }
    const content = markdownInline(token.tokens ?? [token]);
    return content.length ? [{type: 'paragraph', content}] : [];
  });
}

export function markdownToBlogDocument(markdown:unknown):BlogDoc {
  if (typeof markdown !== 'string' || markdown.length > 95000) throw new BlogContentError('De Markdown-inhoud ontbreekt of is te lang.');
  return validateBlogDocument({type:'doc',content:markdownBlocks(Lexer.lex(markdown,{gfm:true}) as unknown as MdToken[])});
}

const textTags:Record<string,string> = {bold: 'strong', italic: 'em', strike: 's', underline: 'u', code: 'code', highlight: 'mark', subscript: 'sub', superscript: 'sup'};
const tags:Record<string,string> = {paragraph:'p', blockquote:'blockquote', callout:'aside', bulletList:'ul', orderedList:'ol', listItem:'li',
  taskList:'ul', taskItem:'li', table:'table', tableRow:'tr', tableHeader:'th', tableCell:'td'};
const nodeText = (node:BlogNode):string => node.text || (node.content || []).map(nodeText).join('');

export function renderBlogDocument(input:BlogDoc) {
  const doc=validateBlogDocument(input);
  const headings:{id:string;text:string;level:number}[]=[];
  const headingIds = new Set();
  let words = 0;
  function render(node:BlogNode):string {
    const attrs = node.attrs ?? {};
    const e = escapeBlogHtml;
    if (node.type === 'text') {
      words += (node.text ?? '').trim().split(/\s+/).filter(Boolean).length;
      return (node.marks ?? []).reduce((value, mark) => {
        const tag = textTags[mark.type];
        if (tag) return `<${tag}>${value}</${tag}>`;
        if (mark.type === 'link' && mark.attrs) {
          const external = mark.attrs.target ? ' target="_blank" rel="noopener noreferrer"' : '';
          return `<a href="${e(mark.attrs.href)}"${external}>${value}</a>`;
        }
        return value;
      }, e(node.text));
    }
    if (node.type === 'hardBreak') return '<br>';
    if (node.type === 'horizontalRule') return '<hr>';
    if (node.type === 'image') {
      const size = attrs.width && attrs.height ? ` width="${attrs.width}" height="${attrs.height}"` : '';
      const display = attrs.displayWidth ? ` style="width:${attrs.displayWidth}px;height:auto;max-width:100%"` : '';
      return `<figure><img src="${e(attrs.src)}" alt="${e(attrs.alt)}"${size}${display} loading="lazy" decoding="async">${attrs.title ? `<figcaption>${e(attrs.title)}</figcaption>` : ''}</figure>`;
    }
    const inside = (node.content ?? []).map(render).join('');
    const align = attrs.textAlign ? ` class="blog-align-${attrs.textAlign}"` : '';
    if (node.type === 'heading') {
      const text = nodeText(node);
      const base = blogSlug(text) || 'paragraaf';
      let id = base;
      for (let n = 2; headingIds.has(id); n++) id = `${base}-${n}`;
      headingIds.add(id);
      headings.push({id, text, level: attrs.level ?? 2});
      return `<h${attrs.level} id="${id}"${align}>${inside}</h${attrs.level}>`;
    }
    if (node.type === 'codeBlock') return `<pre><code>${inside}</code></pre>`;
    if (node.type === 'table') return `<div class="blog-table-wrap" tabindex="0" role="region" aria-label="Tabel"><table><tbody>${inside}</tbody></table></div>`;
    if (node.type === 'taskItem') return `<li class="blog-task-item"><input type="checkbox" disabled aria-label="Taak"${attrs.checked ? ' checked' : ''}><div>${inside}</div></li>`;
    if (node.type === 'taskList') return `<ul class="blog-task-list">${inside}</ul>`;
    const tag = tags[node.type];
    if (!tag) return inside;
    const ordered = node.type === 'orderedList' && attrs.start !== 1 ? ` start="${attrs.start}"` : '';
    const cell = node.type === 'tableHeader' || node.type === 'tableCell' ? ` colspan="${attrs.colspan}" rowspan="${attrs.rowspan}"` : '';
    const callout = node.type === 'callout' ? ' class="blog-callout"' : '';
    return `<${tag}${align}${ordered}${cell}${callout}>${inside}</${tag}>`;
  }
  const html=render(doc);
  return {html,headings,text:nodeText(doc),readMinutes:Math.max(1,Math.ceil(words/215))};
}
