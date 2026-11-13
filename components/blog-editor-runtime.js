import { Editor, Node } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { CharacterCount, Placeholder } from '@tiptap/extensions';

export function mountBlogStudio(root) {
const lifecycle = new AbortController();
const listen = (target, name, callback) => target.addEventListener(name,callback,{signal:lifecycle.signal});
const $ = id => root.querySelector(`#studio-${id}`);
const endpoint = '/api/blog/admin';
const blankHero = {src:'', assetId:'', alt:'', x:.5, y:.5, ratio:'4:5'};
const defaultImage = '/assets/marketing-share.jpg';
const links = /^(?:https?:\/\/[^\s]+|mailto:[^\s<>@]+@[^\s<>@]+|\/(?!\/)[^\s]*|#[a-z0-9-]+)$/i;
const states = {draft:'Concept', published:'Gepubliceerd', scheduled:'Ingepland', revision:'Live met concept'};
const stateOf = post => post?.status === 'scheduled' ? 'scheduled'
  : post?.hasUnpublishedChanges ? 'revision'
  : post?.status === 'published' ? 'published' : 'draft';
const dateFormat = new Intl.DateTimeFormat('nl-NL', {dateStyle:'medium', timeStyle:'short', timeZone:'Europe/Amsterdam'});
const dateParts = new Intl.DateTimeFormat('sv-SE', {dateStyle:'short', timeStyle:'short', timeZone:'Europe/Amsterdam'});
const fieldNames = ['title','excerpt','slug','type','locale','author','category','tags','hero-alt','ratio','focus-x','focus-y','seo-title','seo-description','noindex'];
let posts = [], current, connection, capabilities, hero, social, dirty = false, busy = false;
let slugEdited = false, loadingPost = false, mediaTarget = '', savedTime, slash, slashDismissedAt = null;
let bubbleFrame = 0;

function create(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value != null) node.textContent = value;
  return node;
}

function anchor(label, href) {
  const item = create('a', '', label);
  item.href = href;
  if(href.startsWith('/blog/beheer/voorbeeld/')){item.target='_blank';item.rel='noopener noreferrer';}
  return item;
}

function makeButton(label, className = 'button button-outline button-small') {
  const item = create('button', className, label);
  item.type = 'button';
  return item;
}

function slugify(value) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0,100).replace(/-$/,'');
}

function safeImage(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const address = new URL(value, location.origin);
    if (address.origin === location.origin || address.protocol === 'https:') return address.href;
  } catch { /* Invalid image URLs are omitted. */ }
  return '';
}

const EditorialImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent(),
      assetId: {default:null, parseHTML: element => element.getAttribute('data-asset-id'), renderHTML: attrs => attrs.assetId ? {'data-asset-id':attrs.assetId} : {}},
    };
  },
}).configure({allowBase64:false, resize:{enabled:true, directions:['bottom-right'], minWidth:80, minHeight:60, alwaysPreserveAspectRatio:true}});

const Callout = Node.create({
  name:'callout', group:'block', content:'block+', defining:true,
  parseHTML:() => [{tag:'aside[data-callout]'}],
  renderHTML:() => ['aside',{'data-callout':''},0],
});

const editor = new Editor({
  element:$('editor'),
  extensions:[
    StarterKit.configure({heading:{levels:[2,3,4]}, link:{openOnClick:false, autolink:true, linkOnPaste:true, defaultProtocol:'https', isAllowedUri:(url, context) => links.test(url) && context.defaultValidate(url)}}),
    EditorialImage, Highlight, Callout, TextAlign.configure({types:['heading','paragraph']}), TableKit.configure({table:{resizable:true}}), TaskList, TaskItem.configure({nested:true}),
    CharacterCount, Placeholder.configure({placeholder:'Schrijf hier je artikel…'}),
  ],
  editorProps:{attributes:{role:'textbox','aria-label':'Artikeltekst','aria-multiline':'true'}, handleKeyDown:handleEditorKeys},
  onUpdate:() => {
    if (loadingPost) return;
    changed();
    showSlash();
  },
  onSelectionUpdate:() => {
    if (loadingPost) return;
    updateToolbar();
    updateBubble();
    showSlash();
  },
  onBlur:() => { $('bubble').hidden = true; },
});

const activeMarks = new Set(['bold','italic','underline','strike','highlight','link','bulletList','orderedList','taskList','blockquote','codeBlock','code']);
const actions = {
  undo:chain => chain.undo(), redo:chain => chain.redo(), bold:chain => chain.toggleBold(), italic:chain => chain.toggleItalic(),
  underline:chain => chain.toggleUnderline(), strike:chain => chain.toggleStrike(), highlight:chain => chain.toggleHighlight(),
  bulletList:chain => chain.toggleBulletList(), orderedList:chain => chain.toggleOrderedList(), taskList:chain => chain.toggleTaskList(),
  blockquote:chain => chain.toggleBlockquote(), codeBlock:chain => chain.toggleCodeBlock(), code:chain => chain.toggleCode(),
  table:chain => chain.insertTable({rows:3,cols:3,withHeaderRow:true}), horizontalRule:chain => chain.setHorizontalRule(),
  clear:chain => chain.unsetAllMarks().clearNodes(), addRowAfter:chain => chain.addRowAfter(),
  addColumnAfter:chain => chain.addColumnAfter(), deleteRow:chain => chain.deleteRow(), deleteColumn:chain => chain.deleteColumn(), deleteTable:chain => chain.deleteTable(),
  callout:chain => editor.isActive('callout') ? chain.lift('callout') : chain.wrapIn('callout'),
  alignLeft:chain => chain.setTextAlign('left'), alignCenter:chain => chain.setTextAlign('center'), alignRight:chain => chain.setTextAlign('right'),
  heading2:chain => chain.setHeading({level:2}), heading3:chain => chain.setHeading({level:3}), heading4:chain => chain.setHeading({level:4}),
};
const slashItems = [
  ['heading2','Kop 2'], ['heading3','Kop 3'], ['bulletList','Opsomming'], ['orderedList','Genummerde lijst'], ['taskList','Takenlijst'],
  ['blockquote','Citaat'], ['callout','Uitgelichte tip'], ['image','Afbeelding'], ['table','Tabel'], ['codeBlock','Codeblok'], ['horizontalRule','Scheidingslijn'],
];

function updateToolbar() {
  root.querySelectorAll('[data-command]').forEach(button => {
    const command = button.dataset.command;
    if (activeMarks.has(command)) button.setAttribute('aria-pressed', String(editor.isActive(command)));
    if (command === 'undo' || command === 'redo') button.disabled = !editor.can()[command]();
    if (/^(addRow|addColumn|delete)/.test(command)) button.disabled = !editor.isActive('table');
  });
  $('heading-level').value = editor.isActive('heading') ? String(editor.getAttributes('heading').level) : 'p';
}

function placeMenu(menu, coords, offset) {
  const bounds = root.querySelector('.studio-editor-wrap').getBoundingClientRect();
  const left = Math.max(8, Math.min(coords.left - bounds.left, bounds.width - menu.offsetWidth - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${coords.top - bounds.top + offset}px`;
}

function updateBubble() {
  cancelAnimationFrame(bubbleFrame);
  bubbleFrame = requestAnimationFrame(() => {
    const menu = $('bubble');
    const {from, empty} = editor.state.selection;
    menu.hidden = empty || !editor.isFocused || !editor.state.selection.$from.parent.isTextblock || !editor.state.doc.textBetween(from, editor.state.selection.to).trim();
    if (!menu.hidden) placeMenu(menu, editor.view.coordsAtPos(from), -menu.offsetHeight - 6);
  });
}

function showSlash() {
  const menu = $('slash');
  const {$from, empty} = editor.state.selection;
  const match = empty && $from.parent.type.name === 'paragraph' && /^\/([^\s/]*)$/.exec($from.parent.textBetween(0,$from.parentOffset));
  const from = match ? $from.pos - match[0].length : null;
  const items = match ? slashItems.filter(([, label]) => label.toLowerCase().includes(match[1].toLowerCase())) : [];
  if (!match) slashDismissedAt = null;
  if (!items.length || from === slashDismissedAt) { menu.hidden = true; slash = null; return; }
  const index = slash?.from === from ? Math.min(slash.index,items.length - 1) : 0;
  slash = {from, to:$from.pos, items, index};
  menu.replaceChildren(...items.map(([command, label]) => {
    const button = makeButton(label, '');
    button.dataset.slash = command;
    button.setAttribute('role','option');
    button.tabIndex = -1;
    return button;
  }));
  menu.hidden = false;
  updateSlashSelection();
  const coords = editor.view.coordsAtPos($from.pos);
  placeMenu(menu, coords, coords.bottom - coords.top + 4);
}

function updateSlashSelection() {
  Array.from($('slash').children).forEach((item,index) => item.setAttribute('aria-selected',String(index === slash.index)));
}

function chooseSlash(command) {
  if (!slash) return;
  const {from,to} = slash;
  slash = null;
  $('slash').hidden = true;
  editor.chain().focus().deleteRange({from,to}).run();
  runCommand(command);
}

function handleEditorKeys(_view,event) {
  if (!slash) return false;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    slash.index = (slash.index + (event.key === 'ArrowDown' ? 1 : -1) + slash.items.length) % slash.items.length;
    updateSlashSelection();
    return true;
  }
  if (event.key === 'Enter') { chooseSlash(slash.items[slash.index][0]); return true; }
  if (event.key === 'Escape') { slashDismissedAt = slash.from; $('slash').hidden = true; slash = null; return true; }
  return false;
}

function runCommand(command) {
  $('more').open = false;
  if (command === 'link') { linkDialog(); return; }
  if (command === 'image') { selectMedia('inline'); return; }
  actions[command]?.(editor.chain().focus()).run();
  updateToolbar();
}

function notice(message, error = false, link) {
  const box = $('status');
  box.hidden = !message;
  box.dataset.error = String(error);
  box.textContent = message ?? '';
  if (link) box.append(anchor(link.label,link.href));
}

function setBusy(value) {
  busy = value;
  for (const id of ['new','preview','save','publish','hero-upload','og-upload']) $(id).disabled = value;
}

async function api(suffix = '', options) {
  const headers=new Headers(options?.headers);
  if(options?.body instanceof FormData){const file=options.body.get('file');if(file instanceof File){const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());headers.set('Idempotency-Key','editor-media-'+Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join(''));}}
  const response = await fetch(`${endpoint}${suffix}`, {cache:'no-store',...options,headers,signal:lifecycle.signal});
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const error = new Error(data?.error?.message || data?.error || 'Blogbeheer kan het verzoek niet verwerken.');
    error.status = response.status;
    error.code = data?.error?.code || data?.code;
    error.currentRevision=data?.error?.currentRevision || data?.currentRevision;
    error.field=data?.error?.field || data?.field;
    throw error;
  }
  return data;
}

const operationKeys = new Map();
function postAction(action, fields) {
  const fingerprint=JSON.stringify({action,...fields});
  if(!operationKeys.has(fingerprint))operationKeys.set(fingerprint,crypto.randomUUID());
  return api('', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action,...fields,requestId:operationKeys.get(fingerprint)})}).then(result=>{operationKeys.delete(fingerprint);return result;});
}

function tagValues() {
  return [...new Set($('tags').value.split(',').map(value => value.trim()).filter(Boolean))].slice(0,12);
}

function editorialContent(node, opening = false) {
  if (!node) return node;
  if (node.type === 'image') {
    const {width,displayWidth,...attrs} = node.attrs;
    delete attrs.height;
    return {...node,attrs:opening ? {...attrs,width:displayWidth ?? null,height:null} : {...attrs,displayWidth:width}};
  }
  return node.content ? {...node,content:node.content.map(child => editorialContent(child,opening))} : node;
}

function fieldValues() {
  return {
    id:current.id, title:$('title').value.trim(), excerpt:$('excerpt').value.trim(), slug:slugify($('slug').value),
    type:$('type').value, locale:$('locale').value, author:$('author').value.trim(), category:$('category').value, tags:tagValues(),
    hero:{...hero,alt:$('hero-alt').value.trim(),ratio:$('ratio').value,x:Number($('focus-x').value)/100,y:Number($('focus-y').value)/100},
    social:social || null, seoTitle:$('seo-title').value.trim(), seoDescription:$('seo-description').value.trim(),
    content:editorialContent(editor.getJSON()), featured:Boolean(current.featured), noindex:$('noindex').checked,
  };
}

function changed() {
  if (!current || loadingPost) return;
  dirty = true;
  if (!slugEdited && !current.liveSlug) $('slug').value = slugify($('title').value);
  renderFields();
}

function listPosts() {
  const query = $('search').value.trim().toLowerCase();
  const filter = $('status-filter').value;
  const matching = posts.filter(post => (filter === 'all' || filter === stateOf(post)) && [post.title,post.slug,post.category].some(value => value?.toLowerCase().includes(query)));
  $('post-count').textContent = posts.length;
  $('post-list').replaceChildren(...matching.map(post => {
    const button = makeButton('', 'studio-post');
    button.dataset.id = post.id;
    if (post.id === current?.id) button.setAttribute('aria-current','true');
    const status = stateOf(post);
    const meta = create('small');
    const badge = create('span','studio-badge',states[status]);
    badge.dataset.state = status;
    meta.append(badge,create('span','',post.category));
    button.append(create('strong','',post.title),meta);
    return button;
  }));
  if (!matching.length) $('post-list').append(create('p','studio-empty',posts.length ? 'Geen artikelen bij deze zoekopdracht.' : 'Maak je eerste artikel aan.'));
}

function openPost(post, allowBusy = false, preserveHistory = false) {
  if (busy && !allowBusy) return;
  loadingPost = true;
  current = post || {title:'', excerpt:'', slug:'', type:'blog', locale:'nl-NL', author:'redactie', category:'toernooien', tags:[], status:'draft'};
  hero = {...blankHero,...current.hero};
  social = current.social;
  slugEdited = Boolean(current.liveSlug || current.slug && current.slug !== slugify(current.title));
  savedTime = null;
  dirty = false;
  for (const field of ['title','excerpt','slug','type','locale','author','category']) {
    if (field === 'category' && current.category && !Array.from($(field).options).some(option => option.value === current.category)) $(field).append(new Option(current.category));
    $(field).value = current[field] || '';
  }
  $('tags').value = current.tags?.join(', ') || '';
  $('hero-alt').value = hero.alt || '';
  $('ratio').value = hero.ratio || '4:5';
  $('focus-x').value = (hero.x ?? .5) * 100;
  $('focus-y').value = (hero.y ?? .5) * 100;
  $('seo-title').value = current.seoTitle || '';
  $('seo-description').value = current.seoDescription || '';
  $('noindex').checked = Boolean(current.noindex);
  const document=editorialContent(current.content,true)||{type:'doc',content:[{type:'paragraph'}]};
  if(!preserveHistory||JSON.stringify(editor.getJSON())!==JSON.stringify(document))editor.commands.setContent(document,{emitUpdate:false});
  if(!preserveHistory)editor.view.updateState(EditorState.create({doc:editor.state.doc,plugins:editor.state.plugins}));
  $('workspace').hidden = false;
  loadingPost = false;
  renderFields();
  renderPublishMeta();
  listPosts();
  updateToolbar();
}

function renderImage(id, source, alt = '') {
  const image = $(`${id}-img`);
  const src = safeImage(source);
  image.hidden = !src;
  if (src) image.src = src;
  else image.removeAttribute('src');
  image.alt = alt;
  $(`${id}-thumb`).dataset.empty = String(!src);
}

function renderFields() {
  const title = $('title').value.trim();
  const excerpt = $('excerpt').value.trim();
  const slug = slugify($('slug').value);
  const url = new URL(`/blog/${slug || 'artikel-url'}`,location.origin);
  const seoTitle = $('seo-title').value.trim();
  const seoDescription = $('seo-description').value.trim();
  const displayTitle = seoTitle || (title ? `${title} | DartFlow` : 'Artikeltitel | DartFlow');
  const displayDescription = seoDescription || excerpt || 'De samenvatting of metaomschrijving verschijnt hier.';
  const keyword = tagValues()[0];
  const words = editor.storage.characterCount.words();
  const status = stateOf(current);
  $('current-title').textContent = title || 'Nieuw artikel';
  $('post-status').textContent = states[status];
  $('post-status').dataset.state = status;
  $('save-state').textContent = dirty ? 'Niet-opgeslagen wijzigingen' : savedTime ? `Opgeslagen om ${savedTime}` : current.id ? 'Opgeslagen' : 'Niet opgeslagen';
  $('publish').textContent = status === 'scheduled' ? 'Planning wijzigen' : status === 'published' || status === 'revision' ? 'Revisie publiceren' : 'Publiceren';
  $('url').textContent = url.href;
  $('redirect').hidden = !current.liveSlug || !slug || current.liveSlug === slug;
  $('word-count').textContent = `${words} ${words === 1 ? 'woord' : 'woorden'}`;
  renderImage('hero',hero.src,$('hero-alt').value);
  renderImage('og',social?.src,social?.alt);
  $('hero-clear').hidden = !hero.src;
  $('og-clear').hidden = !social?.src;
  $('hero-thumb').style.aspectRatio = hero.src ? $('ratio').value.replace(':',' / ') : '';
  $('hero-img').style.objectPosition = `${$('focus-x').value}% ${$('focus-y').value}%`;
  $('serp-url').textContent = `${url.host} › blog › ${slug || 'artikel-url'}`;
  $('serp-title').textContent = displayTitle;
  $('serp-description').textContent = displayDescription;
  $('seo-title-count').textContent = `${seoTitle.length} tekens · richtlijn 50–60`;
  $('seo-description-count').textContent = `${seoDescription.length} tekens · richtlijn 120–160`;
  $('keyword').textContent = keyword ? `Zoekterm uit de eerste tag · ${keyword}` : 'Voeg een eerste tag toe om de zoekterm te controleren.';
  $('checks').replaceChildren(...[
    [displayTitle.length >= 35 && displayTitle.length <= 64,'Zoektitel is kort genoeg voor de meeste weergaven.'],
    [displayDescription.length >= 100 && displayDescription.length <= 160,'Metaomschrijving is tussen 100 en 160 tekens.'],
    [!!hero.src && !!$('hero-alt').value.trim(),'Hero heeft een beschrijvende alt-tekst.'],
    [!!keyword && `${title} ${seoTitle}`.toLowerCase().includes(keyword.toLowerCase()),'De eerste tag komt terug in een titel.'],
    [editor.getJSON().content?.some(node => node.type === 'heading' && node.attrs?.level === 2),'De tekst heeft een kop op niveau 2.'],
  ].map(([ok,label]) => { const line = create('p','',label); line.dataset.pass = String(Boolean(ok)); return line; }));
  $('social-image').src = safeImage(social?.src || hero.src) || defaultImage;
  $('social-image').style.objectPosition = social?.src ? 'center' : $('hero-img').style.objectPosition;
  $('social-image').hidden = false;
  $('social-host').textContent = url.host;
  $('social-title').textContent = displayTitle;
  $('social-description').textContent = displayDescription;
}

function renderPublishMeta() {
  const parent = $('publish-meta');
  parent.replaceChildren();
  if (!current?.id) return;
  if (current.publishedAt) parent.append(create('p','',`Voor het eerst gepubliceerd op ${dateFormat.format(new Date(current.publishedAt))}.`));
  if (current.publicUrl) parent.append(anchor('Open live artikel ↗',current.publicUrl));
  if (current.scheduledAt) {
    parent.append(create('p','',`Gepland op ${dateFormat.format(new Date(current.scheduledAt))} (Nederlandse tijd).`));
    const button = makeButton('Planning annuleren','studio-text-button');
    button.addEventListener('click', () => changePublication('unschedule'));
    parent.append(button);
  }
  if (current.hasUnpublishedChanges) parent.append(create('p','','De openbare revisie blijft zichtbaar tot je het concept publiceert.'));
  const history = makeButton('Revisiegeschiedenis','studio-text-button');
  history.addEventListener('click',()=>execute(showRevisionHistory));parent.append(history);
  const archive = makeButton('Artikel archiveren','studio-text-button');
  archive.addEventListener('click', archiveDialog);
  parent.append(archive);
}

function acceptPost(post) {
  const index = posts.findIndex(item => item.id === post.id);
  if (index < 0) posts.unshift(post);
  else posts[index] = post;
  openPost(post,true,true);
  savedTime = new Intl.DateTimeFormat('nl-NL',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Amsterdam'}).format(new Date());
  $('slug').value = post.slug;
  renderFields();
  renderPublishMeta();
  listPosts();
}

async function savePost() {
  if (!dirty && current.id && current.revision != null) return current;
  const post = fieldValues();
  if (!post.title || !post.slug) throw new Error('Vul een titel en een geldige slug in om op te slaan.');
  const {post:saved} = await postAction('save',{post,revision:current.revision ?? null});
  acceptPost(saved);
  return saved;
}

async function withBusy(operation) {
  if (busy) return;
  setBusy(true);
  editor.setEditable(false, false);
  fieldNames.forEach(id => { $(id).disabled = true; });
  try { return await operation(); }
  finally {
    setBusy(false);
    editor.setEditable(true, false);
    fieldNames.forEach(id => { $(id).disabled = false; });
    updateToolbar();
  }
}

function execute(operation) {
  return withBusy(operation).catch(handleEditorError);
}


function handleEditorError(error) {
  if(error.name==='AbortError')return;
  notice(error.message,true);
  const fields={title:'title',slug:'slug',excerpt:'excerpt','hero.alt':'hero-alt',hero:'hero-alt','seo.title':'seo-title','seo.description':'seo-description',authorId:'author',categoryId:'category',content:'editor'};
  const field=fields[error.field]&&$(fields[error.field]);
  if(field){root.querySelectorAll('.studio-field-error').forEach(node=>node.remove());const message=create('p','studio-field-error',error.message);message.id='studio-field-error';message.setAttribute('role','alert');field.setAttribute('aria-invalid','true');field.setAttribute('aria-describedby',message.id);field.insertAdjacentElement('afterend',message);field.focus();listen(field,'input',()=>{field.removeAttribute('aria-invalid');field.removeAttribute('aria-describedby');message.remove();});}
  if(error.code!=='REVISION_CONFLICT')return;
  const compare=makeButton('Conflict herstellen','studio-text-button');
  compare.addEventListener('click',()=>{
    const saved=makeButton('Nieuwste versie laden','button button-outline button-small');
    saved.addEventListener('click',()=>{
      if(!confirm('Je huidige invoer vervangen door de opgeslagen revisie?'))return;
      const selectedId=current.id;$('dialog').close();execute(async()=>{const fresh=await api();posts=fresh.posts;return posts.find(p=>p.id===selectedId);}).then(post=>{if(post)openPost(post);});
    });
    const keep=submitButton('Mijn invoer als nieuwe revisie bewaren');
    dialog('Er is een nieuwere revisie',[
      create('p','','Je invoer is behouden. Bekijk de actuele opgeslagen revisie voordat je kiest welke tekst je wilt bewaren.'),
      anchor('Bekijk opgeslagen revisie',`/blog/beheer/voorbeeld/${current.id}`),
    ],[cancelButton(),saved,keep],()=>{
      if(!Number.isInteger(error.currentRevision)){dialogError('Laad eerst de nieuwste versie of bewaar je tekst lokaal.');return;}
      current.revision=error.currentRevision;dirty=true;$('dialog').close();execute(async()=>{await savePost();notice('Je invoer is als nieuwe revisie opgeslagen.');});
    });
  });
  $('status').append(compare);
}
async function showRevisionHistory(){
  const {revisions}=await api(`?action=revisions&id=${encodeURIComponent(current.id)}`);
  const list=create('div','studio-revision-list');
  revisions.forEach(item=>{
    const line=create('p','',`Revisie ${item.revision} · ${dateFormat.format(new Date(item.createdAt))} `);
    line.append(anchor('Bekijken',`/blog/beheer/voorbeeld/${current.id}?revisie=${item.revision}`));
    const restore=makeButton('Als concept herstellen','studio-text-button');
    restore.addEventListener('click',()=>{
      if(dirty&&!confirm('Niet-opgeslagen invoer vervangen door deze revisie?'))return;
      $('dialog').close();execute(async()=>{const {post}=await postAction('restore',{id:current.id,revision:current.revision,restoreRevision:item.revision});return post;}).then(post=>{if(post){openPost(post);notice('Revisie hersteld als nieuw concept; de liveversie is behouden.');}});
    });line.append(restore);list.append(line);
  });
  dialog('Revisiegeschiedenis',[list],[cancelButton()]);
}

function showPreview() {
  const popup = window.open('about:blank','_blank');
  if (popup) popup.opener = null;
  withBusy(async () => {
    const post = current.id && !dirty ? current : await savePost();
    const href = `/blog/beheer/voorbeeld/${encodeURIComponent(post.id)}`;
    if (popup) popup.location.replace(href);
    else notice('Je preview is klaar.',false,{label:'Open afgeschermde preview',href});
  }).catch(error => { popup?.close(); notice(error.message,true); });
}

function dialog(title, children, actions, submit) {
  $('dialog-title').textContent = title;
  $('dialog-content').replaceChildren(...children);
  $('dialog-actions').replaceChildren(...actions);
  $('dialog-error').hidden = true;
  $('dialog-form').onsubmit = event => {
    event.preventDefault();
    if (submit) submit();
  };
  $('dialog').showModal();
}

function dialogError(message) {
  $('dialog-error').textContent = message;
  $('dialog-error').hidden = false;
}

function cancelButton() {
  const button = makeButton('Annuleren');
  button.addEventListener('click', () => $('dialog').close());
  return button;
}

function dialogField(label, input) {
  const field = create('label','studio-field',label);
  field.append(input);
  return field;
}

function submitButton(label) {
  const button = makeButton(label,'button button-primary button-small');
  button.type = 'submit';
  return button;
}

function linkDialog() {
  const previous = editor.getAttributes('link').href || '';
  const input = create('input');
  input.type = 'text';
  input.value = previous;
  input.placeholder = '/blog of https://voorbeeld.nl';
  input.maxLength = 1000;
  const actions = [cancelButton(),submitButton('Link toepassen')];
  if (previous) {
    const remove = makeButton('Verwijderen');
    remove.addEventListener('click', () => {
      $('dialog').close();
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    });
    actions.splice(1,0,remove);
  }
  dialog('Link toevoegen',[dialogField('Webadres',input)],actions,() => {
    const href = input.value.trim();
    if (!links.test(href) || href.includes('\\')) {
      dialogError('Gebruik een geldig webadres, e-mailadres of relatief pad.');
      return;
    }
    $('dialog').close();
    const chain = editor.chain().focus().extendMarkRange('link').setLink({href});
    if (editor.state.selection.empty && !previous) chain.insertContent(href);
    chain.run();
  });
  input.focus();
}

function selectMedia(target) {
  mediaTarget = target;
  $('file').value = '';
  $('file').click();
}

function handleMedia() {
  const [file] = $('file').files;
  if (!file) return;
  const target = mediaTarget;
  const alt = create('input');
  alt.type = 'text';
  alt.maxLength = 240;
  alt.placeholder = 'Beschrijf wat op de afbeelding staat';
  const doUpload = () => {
    $('dialog').close();
    execute(async () => {
      const form = new FormData();
      form.append('file',file);
      const {assetId,src,width,height} = await api('/media',{method:'POST',body:form});
      const asset = {assetId,src:new URL(src,location.origin).pathname,width,height,alt:alt.value.trim()};
      if (target === 'hero') {
        hero = {...blankHero,...asset};
        $('hero-alt').value = asset.alt;
        $('focus-x').value = 50;
        $('focus-y').value = 50;
      } else if (target === 'social') {
        social = asset;
      } else {
        editor.commands.setImage({assetId,src,alt:asset.alt});
      }
      changed();
      notice('Afbeelding toegevoegd. Sla het concept op om de wijziging te bewaren.');
    }).finally(() => { if (target === 'inline') editor.commands.focus(); });
  };
  if (target === 'hero' || target === 'inline') alt.required = true;
  dialog('Afbeelding toevoegen',[create('p','',file.name),dialogField('Alt-tekst',alt)],[cancelButton(),submitButton('Uploaden')],doUpload);
  alt.focus();
}

function toAmsterdamTime(value) {
  const wallTime = new Date(`${value}Z`).getTime();
  if (!Number.isFinite(wallTime)) throw new Error('Kies een geldige datum en tijd.');
  const possible = [1,2].map(offset => new Date(wallTime - offset * 3600000)).filter(candidate => dateParts.format(candidate).replace(' ','T') === value);
  if (possible.length !== 1) throw new Error('Kies een ander tijdstip. Deze tijd komt door de omschakeling van zomer- of wintertijd niet één keer voor.');
  if (possible[0].getTime() <= Date.now()) throw new Error('Kies een tijdstip in de toekomst.');
  return possible[0].toISOString();
}

function publicationDialog() {
  const timing = create('input');
  timing.type = 'datetime-local';
  if (current.scheduledAt) timing.value = dateParts.format(new Date(current.scheduledAt)).replace(' ','T');
  const publish = makeButton('Nu publiceren','button button-primary button-small');
  const schedule = submitButton('Inplannen');
  schedule.disabled=!dirty&&current.liveRevision===current.revision&&current.status!=='archived';
  if(schedule.disabled)schedule.title='Sla eerst een nieuw concept op; deze revisie staat al live.';
  publish.addEventListener('click', () => {
    $('dialog').close();
    changePublication('publish');
  });
  dialog('Publiceren',[
    create('p','',current.liveRevision != null ? 'Vervang de openbare versie door dit concept.' : 'Zet dit artikel nu online of kies een publicatiemoment.'),
    dialogField('Inplannen · Nederlandse tijd',timing),
  ],[cancelButton(),schedule,publish],() => {
    try {
      const scheduledAt = toAmsterdamTime(timing.value);
      $('dialog').close();
      changePublication('schedule',scheduledAt);
    } catch (error) { dialogError(error.message); }
  });
}

function changePublication(action, scheduledAt) {
  return execute(async () => {
    const ready = action === 'unschedule' ? current : await savePost();
    const editingRevision=current.revision;
    const {post} = await postAction(action,{id:ready.id,revision:ready.revision ?? null,...(scheduledAt ? {scheduledAt} : {})});
    if (action === 'unschedule' && dirty) {
      const index = posts.findIndex(item => item.id === post.id);
      posts[index] = post;
      current = {...post,revision:editingRevision};
      renderFields();
      renderPublishMeta();
      listPosts();
    } else acceptPost(post);
    if (action === 'publish') notice('Het artikel is gepubliceerd.',false,post.publicUrl && {label:'Open live artikel',href:post.publicUrl});
    if (action === 'schedule') notice(`Publicatie ingepland op ${dateFormat.format(new Date(scheduledAt))} (Nederlandse tijd).`);
    if (action === 'unschedule') notice('De publicatieplanning is geannuleerd.');
  });
}

function archiveDialog() {
  dialog('Artikel archiveren',[create('p','','Het artikel verdwijnt uit het blogoverzicht en de openbare URL is daarna niet meer beschikbaar.')],
    [cancelButton(),submitButton('Archiveren')],() => {
      $('dialog').close();
      let archived = false;
      execute(async () => {
        await postAction('archive',{id:current.id,revision:current.revision ?? null});
        posts = posts.filter(post => post.id !== current.id);
        archived = true;
        notice('Het artikel is gearchiveerd.');
      }).finally(() => { if (archived) openPost(posts[0]); });
    });
}

function renderConnection(message) {
  const box = $('connection');
  if (message) { box.textContent = message; return; }
  const ready = Boolean(connection?.configured && connection?.enabled);
  const badge = create('strong','',ready ? 'Website-API actief' : connection?.configured ? 'Website-API gepauzeerd' : 'Website-API wacht op configuratie');
  badge.dataset.ready = String(ready);
  box.replaceChildren(badge);
  if (connection?.environment) box.append(create('p','',`Omgeving · ${connection.environment}`));
  if (capabilities?.blogPath) box.append(create('p','',`Blogpad · ${capabilities.blogPath}`));
  if (connection?.endpoint) {
    const label = create('p','',connection.endpoint);
    const copy = makeButton('Kopieer API-adres','studio-text-button');
    copy.addEventListener('click',async () => {
      try { await navigator.clipboard.writeText(connection.endpoint); copy.textContent = 'API-adres gekopieerd'; }
      catch { copy.textContent = 'Selecteer het API-adres hierboven'; }
    });
    box.append(label,copy);
  }
}

async function readConnection() {
  $('test-connection').disabled = true;
  renderConnection('Website-API controleren…');
  try {
    ({socialHero:connection,capabilities} = await api('?action=capabilities'));
    renderConnection();
  } catch (error) { renderConnection(error.message); }
  finally { $('test-connection').disabled = false; }
}

function chooseTab(tab, focus = false) {
  root.querySelectorAll('[data-tab]').forEach(button => {
    const selected = button.dataset.tab === tab;
    button.setAttribute('aria-selected',String(selected));
    button.tabIndex = selected ? 0 : -1;
    $(`panel-${button.dataset.tab}`).hidden = !selected;
    if (selected && focus) button.focus();
  });
}

function initListeners() {
  const tools = root.querySelector('.studio-toolbar');
  const bubble = $('bubble');
  for (const command of ['bold','italic','link']) {
    const source = tools.querySelector(`[data-command="${command}"]`);
    bubble.append(source.cloneNode(true));
  }
  [tools,bubble].forEach(element => {
    element.addEventListener('mousedown',event => { if (event.target.closest('button[data-command]')) event.preventDefault(); });
    element.addEventListener('click',event => {
      const command = event.target.closest('button[data-command]')?.dataset.command;
      if (command) runCommand(command);
    });
  });
  $('slash').addEventListener('mousedown',event => event.preventDefault());
  $('slash').addEventListener('click',event => { const item = event.target.closest('button[data-slash]'); if (item) chooseSlash(item.dataset.slash); });
  $('heading-level').addEventListener('change',event => {
    if (event.target.value === 'p') editor.chain().focus().setParagraph().run();
    else runCommand(`heading${event.target.value}`);
  });
  for (const id of fieldNames) $(id).addEventListener('input',() => { if (id === 'slug') slugEdited = Boolean($('slug').value); changed(); });
  $('slug').addEventListener('blur',() => { $('slug').value = slugify($('slug').value); });
  $('search').addEventListener('input',listPosts);
  $('status-filter').addEventListener('change',listPosts);
  $('new').addEventListener('click',() => {
    if (dirty && !confirm('Niet-opgeslagen wijzigingen laten vervallen?')) return;
    openPost();
    chooseTab('article');
    $('title').focus();
  });
  $('post-list').addEventListener('click',event => {
    const id = event.target.closest('[data-id]')?.dataset.id;
    if (!id || id === current?.id || busy || dirty && !confirm('Niet-opgeslagen wijzigingen laten vervallen?')) return;
    openPost(posts.find(post => post.id === id));
    notice('');
  });
  $('save').addEventListener('click',() => execute(async () => { await savePost(); notice('Het concept is opgeslagen.'); }));
  $('publish').addEventListener('click',publicationDialog);
  $('preview').addEventListener('click',showPreview);
  $('dialog-close').addEventListener('click',() => $('dialog').close());
  $('hero-upload').addEventListener('click',() => selectMedia('hero'));
  $('og-upload').addEventListener('click',() => selectMedia('social'));
  $('hero-clear').addEventListener('click',() => { hero = {...blankHero}; $('hero-alt').value = ''; changed(); });
  $('og-clear').addEventListener('click',() => { social = null; changed(); });
  $('file').addEventListener('change',handleMedia);
  $('test-connection').addEventListener('click',readConnection);
  const tabs = [...root.querySelectorAll('[data-tab]')];
  tabs.forEach((button,index) => {
    button.addEventListener('click',() => chooseTab(button.dataset.tab));
    button.addEventListener('keydown',event => {
      const {key} = event;
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(key)) return;
      event.preventDefault();
      const next = key === 'Home' ? 0 : key === 'End' ? tabs.length - 1 : (index + (key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
      chooseTab(tabs[next].dataset.tab,true);
    });
  });
  listen(window,'beforeunload',event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
}

async function boot() {
  initListeners();
  try {
    const initial = await api();
    ({posts,socialHero:connection} = initial);
    $('category').replaceChildren(...initial.categories.map(item=>new Option(item.name,item.id)));
    $('author').replaceChildren(...initial.authors.map(item=>new Option(item.name,item.id)));
    renderConnection();
    $('grid').hidden = false;
    $('new').disabled = false;
    openPost(posts[0]);
  } catch (error) {
    const login = '/inloggen?next=%2Fblog%2Fbeheer';
    notice(error.message,true,error.status === 401 ? {label:'Inloggen',href:login} : undefined);
  } finally { $('loading').hidden = true; }
}

boot();
return () => { lifecycle.abort();cancelAnimationFrame(bubbleFrame);editor.destroy();root.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close()); };
}
