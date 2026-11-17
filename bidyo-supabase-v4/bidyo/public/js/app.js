'use strict';
/* Bidyo front-end: tiny hash-routed SPA, no build step, no dependencies.
   All user text is inserted with textContent (via h()), never innerHTML, so it is XSS-safe.
   Smoothness rules: only animate opacity/transform, render long lists in chunks, cache lists (stale-while-revalidate). */

/* ============================ helpers ============================ */
const app = document.getElementById('app');
const CFG = window.BIDYO_CONFIG || {};
const MIN_AGE = 13;
const state = { me: null, config: { formats: ['.mp4', '.webm', '.mov'], maxUploadMb: CFG.MAX_UPLOAD_MB || 50 }, next: null };
let cleanup = [];                       // functions to run when leaving a page
const onLeave = fn => cleanup.push(fn);
let navId = 0;                          // bumps on every navigation so late async results can be ignored
const REDUCE = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(.2,.7,.2,1)';
/* Web Animations helper: compositor-only (opacity/transform), skipped for people who prefer reduced motion. */
const anim = (el, frames, opts) => { if (!REDUCE && el && el.animate) el.animate(frames, { duration: 260, easing: EASE, ...opts }); };

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;        // only ever used with static icon strings below
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.6c0-1.1 1.2-1.8 2.1-1.2l10.2 6.6c.9.6.9 1.8 0 2.4L9.1 19.0C8.2 19.6 7 18.9 7 17.8z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="4.5" height="16" rx="1.5"/><rect x="13.5" y="4" width="4.5" height="16" rx="1.5"/></svg>',
  vol: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 4V5L7 9z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 4V5L7 9z"/><path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  full: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5v2H6v3zm11-5h5v5h-2V6h-3zM4 15h2v3h3v2H4zm14 0h2v5h-5v-2h3z"/></svg>',
  shield: '<svg viewBox="0 0 32 32" fill="none" stroke="#1B1340" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3l11 4v8c0 7-4.6 11.6-11 14C9.6 26.6 5 22 5 15V7z"/><path d="M11 16l3.8 3.8L21.5 12"/></svg>',
  upload: '<svg viewBox="0 0 48 48" fill="none" stroke="#1B1340" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M24 34V10M14 19l10-10 10 10M12 41h24"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#1B1340" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg>',
};
const icon = (name, cls) => h('span', { class: cls || 'ico-wrap', html: ICON[name], style: 'display:contents' });

function toast(msg, isErr) {
  const box = document.getElementById('toasts');
  while (box.children.length >= 3) box.firstChild.remove();
  const t = h('div', { class: 'toast' + (isErr ? ' err' : '') }, msg);
  box.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 220); }, 3800);
}


/* ============================ Supabase data layer ============================ */
const BUCKET = 'videos';
let sb = null;
if (window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) {
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  try { document.head.append(h('link', { rel: 'preconnect', href: CFG.SUPABASE_URL, crossorigin: '' })); } catch {}   // warm up the connection
}
const fail = (error, fallback) => { if (error) throw Object.assign(new Error(error.message || fallback || 'Something went wrong.'), { status: error.status || 0 }); };
const pubUrl = p => (p ? sb.storage.from(BUCKET).getPublicUrl(p).data.publicUrl : null);

/* ---- age / birthday ---- */
function parseDay(iso) {                       // 'YYYY-MM-DD' -> {y,m,d} or null (also rejects 2023-02-31)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? { y, m: mo, d } : null;
}
function ageFrom(iso) {
  const p = parseDay(iso); if (!p) return NaN;
  const t = new Date(); let a = t.getFullYear() - p.y;
  if (t.getMonth() + 1 < p.m || (t.getMonth() + 1 === p.m && t.getDate() < p.d)) a--;
  return a;
}

function toUser(u) {
  if (!u) return null;
  const md = u.user_metadata || {};
  const name = md.username || (u.email || 'user').split('@')[0];
  const age = md.birthday ? ageFrom(md.birthday) : NaN;
  return { id: u.id, email: u.email, name, initial: (name[0] || '?').toUpperCase(), birthday: md.birthday || '', age: Number.isFinite(age) ? age : null };
}
const LIST_COLS = 'id,user_id,creator_name,title,status,file_path,thumb_path,size,duration,views,created_at';   // no description: keeps lists light
function toVideo(r, viewer) {
  const name = r.creator_name || '?';
  return {
    id: r.id, title: r.title, description: r.description || '', duration: r.duration || 0, views: Number(r.views) || 0,
    createdAt: new Date(r.created_at).getTime(), status: r.status, size: r.size, filePath: r.file_path, thumbPath: r.thumb_path,
    thumbUrl: pubUrl(r.thumb_path), hasThumb: !!r.thumb_path,
    creator: { name, initial: (name[0] || '?').toUpperCase() },
    mine: !!(viewer && viewer.id === r.user_id),
  };
}

/* ---- video list cache (stale-while-revalidate): going back to a page is instant, fresh data swaps in quietly ---- */
const vcache = new Map();                      // search text -> { at, data }
const FRESH_MS = 20000;
async function fetchList(q, limit) {
  if (!sb) throw new Error('Supabase is not configured. Fill in SUPABASE_URL and SUPABASE_ANON_KEY in .env, then restart.');
  let query = sb.from('videos').select(LIST_COLS).eq('status', 'published').order('created_at', { ascending: false }).limit(limit);
  if (q) { const safe = q.replace(/[%_,()*\\]/g, ' ').trim(); if (safe) query = query.or(`title.ilike.%${safe}%,description.ilike.%${safe}%`); }
  const { data, error } = await query; fail(error, "Can't load videos");
  return data.map(r => toVideo(r, state.me));
}
/* apply(videos) runs once with cached data (if any) and again when fresh data arrives. Rejects only if nothing could be shown. */
async function listVideos(q, apply, limit = 300) {
  const hit = vcache.get(q);
  if (hit) apply(hit.data, false);
  if (hit && Date.now() - hit.at < FRESH_MS) return;
  try {
    const data = await fetchList(q, limit);
    vcache.set(q, { at: Date.now(), data });
    if (vcache.size > 8) vcache.delete(vcache.keys().next().value);
    apply(data, true);
  } catch (e) { if (!hit) throw e; }
}
const findCached = id => { for (const c of vcache.values()) { const v = c.data.find(x => x.id === id); if (v) return v; } return null; };

async function getVideo(id) {
  const { data, error } = await sb.from('videos').select('*').eq('id', id).maybeSingle(); fail(error);
  if (!data) throw new Error('Video not found');
  return toVideo(data, state.me);
}
async function myVideos() {
  const { data, error } = await sb.from('videos').select(LIST_COLS).eq('user_id', state.me.id).order('created_at', { ascending: false }); fail(error);
  return data.map(r => toVideo(r, state.me));
}
function countView(id) {
  try { const k = 'bidyo_seen_' + id; if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1'); } catch {}
  sb.rpc('increment_views', { vid: id }).then(() => {}, () => {});
}

/* ---- accounts: username + email + password (+ age & birthday). No codes, no email verification. ---- */
function authError(e) {
  const m = e.message || '';
  let msg = m, code = '';
  if (e.status === 429 || /rate limit|too many|seconds/i.test(m)) msg = 'Too many tries. Please wait a minute and try again.';
  else if (/already (been )?registered|already exists/i.test(m)) { msg = 'That email already has an account. Try logging in instead.'; code = 'exists'; }
  else if (/database error/i.test(m)) { msg = 'That username is already taken. Please pick another one.'; code = 'username'; }
  else if (/invalid login credentials/i.test(m)) msg = 'Wrong email or password.';
  else if (/not confirmed/i.test(m)) msg = 'Email confirmation is still ON in Supabase. Turn off "Confirm email" (see README).';
  else if (/password/i.test(m) && /(short|least|weak|characters)/i.test(m)) msg = 'Password is too weak. Use at least 8 characters.';
  else if (/invalid.*email|email.*invalid|unable to validate email/i.test(m)) msg = "That email address doesn't look right.";
  else if (/failed to fetch|network/i.test(m)) msg = 'No connection. Check your internet and try again.';
  return Object.assign(new Error(msg), { code });
}
async function usernameAvailable(u) {
  try { const { data, error } = await sb.rpc('username_available', { uname: u }); return error ? true : data !== false; } catch { return true; }
}
async function registerAccount({ username, email, password, birthday, age }) {
  if (!sb) throw new Error('Supabase is not configured yet (see README).');
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username, birthday, age } } });
  if (error) throw authError(error);
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw authError({ message: 'User already registered' });
  let session = data.session;
  if (!session) {                                 // only happens if "Confirm email" is still on in Supabase
    const r = await sb.auth.signInWithPassword({ email, password });
    if (r.error) throw authError({ message: 'not confirmed' });
    session = r.data.session;
  }
  return toUser(session.user);
}
async function signIn(email, password) {
  if (!sb) throw new Error('Supabase is not configured yet (see README).');
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw authError(error);
  return toUser(data.user);
}

async function removeVideoFiles(v) { await sb.storage.from(BUCKET).remove([v.filePath, v.thumbPath].filter(Boolean)); }
const fmtTime = s => { s = Math.max(0, Math.floor(s || 0)); const m = Math.floor(s / 60), r = s % 60; return `${m}:${String(r).padStart(2, '0')}`; };
const fmtViews = n => n === 1 ? '1 view' : `${n.toLocaleString()} views`;
const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.ceil(b / 1024) + ' KB';
const colorOf = id => parseInt(id.slice(0, 4), 16) % 4;

/* ============================ shared pieces ============================ */
function brand() {
  return h('a', { class: 'brand', href: '#/', 'aria-label': 'Bidyo home' }, h('img', { src: '/img/logo.svg', alt: '' }), h('span', {}, 'bidy', h('b', {}, 'o')));
}

const fmtAgo = ms => {
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  const u = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [n, name] of u) if (s >= n) { const c = Math.floor(s / n); return `${c} ${name}${c > 1 ? 's' : ''} ago`; }
  return 'just now';
};

function userMenu() {
  const wrap = h('div', { class: 'menu' });
  const pop = h('div', { class: 'menu-pop', hidden: true },
    h('p', {}, h('b', { class: 'who' }, '@' + state.me.name), h('br'), state.me.email),
    h('div', { class: 'row' },
      h('a', { class: 'btn sm sunny', href: '#/upload' }, 'Upload a video'),
      h('button', { class: 'btn sm ghost', onclick: logout }, 'Log out')));
  const btn = h('button', { class: 'avatar', 'aria-label': 'Account menu', 'aria-expanded': 'false', onclick: e => { e.stopPropagation(); pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden)); } }, state.me.initial);
  const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  document.addEventListener('click', close); onLeave(() => document.removeEventListener('click', close));
  pop.addEventListener('click', e => e.stopPropagation());
  wrap.append(btn, pop);
  return wrap;
}

function topbar({ light = false, search = true, nav = true, back = false } = {}) {
  const cur = location.hash || '#/';
  const bar = h('header', { class: 'topbar' + (light ? ' light' : '') }, brand());
  const tabs = [['#/latest', 'Latest'], ['#/old', 'Oldest'], ['#/', 'Overall']];
  if (nav) bar.append(h('nav', { class: 'nav', 'aria-label': 'Browse' }, tabs.map(([href, label]) => h('a', { href, 'aria-current': cur === href || (href === '#/' && cur === '#') ? 'page' : null }, label))));
  if (search) {
    const input = h('input', { type: 'search', placeholder: 'Search videos', 'aria-label': 'Search videos', maxlength: '80', value: cur.startsWith('#/search/') ? decodeURIComponent(cur.slice(9)) : '' });
    bar.append(h('div', { class: 'spacer' }), h('form', { class: 'search', role: 'search', onsubmit: e => { e.preventDefault(); const q = input.value.trim(); location.hash = q ? `#/search/${encodeURIComponent(q)}` : '#/'; } }, input));
  } else bar.append(h('div', { class: 'spacer' }));
  if (back) bar.append(h('a', { class: 'nav-back', href: '#/', style: 'font-weight:800;text-decoration:none;white-space:nowrap' }, '← Back to browsing'));
  if (state.me) {
    if (light) bar.append(h('div', { class: 'badges' }, h('span', { class: 'badge' }, icon('check'), h('span', { class: 'badge-name' }, state.me.name))));
    else bar.append(h('a', { class: 'btn sm sunny long', href: '#/upload' }, 'Upload'));
    bar.append(userMenu());
  } else {
    bar.append(h('a', { class: 'btn sm ghost long', href: '#/register' }, 'Sign up'), h('a', { class: 'btn sunny sm', href: '#/login' }, 'Sign in to upload'));
  }
  return bar;
}

function thumb(v, { big } = {}) {
  const t = h('div', { class: `thumb c${colorOf(v.id)}${v.hasThumb ? ' has-shot' : ''}` });
  if (v.thumbUrl) t.append(h('img', { class: 'shot', src: v.thumbUrl, alt: '', loading: 'lazy', decoding: 'async' }));
  const pw = h('span', { html: ICON.play, style: 'display:contents' });
  pw.firstChild.classList.add('play');
  t.append(pw);
  if (v.duration > 0 && !big) t.append(h('span', { class: 'dur' }, fmtTime(v.duration)));
  return t;
}
function tile(v, i) {
  const a = h('a', { class: 'tile' + (i != null ? ' rise' : ''), href: `#/watch/${v.id}`, title: v.title }, thumb(v), h('span', { class: 't' }, v.title), h('span', { class: 'm' }, `${v.creator.name} · ${fmtViews(v.views)} · ${fmtAgo(v.createdAt)}`));
  if (i != null) a.style.setProperty('--i', i);
  return a;
}
const skeletonGrid = () => h('div', { class: 'grid' }, [1, 2, 3, 4, 5, 6, 7, 8].map(() => h('div', { class: 'skeleton', style: 'flex:none' })));
function ctaBox(title, text) {
  return h('section', { class: 'cta' },
    h('div', {}, h('h3', {}, title), h('p', {}, text)),
    h('a', { class: 'btn coral', style: '--sh:var(--sunny)', href: state.me ? '#/upload' : '#/login' }, state.me ? 'Upload a video' : 'Sign in to upload'));
}
/* Swap the whole page. The new content fades/slides in (transform + opacity only); the top bar stays put. */
function setPage(theme, ...nodes) {
  document.body.className = theme;
  app.replaceChildren(...nodes);
  window.scrollTo(0, 0);
  for (const n of nodes) if (!n.classList.contains('topbar')) anim(n, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }]);
}
function setTitle(t) { document.title = t ? `${t} · Bidyo` : 'Bidyo — Upload. Share. Have fun!'; }

/* ============================ pages ============================ */
const SORTS = [['popular', 'Popular'], ['latest', 'Latest'], ['old', 'Oldest'], ['name', 'Name']];
const sorter = {
  popular: (a, b) => b.views - a.views || b.createdAt - a.createdAt,
  latest: (a, b) => b.createdAt - a.createdAt,
  old: (a, b) => a.createdAt - b.createdAt,
  name: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
};
const sig = vs => vs.map(v => v.id + ':' + v.views).join('|');
const CHUNK = 36;

/* One page for: All videos (#/), Latest (#/latest), Old (#/old) and search results. The chips re-sort what is loaded.
   Tiles are drawn 36 at a time (infinite scroll) so even hundreds of videos never make the page heavy. */
async function pageBrowse({ title, sort, q = '', hero = false }) {
  setTitle(q ? title : '');
  const nav = navId;
  const hdr = h('div', {}), grid = h('div', {});
  setPage('dark', topbar(), h('main', { class: 'page' }, hdr, grid));
  if (!vcache.has(q)) grid.append(skeletonGrid());

  let cur = sort, shownSig = null;
  const paint = videos => {
    if (nav !== navId) return;
    const s = sig(videos); if (s === shownSig) return; shownSig = s;
    hdr.replaceChildren();
    if (!videos.length) {
      if (hero && !q) hdr.append(h('section', { class: 'hero' },
        h('div', {}, h('span', { class: 'pill' }, 'Welcome'), h('h1', {}, 'Upload. Share. Have fun!'),
          h('p', {}, 'Everything here is free to watch, no account needed. Be the first to share a video!'),
          h('a', { class: 'btn', href: state.me ? '#/upload' : '#/register' }, state.me ? 'Upload a video' : 'Create a free account'))));
      grid.replaceChildren(h('div', { class: 'empty', style: 'margin-top:40px' }, h('h3', {}, q ? 'Nothing found' : 'No videos yet'), h('p', {}, q ? 'Try a different search.' : 'Published videos will show up here.')));
      return;
    }
    if (hero && !q) {
      const f = [...videos].sort(sorter.popular)[0];
      hdr.append(h('section', { class: 'hero' },
        h('div', {}, h('span', { class: 'pill' }, 'Featured today'), h('h1', {}, f.title),
          h('p', {}, 'Press play and enjoy. Everything here is free to watch, no account needed.'),
          h('a', { class: 'btn', href: `#/watch/${f.id}` }, h('span', { html: ICON.play, style: 'display:inline-flex;width:18px;fill:#1B1340' }), 'Watch now')),
        h('a', { class: 'art', href: `#/watch/${f.id}`, 'aria-label': `Watch ${f.title}` }, thumb(f, { big: true }))));
    }
    const count = h('span', { class: 'count' }, `${videos.length} video${videos.length === 1 ? '' : 's'}`);
    const chips = h('div', { class: 'sortbar', role: 'group', 'aria-label': 'Sort videos' });
    const list = h('div', { class: 'grid' });
    const sentinel = h('div', { class: 'sentinel', 'aria-hidden': 'true' });
    let sorted = [], shown = 0, io = null;
    const more = () => {
      const frag = document.createDocumentFragment();
      sorted.slice(shown, shown + CHUNK).forEach((v, i) => frag.append(tile(v, shown === 0 && i < 12 ? i : null)));
      shown += CHUNK; list.append(frag);
      if (shown >= sorted.length) { sentinel.remove(); if (io) io.disconnect(); }
      else if (io) { io.unobserve(sentinel); io.observe(sentinel); }       // re-check: sentinel may still be on screen
    };
    const draw = (animate) => {
      chips.replaceChildren(...SORTS.map(([k, label]) => h('button', { type: 'button', class: 'sortchip', 'aria-pressed': String(k === cur), onclick: () => { cur = k; draw(true); } }, label)));
      sorted = [...videos].sort(sorter[cur]); shown = 0; list.replaceChildren();
      if (sorted.length > CHUNK && !sentinel.isConnected) list.after(sentinel);
      more();
      if (animate) anim(list, [{ opacity: 0.2 }, { opacity: 1 }], { duration: 180 });
    };
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting) && shown < sorted.length) more(); }, { rootMargin: '900px 0px' });
      onLeave(() => io.disconnect());
    }
    grid.replaceChildren(h('div', { class: 'listhead' }, h('h2', { class: 'section-title', style: 'margin:0' }, title), count), chips, list,
      ctaBox('Got a video of your own?', 'Watching never needs an account. Make a free one only when you want to upload.'));
    list.after(sentinel); draw(false);
    if (io && sorted.length > CHUNK) io.observe(sentinel);
  };

  try { await listVideos(q, paint); }
  catch (e) { if (nav === navId) grid.replaceChildren(h('div', { class: 'empty' }, h('h3', {}, "Can't load videos"), h('p', {}, e.message))); }
}

async function pageWatch(id) {
  const nav = navId;
  setTitle('');
  const holder = h('main', { class: 'page' });
  setPage('dark', topbar({ search: false, nav: false, back: true }), holder);
  const notFound = () => holder.replaceChildren(h('div', { class: 'empty' }, h('h3', {}, 'Video not found'), h('p', {}, 'It may have been removed or made private.'), h('a', { class: 'btn', href: '#/' }, 'Back to browsing')));

  let v = findCached(id), fresh = false;              // cached copy = the player appears instantly
  if (!v) {
    holder.append(h('div', { class: 'skeleton', style: 'max-width:900px;flex:none' }));
    try { v = await getVideo(id); fresh = true; } catch { if (nav === navId) notFound(); return; }
    if (nav !== navId) return;
  }
  setTitle(v.title);

  const src = pubUrl(v.filePath);
  const video = h('video', { preload: 'metadata', playsinline: true, src, poster: v.thumbUrl });
  const bigplay = h('button', { class: 'bigplay', 'aria-label': 'Play', html: ICON.play });
  const stage = h('div', { class: 'stage' }, video, bigplay);
  const playBtn = h('button', { class: 'ctl', 'aria-label': 'Play', html: ICON.play });
  const fill = h('i', {});
  const bar = h('div', { class: 'bar', role: 'slider', tabindex: '0', 'aria-label': 'Seek', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, fill);
  const time = h('span', { class: 'time' }, `0:00 / ${fmtTime(v.duration)}`);
  const muteBtn = h('button', { class: 'ctl', 'aria-label': 'Mute', html: ICON.vol });
  const fsBtn = h('button', { class: 'ctl', 'aria-label': 'Fullscreen', html: ICON.full });
  const player = h('div', { class: 'player' }, stage, h('div', { class: 'controls' }, playBtn, bar, time, muteBtn, fsBtn));

  const toggle = () => (video.paused ? video.play().catch(() => {}) : video.pause());
  let counted = false, lastSec = -1;
  stage.addEventListener('click', e => { if (e.target === stage || e.target === video || bigplay.contains(e.target)) toggle(); });
  playBtn.onclick = toggle;
  const dur = () => (isFinite(video.duration) && video.duration > 0 ? video.duration : v.duration);
  video.addEventListener('play', () => { player.classList.add('playing'); playBtn.innerHTML = ICON.pause; playBtn.setAttribute('aria-label', 'Pause'); if (!counted) { counted = true; countView(v.id); } });
  video.addEventListener('pause', () => { player.classList.remove('playing'); playBtn.innerHTML = ICON.play; playBtn.setAttribute('aria-label', 'Play'); });
  video.addEventListener('ended', () => { player.classList.remove('playing'); });
  const upd = () => {
    const d = dur() || 1, p = Math.min(1, video.currentTime / d);
    fill.style.transform = `scaleX(${p})`;                                  // transform, not width: no layout work per frame
    const sec = Math.floor(video.currentTime);
    if (sec !== lastSec) { lastSec = sec; bar.setAttribute('aria-valuenow', String(Math.round(p * 100))); time.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(dur())}`; }
  };
  video.addEventListener('timeupdate', upd); video.addEventListener('loadedmetadata', upd);
  video.addEventListener('error', () => toast("This video can't be played in your browser.", true));
  const seek = e => { const r = bar.getBoundingClientRect(); const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); if (dur()) video.currentTime = p * dur(); };
  let dragging = false;
  bar.addEventListener('pointerdown', e => { dragging = true; bar.setPointerCapture(e.pointerId); seek(e); });
  bar.addEventListener('pointermove', e => dragging && seek(e));
  bar.addEventListener('pointerup', () => { dragging = false; });
  bar.addEventListener('keydown', e => { if (e.key === 'ArrowRight') video.currentTime += 5; if (e.key === 'ArrowLeft') video.currentTime -= 5; });
  muteBtn.onclick = () => { video.muted = !video.muted; muteBtn.innerHTML = video.muted ? ICON.mute : ICON.vol; };
  fsBtn.onclick = () => (document.fullscreenElement ? document.exitFullscreen() : player.requestFullscreen && player.requestFullscreen());
  const keys = e => { if (e.target.closest('input,textarea,select')) return; if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); toggle(); } };
  document.addEventListener('keydown', keys); onLeave(() => { document.removeEventListener('keydown', keys); video.pause(); video.removeAttribute('src'); video.load(); });

  const upnext = h('div', {});
  const side = h('aside', { class: 'side' }, h('h2', {}, 'Up next'), upnext,
    h('section', { class: 'cta' }, h('h3', {}, state.me ? 'Share yours!' : 'Want to share yours?'),
      h('p', {}, state.me ? 'Jump to the upload page anytime.' : 'Make a free account only if you want to upload. Watching stays free for everyone.'),
      h('a', { class: 'link', href: state.me ? '#/upload' : '#/register' }, state.me ? 'Upload a video →' : 'Create an account →')));

  const viewsEl = h('span', { class: 'views' }, fmtViews(v.views));
  const descEl = h('div', { class: 'desc', hidden: !v.description }, v.description);
  const main = h('div', {}, player,
    h('h1', {}, v.title),
    h('div', { class: 'byline' }, h('span', { class: 'avatar sm', style: 'background:var(--coral)' }, v.creator.initial), v.creator.name,
      h('span', { class: 'pill' }, fmtAgo(v.createdAt)), viewsEl),
    descEl);

  const wrap = h('div', { class: 'watch' }, main, side);
  holder.replaceChildren(wrap);
  if (!fresh) anim(wrap, [{ opacity: 0.4 }, { opacity: 1 }], { duration: 200 });   // (a fresh load is already covered by the page fade)

  if (!fresh) getVideo(id).then(full => {            // description + latest views arrive a moment later
    if (nav !== navId) return;
    descEl.textContent = full.description; descEl.hidden = !full.description; viewsEl.textContent = fmtViews(full.views);
  }, () => { if (nav === navId) toast('This video may have been removed.', true); });

  listVideos('', all => {
    if (nav !== navId) return;
    const rest = all.filter(x => x.id !== v.id).sort(sorter.popular).slice(0, 6);
    upnext.replaceChildren(...(rest.length ? rest.map(x => h('a', { class: 'up', href: `#/watch/${x.id}` }, thumb(x), h('div', {}, h('b', {}, x.title), h('small', {}, x.creator.name)))) : [h('p', { style: 'color:var(--muted-dark)' }, 'No other videos yet.')]));
  }, 40).catch(() => {});
}

/* ---------- log in / create account (one card, smooth slide between the views) ---------- */
const RX_USER = /^[A-Za-z0-9_.]{3,20}$/, RX_MAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

function pwField(autocomplete, placeholder) {
  const input = h('input', { class: 'input', type: 'password', autocomplete, placeholder, maxlength: '72' });
  const btn = h('button', { type: 'button', class: 'pw-toggle', 'aria-label': 'Show password', onclick: () => {
    const hid = input.type === 'password'; input.type = hid ? 'text' : 'password'; btn.textContent = hid ? 'Hide' : 'Show'; btn.setAttribute('aria-label', hid ? 'Hide password' : 'Show password');
  } }, 'Show');
  return { input, el: h('div', { class: 'pw-row' }, input, btn) };
}
const field = (label, control, hint) => h('label', { class: 'field' }, h('span', {}, label), control, hint ? h('small', { class: 'hint' }, hint) : null);
async function withBusy(btn, label, fn) {
  const old = btn.textContent; btn.disabled = true; btn.textContent = label;
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = old; }
}

function pageAuth(mode) {
  if (state.me) { const d = state.next || '#/upload'; state.next = null; location.hash = d; return; }
  const ORDER = ['login', 'r1', 'r2'];
  let view = mode === 'register' ? 'r1' : 'login';
  const bad = (err, input, msg) => { err.textContent = msg; if (input) input.focus(); anim(card, [{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(7px)' }, { transform: 'translateX(-4px)' }, { transform: 'none' }], { duration: 300, easing: 'ease-out' }); };
  const finish = (user, msg) => {
    state.me = user; vcache.clear(); toast(msg);
    const dest = state.next || '#/upload'; state.next = null; location.hash = dest;
  };

  /* --- log in --- */
  const lErr = h('div', { class: 'err', role: 'alert' });
  const lMail = h('input', { class: 'input', type: 'email', inputmode: 'email', autocomplete: 'username', placeholder: 'you@gmail.com', maxlength: '254' });
  const lPass = pwField('current-password', 'Your password');
  const lBtn = h('button', { class: 'btn grape block', type: 'submit' }, 'Log in');
  const lForm = h('form', { novalidate: true, onsubmit: async e => {
    e.preventDefault(); lErr.textContent = '';
    const email = lMail.value.trim().toLowerCase(), pw = lPass.input.value;
    if (!RX_MAIL.test(email)) return bad(lErr, lMail, 'Enter the email you signed up with.');
    if (!pw) return bad(lErr, lPass.input, 'Enter your password.');
    await withBusy(lBtn, 'Logging in…', async () => {
      try { const u = await signIn(email, pw); finish(u, `Welcome back, ${u.name}!`); }
      catch (ex) { bad(lErr, null, ex.message); }
    });
  } }, field('Email', lMail), field('Password', lPass.el), lErr, lBtn);
  const pLogin = h('section', { class: 'panel', 'data-v': 'login' },
    h('h1', {}, 'Welcome back!'), h('p', {}, 'Log in to upload and manage your videos.'), lForm,
    h('p', { class: 'foot' }, 'New here? ', h('button', { class: 'link', type: 'button', onclick: () => show('r1') }, 'Create an account')));

  /* --- register, step 1: who you are --- */
  const r1Err = h('div', { class: 'err', role: 'alert' });
  const rUser = h('input', { class: 'input', type: 'text', autocomplete: 'username', placeholder: 'e.g. juan_dela_cruz', maxlength: '20', autocapitalize: 'off', spellcheck: 'false' });
  const rMail = h('input', { class: 'input', type: 'email', inputmode: 'email', autocomplete: 'email', placeholder: 'Gmail or any email', maxlength: '254' });
  const rPass = pwField('new-password', 'At least 8 characters');
  const rPass2 = pwField('new-password', 'Type it again');
  const r1Btn = h('button', { class: 'btn grape block', type: 'submit' }, 'Next');
  const r1Form = h('form', { novalidate: true, onsubmit: async e => {
    e.preventDefault(); r1Err.textContent = '';
    const u = rUser.value.trim(), em = rMail.value.trim().toLowerCase(), p1 = rPass.input.value, p2 = rPass2.input.value;
    if (!RX_USER.test(u)) return bad(r1Err, rUser, 'Username: 3–20 letters, numbers, dots or underscores.');
    if (!RX_MAIL.test(em)) return bad(r1Err, rMail, 'Enter a valid email (Gmail or any other).');
    if (p1.length < 8) return bad(r1Err, rPass.input, 'Password needs at least 8 characters.');
    if (p1 !== p2) return bad(r1Err, rPass2.input, "The two passwords don't match.");
    await withBusy(r1Btn, 'Checking…', async () => {
      if (!(await usernameAvailable(u))) return bad(r1Err, rUser, 'That username is taken. Try another one.');
      show('r2');
    });
  } }, field('Username', rUser, 'This is the name shown on your videos.'), field('Email', rMail, 'Any email works. We never send you a code.'), field('Password', rPass.el), field('Confirm password', rPass2.el), r1Err, r1Btn);
  const pR1 = h('section', { class: 'panel', 'data-v': 'r1' },
    h('h1', {}, 'Join Bidyo'), h('p', {}, 'Free account in under a minute. No codes, no waiting.'), r1Form,
    h('p', { class: 'foot' }, 'Already have an account? ', h('button', { class: 'link', type: 'button', onclick: () => show('login') }, 'Log in')));

  /* --- register, step 2: age + birthday --- */
  const r2Err = h('div', { class: 'err', role: 'alert' });
  const today = new Date(), pad = n => String(n).padStart(2, '0');
  const bday = h('input', { class: 'input', type: 'date', autocomplete: 'bday', min: '1900-01-01', max: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}` });
  const ageIn = h('input', { class: 'input', type: 'number', inputmode: 'numeric', min: String(MIN_AGE), max: '120', placeholder: 'Your age' });
  const syncAge = () => { const a = ageFrom(bday.value); if (Number.isFinite(a) && a >= 0 && a <= 120) ageIn.value = a; };
  bday.addEventListener('input', syncAge); bday.addEventListener('change', syncAge);
  const agree = h('input', { type: 'checkbox', id: 'agree' });
  const r2Btn = h('button', { class: 'btn grape', type: 'submit' }, 'Create account');
  const backBtn = h('button', { class: 'btn ghost', type: 'button', onclick: () => show('r1') }, 'Back');
  const r2Form = h('form', { novalidate: true, onsubmit: async e => {
    e.preventDefault(); r2Err.textContent = '';
    const bd = bday.value, real = ageFrom(bd);
    if (!parseDay(bd)) return bad(r2Err, bday, 'Pick your birthday.');
    if (real < MIN_AGE) return bad(r2Err, bday, `You need to be at least ${MIN_AGE} to join Bidyo.`);
    if (real > 120) return bad(r2Err, bday, 'Please check your birthday.');
    if (!ageIn.value || Number(ageIn.value) !== real) return bad(r2Err, ageIn, `Your age doesn't match your birthday (you're ${real}).`);
    if (!agree.checked) return bad(r2Err, agree, 'Please accept the Terms and Privacy Policy.');
    await withBusy(r2Btn, 'Creating…', async () => {
      try {
        const u = await registerAccount({ username: rUser.value.trim(), email: rMail.value.trim().toLowerCase(), password: rPass.input.value, birthday: bd, age: real });
        finish(u, `Welcome to Bidyo, ${u.name}!`);
      } catch (ex) {
        if (ex.code === 'exists' || ex.code === 'username') { show('r1'); bad(r1Err, ex.code === 'exists' ? rMail : rUser, ex.message); }
        else bad(r2Err, null, ex.message);
      }
    });
  } }, field('Birthday', bday), field('Age', ageIn, 'Fills in by itself when you pick your birthday.'),
    h('label', { class: 'check', for: 'agree' }, agree, h('span', {}, 'I agree to the ', h('a', { href: '#/terms', target: '_blank', rel: 'noopener' }, 'Terms'), ' and ', h('a', { href: '#/privacy', target: '_blank', rel: 'noopener' }, 'Privacy Policy'), '.')),
    r2Err, h('div', { class: 'btn-row' }, backBtn, r2Btn));
  const pR2 = h('section', { class: 'panel', 'data-v': 'r2' },
    h('h1', {}, 'Almost done!'), h('p', {}, 'Tell us a little about you. Only you can see this.'), r2Form,
    h('div', { class: 'note' }, h('span', { html: ICON.shield, style: 'display:contents' }), h('span', {}, 'Your password is stored securely and we never see it. Your age and birthday stay private.')));

  /* --- card: tabs + progress + stacked panels --- */
  const panels = [pLogin, pR1, pR2];
  const ind = h('span', { class: 'tab-ind', 'aria-hidden': 'true' });
  const tabLogin = h('button', { type: 'button', role: 'tab', onclick: () => show('login') }, 'Log in');
  const tabReg = h('button', { type: 'button', role: 'tab', onclick: () => show(view === 'login' ? 'r1' : view) }, 'Create account');
  const stepA = h('i'), stepB = h('i');
  const stepLabel = h('p', { class: 'step-label' }, '');
  const stepsWrap = h('div', { class: 'steps-wrap' }, h('div', {}, h('div', { class: 'steps' }, stepA, stepB), stepLabel));
  const card = h('div', { class: 'card' }, h('div', { class: 'tabs', role: 'tablist' }, ind, tabLogin, tabReg), stepsWrap, h('div', { class: 'panels' }, panels),
    h('p', { class: 'foot' }, 'Just here to watch? ', h('a', { href: '#/' }, 'Keep browsing')));

  function show(v, first) {
    view = v;
    const cur = ORDER.indexOf(v);
    panels.forEach(p => { const i = ORDER.indexOf(p.dataset.v); p.classList.toggle('on', i === cur); p.classList.toggle('before', i < cur); p.classList.toggle('after', i > cur); p.setAttribute('aria-hidden', String(i !== cur)); });
    const reg = v !== 'login';
    ind.style.transform = reg ? 'translateX(100%)' : 'none';
    tabLogin.setAttribute('aria-selected', String(!reg)); tabReg.setAttribute('aria-selected', String(reg));
    stepsWrap.classList.toggle('show', reg); stepA.classList.toggle('on', reg); stepB.classList.toggle('on', v === 'r2');
    stepLabel.textContent = v === 'r2' ? 'Step 2 of 2 · About you' : 'Step 1 of 2 · Your account';
    setTitle(reg ? 'Create your account' : 'Log in');
    if (!first) { try { history.replaceState(null, '', reg ? '#/register' : '#/login'); } catch {} }
    const target = panels[cur].querySelector('input:not([type=checkbox])');
    if (target) setTimeout(() => target.focus({ preventScroll: true }), first ? 0 : 40);
  }

  const art = h('div', { class: 'cards-art', 'aria-hidden': 'true' }, ['a', 'b', 'c'].map(c => h('span', { class: c, html: ICON.play })));
  setPage('', h('div', { class: 'split' },
    h('section', { class: 'left' }, brand(),
      h('h1', {}, 'Show off your ', h('em', {}, 'best'), ' video!'),
      h('p', {}, 'An account is only needed to upload. Pick a username, set a password, done.'), art),
    h('section', { class: 'right' }, card)));
  show(view, true);
}

/* ---------- upload ---------- */
async function pageUpload() {
  setTitle('Upload a video');
  if (!state.me) { state.next = '#/upload'; location.hash = '#/login'; return; }
  const cfgc = state.config;
  let file = null, thumbBlob = null, duration = 0, previewUrl = null, xhr = null;
  onLeave(() => { if (previewUrl) URL.revokeObjectURL(previewUrl); if (xhr) xhr.abort(); });

  const fileInput = h('input', { type: 'file', accept: cfgc.formats.join(',') + ',video/*', class: 'sr', tabindex: '-1', 'aria-hidden': 'true' });
  const drop = h('div', { class: 'drop', role: 'group', 'aria-label': 'Video file drop area' });
  const renderDrop = () => {
    if (!file) {
      drop.replaceChildren(h('div', { class: 'ico', html: ICON.upload }), h('h2', {}, 'Drag your video here'),
        h('p', {}, `or choose from your device · up to ${cfgc.maxUploadMb} MB · ${cfgc.formats.map(f => f.slice(1).toUpperCase()).join(', ')}`),
        h('button', { class: 'btn grape', type: 'button', onclick: () => fileInput.click() }, 'Choose file'));
    } else {
      const pv = h('video', { src: previewUrl, muted: true, preload: 'metadata', playsinline: true });
      drop.replaceChildren(h('div', { class: 'picked' }, pv, h('div', {}, h('b', {}, file.name), h('span', { style: 'color:var(--muted)' }, `${fmtSize(file.size)}${duration ? ' · ' + fmtTime(duration) : ''}`), h('br'),
        h('button', { class: 'link', type: 'button', onclick: () => fileInput.click() }, 'Choose a different file'))));
    }
  };
  async function setFile(f) {
    if (!f) return;
    const ext = '.' + f.name.split('.').pop().toLowerCase();
    if (!cfgc.formats.includes(ext)) return toast(`Unsupported format. Use ${cfgc.formats.join(', ')}`, true);
    if (f.size > cfgc.maxUploadMb * 1048576) return toast(`That file is bigger than ${cfgc.maxUploadMb} MB.`, true);
    if (f.size === 0) return toast('That file is empty.', true);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    file = f; previewUrl = URL.createObjectURL(f); thumbBlob = null; duration = 0; renderDrop();
    if (!titleIn.value) titleIn.value = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 100);
    try { const m = await probe(previewUrl); duration = m.duration; thumbBlob = m.thumb; renderDrop(); } catch {}
  }
  fileInput.addEventListener('change', () => { setFile(fileInput.files[0]); fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => setFile(e.dataTransfer.files[0]));

  const titleIn = h('input', { class: 'input', id: 'title', placeholder: 'e.g. Dancing in the rain!', maxlength: '100' });
  const descIn = h('textarea', { class: 'textarea', id: 'desc', placeholder: "What's happening in this video?", maxlength: '2000' });
  const rights = h('input', { type: 'checkbox', id: 'rights' });
  const prog = h('div', { class: 'progress', hidden: true }, h('i'));
  const draftBtn = h('button', { class: 'btn ghost', type: 'button' }, 'Save as draft');
  const pubBtn = h('button', { class: 'btn coral', type: 'button' }, 'Publish video!');
  const mine = h('div', { class: 'mine' });
  const setProg = pct => { prog.firstChild.style.transform = `scaleX(${pct / 100})`; };

  async function submit(status) {
    if (!file) return toast('Choose a video file first.', true);
    if (!titleIn.value.trim()) { titleIn.focus(); return toast('Add a title.', true); }
    if (!rights.checked) return toast('Please confirm the video is yours or you have permission.', true);
    const { data: sess } = await sb.auth.getSession();
    if (!sess.session) { state.me = null; state.next = '#/upload'; toast('Your session ended. Please log in again.', true); location.hash = '#/login'; return; }
    const id = crypto.randomUUID();
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    const mime = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' }[ext] || 'video/mp4';
    const filePath = `${state.me.id}/${id}${ext}`;
    const thumbPath = thumbBlob ? `${state.me.id}/${id}.jpg` : null;
    draftBtn.disabled = pubBtn.disabled = true; prog.hidden = false; setProg(0);
    const reset = msg => { draftBtn.disabled = pubBtn.disabled = false; prog.hidden = true; xhr = null; if (msg) toast(msg, true); };

    // Raw upload straight to Supabase Storage (XHR so we get a real progress bar). Files never pass through this server.
    xhr = new XMLHttpRequest();
    xhr.open('POST', `${CFG.SUPABASE_URL}/storage/v1/object/${BUCKET}/${filePath}`);
    xhr.setRequestHeader('Authorization', 'Bearer ' + sess.session.access_token);
    xhr.setRequestHeader('apikey', CFG.SUPABASE_ANON_KEY);
    xhr.setRequestHeader('Content-Type', mime);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = e => { if (e.lengthComputable) setProg(Math.round((e.loaded / e.total) * 100)); };
    xhr.onerror = () => reset('Upload failed. Check your connection and try again.');
    xhr.onload = async () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        let m = ''; try { m = JSON.parse(xhr.responseText).message || ''; } catch {}
        return reset(/exceeded|too large|size/i.test(m) ? `File is too big for your Supabase plan (max ${cfgc.maxUploadMb} MB).` : (m || 'Upload failed.'));
      }
      try {
        if (thumbBlob) await sb.storage.from(BUCKET).upload(thumbPath, thumbBlob, { contentType: 'image/jpeg', upsert: false });
        const { data, error } = await sb.from('videos').insert({ id, user_id: state.me.id, creator_name: state.me.name, title: titleIn.value.trim(), description: descIn.value.trim(), status, file_path: filePath, thumb_path: thumbPath, mime, size: file.size, duration: duration || 0 }).select().single();
        if (error) { await sb.storage.from(BUCKET).remove([filePath, thumbPath].filter(Boolean)); throw error; }
        reset(); vcache.clear();
        toast(status === 'draft' ? 'Saved as draft.' : 'Your video is live!');
        file = null; thumbBlob = null; duration = 0; titleIn.value = ''; descIn.value = ''; rights.checked = false; renderDrop(); loadMine();
        if (status === 'published') location.hash = `#/watch/${data.id}`;
      } catch (e) { reset(e.message || 'Could not save the video.'); }
    };
    xhr.send(file);
  }
  draftBtn.onclick = () => submit('draft'); pubBtn.onclick = () => submit('published');

  async function loadMine() {
    try {
      const videos = await myVideos();
      mine.replaceChildren(h('h2', {}, 'Your videos'),
        ...(videos.length ? videos.map(v => h('div', { class: 'vrow' }, thumb(v),
          h('div', {}, h('a', { href: `#/watch/${v.id}` }, v.title),
            h('small', {}, h('span', { class: 'tag' + (v.status === 'draft' ? ' draft' : '') }, v.status === 'draft' ? 'Draft' : 'Published'), `${fmtViews(v.views)} · ${fmtAgo(v.createdAt)}`)),
          h('div', { class: 'acts' },
            h('button', { class: 'btn sm ghost', onclick: async () => { const { error } = await sb.from('videos').update({ status: v.status === 'draft' ? 'published' : 'draft' }).eq('id', v.id); if (error) toast(error.message, true); vcache.clear(); loadMine(); } }, v.status === 'draft' ? 'Publish' : 'Unpublish'),
            h('button', { class: 'btn sm coral', onclick: async () => { if (!confirm(`Delete "${v.title}"? This can't be undone.`)) return; const { error } = await sb.from('videos').delete().eq('id', v.id); if (error) return toast(error.message, true); removeVideoFiles(v).catch(() => {}); vcache.clear(); toast('Video deleted.'); loadMine(); } }, 'Delete'))))
          : [h('p', { style: 'color:var(--muted)' }, 'Videos you upload will appear here.')]));
    } catch (e) { mine.replaceChildren(h('p', { style: 'color:var(--muted)' }, e.message)); }
  }

  renderDrop();
  const form = h('div', { class: 'form-card' },
    h('label', { class: 'field', for: 'title' }, h('span', {}, 'Title'), titleIn),
    h('label', { class: 'field', for: 'desc' }, h('span', {}, 'Video description'), descIn),
    h('label', { class: 'check', for: 'rights' }, rights, 'This video is mine, or I have permission to upload it.'));

  const row = (k, val) => h('div', {}, h('dt', {}, k), h('dd', {}, val));
  setPage('', topbar({ light: true, search: false, nav: false }),
    h('main', { class: 'page', style: 'max-width:1300px' }, h('div', { class: 'upload-grid' },
      h('div', {}, h('h1', {}, 'Upload a video'), h('p', { class: 'lead' }, "Free to upload. Just drop it in, then add a title."), drop, fileInput, form, prog,
        h('div', { class: 'actions' }, draftBtn, pubBtn), mine),
      h('aside', {},
        h('section', { class: 'tips' }, h('h2', {}, 'Tips to get noticed'), h('ul', {}, h('li', {}, 'Short title, clear content.'), h('li', {}, 'Start with the best part.'), h('li', {}, `Keep it under ${cfgc.maxUploadMb} MB.`))),
        h('section', { class: 'account' }, h('h2', {}, 'Your account'),
          h('dl', {}, row('Username', state.me.name), row('Email', state.me.email), state.me.age != null ? row('Age', String(state.me.age)) : null),
          h('button', { class: 'link', onclick: logout }, 'Log out'))))));
  loadMine();
}

/* Reads duration + a thumbnail frame from the chosen file, entirely in the browser. */
function probe(url) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true; v.preload = 'metadata'; v.playsInline = true; v.src = url;
    const done = fn => arg => { clearTimeout(timer); v.removeAttribute('src'); v.load(); fn(arg); };
    const ok = done(resolve), no = done(reject);
    const timer = setTimeout(() => no(new Error('timeout')), 10000);
    v.addEventListener('error', () => no(new Error('bad video')));
    v.addEventListener('loadedmetadata', () => { v.currentTime = Math.min(1, (v.duration || 1) / 3); });
    v.addEventListener('seeked', () => {
      try {
        const w = 640, hh = Math.round(w * (v.videoHeight || 360) / (v.videoWidth || 640));
        const c = document.createElement('canvas'); c.width = w; c.height = hh;
        c.getContext('2d').drawImage(v, 0, 0, w, hh);
        c.toBlob(b => ok({ duration: isFinite(v.duration) ? v.duration : 0, thumb: b && b.size < 380 * 1024 ? b : null }), 'image/jpeg', 0.75);
      } catch (e) { ok({ duration: isFinite(v.duration) ? v.duration : 0, thumb: null }); }
    }, { once: true });
  });
}

/* ---------- static pages ---------- */
function pageProse(title, paragraphs) {
  setTitle(title);
  setPage('dark', topbar({ search: false, nav: false, back: true }), h('main', { class: 'page prose' }, h('h1', {}, title), paragraphs.map(([hd, p]) => [h('h2', {}, hd), h('p', {}, p)])));
}

/* ============================ auth + router ============================ */
async function logout() {
  try { await sb.auth.signOut(); } catch {}
  state.me = null; vcache.clear(); toast("You're logged out."); location.hash = '#/'; route();
}

async function route() {
  cleanup.forEach(fn => { try { fn(); } catch {} }); cleanup = [];
  navId++;
  const hash = location.hash || '#/';
  const slot = document.getElementById('adslot'); if (slot) slot.hidden = /^#\/(login|register|verify|upload)/.test(hash);   // no ads on sign-up / upload forms
  let m;
  try {
    if (hash === '#/' || hash === '#' || hash === '#/all') return await pageBrowse({ title: 'Overall videos', sort: 'popular', hero: true });
    if (hash === '#/latest') return await pageBrowse({ title: 'Latest videos', sort: 'latest' });
    if (hash === '#/old') return await pageBrowse({ title: 'Oldest videos', sort: 'old' });
    if ((m = /^#\/search\/(.+)$/.exec(hash))) { const q = decodeURIComponent(m[1]); return await pageBrowse({ title: `Results for “${q}”`, sort: 'popular', q }); }
    if ((m = /^#\/watch\/([0-9a-f-]{36})$/.exec(hash))) return await pageWatch(m[1]);
    if (hash === '#/login') return pageAuth('login');
    if (hash === '#/register' || hash === '#/verify') return pageAuth('register');
    if (hash === '#/upload') return await pageUpload();
    if (hash === '#/terms') return pageProse('Terms', [['Be nice, share your own stuff', 'Only upload videos that are yours or that you have permission to share. Videos that are illegal, hateful, or harmful will be removed.'], ['Your account', 'You must be at least 13 years old. Keep your password private and do not share your account.']]);
    if (hash === '#/privacy') return pageProse('Privacy Policy', [['What we store', 'Your username, email address, age and birthday (only you can see the last two), the videos you upload, and a sign-in session so you stay logged in.'], ['What we never do', 'We never see your password (it is stored hashed), and we never post anything for you. Watching requires no account and no personal data.']]);
    location.hash = '#/';
  } catch (e) { console.error(e); toast('Something went wrong.', true); }
}

(async function init() {
  window.addEventListener('hashchange', route);
  if (!sb) return route();
  // Don't make the first paint wait on the network: if reading the saved session is slow (e.g. it needs a token refresh), show the page first.
  const SLOW = Symbol('slow');
  let first;
  try { first = await Promise.race([sb.auth.getSession(), new Promise(r => setTimeout(() => r(SLOW), 600))]); } catch { first = null; }
  if (first !== SLOW && first) state.me = toUser(first.data && first.data.session && first.data.session.user);
  sb.auth.onAuthStateChange((_evt, session) => { state.me = toUser(session && session.user); });   // just keep state in sync; no re-render
  route();
  if (first === SLOW) sb.auth.getSession().then(r => { const u = toUser(r.data && r.data.session && r.data.session.user); if ((u && u.id) !== (state.me && state.me.id)) { state.me = u; vcache.clear(); route(); } }, () => {});
})();
