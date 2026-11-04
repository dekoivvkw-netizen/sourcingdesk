'use strict';
// Frontend minimale: sessione tramite cookie HttpOnly impostato dal server; nessun HTML non sanificato.
const $ = s => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter(k => k != null)); return e; };
let suppliers = [];

async function api(method, url, body) {
  const res = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith('/api/auth')) { showAuth(); throw new Error('Sessione scaduta'); }
  if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
  return data;
}
function toast(msg, err = false) { const t = $('#toast'); t.textContent = msg; t.className = err ? 'err' : ''; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), 4000); }
const formData = f => Object.fromEntries([...new FormData(f)].map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
const clean = o => Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'id').map(([k, v]) => [k, v === '' ? null : v]));
const fmtPrice = o => (o.price == null ? '—' : `${Number(o.price).toFixed(2)} ${o.currency || ''}`);
const scoreBadge = s => { if (s == null) return '—'; const c = s >= 70 ? '#2e7d32' : s >= 45 ? '#b26a00' : '#b3261e'; const b = el('span', { className: 'score', textContent: s }); b.style.background = c; return b; };

function showAuth() { $('#auth-view').hidden = false; $('#app-view').hidden = true; $('#logout').hidden = true; $('#who').textContent = ''; }
async function showApp(user) {
  $('#auth-view').hidden = true; $('#app-view').hidden = false; $('#logout').hidden = false; $('#who').textContent = user.email;
  await loadSuppliers(); await loadOffers();
}

$('#auth-form').addEventListener('submit', async e => {
  e.preventDefault();
  const mode = e.submitter?.dataset.mode || 'login';
  try { const r = await api('POST', `/api/auth/${mode}`, formData(e.target)); e.target.reset(); await showApp(r.user); }
  catch (err) { toast(err.message, true); }
});
$('#logout').addEventListener('click', async () => { await api('POST', '/api/auth/logout').catch(() => {}); showAuth(); });

document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tab').forEach(t => (t.hidden = t.id !== `tab-${b.dataset.tab}`));
  if (b.dataset.tab === 'audit') loadAudit();
}));

// ---- Fornitori ----
async function loadSuppliers() {
  suppliers = await api('GET', '/api/suppliers');
  const body = $('#suppliers-body'); body.replaceChildren();
  for (const s of suppliers) {
    const site = s.website ? el('a', { href: s.website, target: '_blank', rel: 'noopener noreferrer', textContent: s.website }) : '—';
    body.append(el('tr', {}, el('td', { textContent: s.name }), el('td', {}, site), el('td', { textContent: s.country || '—' }), el('td', { textContent: s.email || '—' }),
      el('td', {}, el('button', { className: 'link', textContent: 'Modifica', onclick: () => editSupplier(s) }),
        el('button', { className: 'link', textContent: 'Elimina', onclick: () => delSupplier(s) }))));
  }
  for (const sel of document.querySelectorAll('select[name=supplier_id]')) {
    const keep = sel.value; const first = sel.options[0].cloneNode(true);
    sel.replaceChildren(first, ...suppliers.map(s => el('option', { value: s.id, textContent: s.name }))); sel.value = keep;
  }
}
function editSupplier(s) { const f = $('#supplier-form'); for (const k of ['id', 'name', 'website', 'country', 'email', 'notes']) f.elements[k].value = s[k] ?? ''; $('#supplier-form-title').textContent = 'Modifica fornitore'; f.scrollIntoView(); }
async function delSupplier(s) { if (!confirm(`Eliminare il fornitore "${s.name}"?`)) return; try { await api('DELETE', `/api/suppliers/${s.id}`); toast('Fornitore eliminato'); await loadSuppliers(); await loadOffers(); } catch (e) { toast(e.message, true); } }
$('#supplier-form').addEventListener('submit', async e => {
  e.preventDefault(); const d = formData(e.target);
  try {
    const r = d.id ? await api('PUT', `/api/suppliers/${d.id}`, clean(d)) : await api('POST', '/api/suppliers', clean(d));
    toast(d.id ? 'Fornitore aggiornato' : r.inserted ? 'Fornitore creato' : 'Fornitore già presente: dati uniti');
    e.target.reset(); await loadSuppliers();
  } catch (err) { toast(err.message, true); }
});
$('#supplier-form').addEventListener('reset', () => { $('#supplier-form-title').textContent = 'Nuovo fornitore'; $('#supplier-form').elements.id.value = ''; });

// ---- Offerte ----
async function loadOffers() {
  const q = $('#offer-search').value.trim();
  const offers = await api('GET', `/api/offers${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  const name = id => suppliers.find(s => s.id === id)?.name || '—';
  const body = $('#offers-body'); body.replaceChildren();
  for (const o of offers) {
    body.append(el('tr', {},
      el('td', {}, el('a', { href: o.url, target: '_blank', rel: 'noopener noreferrer', textContent: o.title }), o.source === 'robot' ? ' 🤖' : null),
      el('td', { textContent: fmtPrice(o) }), el('td', { textContent: o.moq ?? '—' }), el('td', { textContent: o.lead_time_days ?? '—' }),
      el('td', { textContent: name(o.supplier_id) }), el('td', { title: o.ai_summary || '' }, scoreBadge(o.ai_score)),
      el('td', {}, el('button', { className: 'link', textContent: 'Modifica', onclick: () => editOffer(o) }),
        el('button', { className: 'link', textContent: 'Elimina', onclick: () => delOffer(o) }))));
  }
}
let searchTimer; $('#offer-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadOffers().catch(e => toast(e.message, true)), 300); });
function editOffer(o) { const f = $('#offer-form'); for (const k of ['id', 'title', 'url', 'price', 'currency', 'moq', 'lead_time_days', 'supplier_id', 'description']) f.elements[k].value = o[k] ?? ''; $('#offer-form-title').textContent = 'Modifica offerta'; f.scrollIntoView(); }
async function delOffer(o) { if (!confirm(`Eliminare l'offerta "${o.title}"?`)) return; try { await api('DELETE', `/api/offers/${o.id}`); toast('Offerta eliminata'); await loadOffers(); } catch (e) { toast(e.message, true); } }
$('#offer-form').addEventListener('submit', async e => {
  e.preventDefault(); const d = formData(e.target);
  try {
    const r = d.id ? await api('PUT', `/api/offers/${d.id}`, clean(d)) : await api('POST', '/api/offers', clean(d));
    toast(`${d.id ? 'Offerta aggiornata' : r.inserted ? 'Offerta creata' : 'Offerta già presente: dati aggiornati'} – punteggio ${r.ai_score}`);
    e.target.reset(); await loadOffers();
  } catch (err) { toast(err.message, true); }
});
$('#offer-form').addEventListener('reset', () => { $('#offer-form-title').textContent = 'Nuova offerta'; $('#offer-form').elements.id.value = ''; });

// ---- Robot ----
$('#robot-form').addEventListener('submit', async e => {
  e.preventDefault(); const btn = e.submitter; btn.disabled = true; $('#robot-result').textContent = 'Import in corso…';
  try {
    const r = await api('POST', '/api/robots/run', clean(formData(e.target)));
    $('#robot-result').textContent = `${r.inserted ? 'Nuova offerta creata' : 'Offerta esistente aggiornata'} (id ${r.id})\n` +
      `Titolo: ${r.extracted.title}\nPrezzo: ${r.extracted.price ?? '—'} ${r.extracted.currency || ''}\nVenditore: ${r.extracted.supplierName || '—'}\n` +
      `Punteggio: ${r.ai_score} – ${r.ai_summary}`;
    await loadSuppliers(); await loadOffers();
  } catch (err) { $('#robot-result').textContent = err.message; toast(err.message, true); }
  finally { btn.disabled = false; }
});

// ---- Registro ----
async function loadAudit() {
  const rows = await api('GET', '/api/audit');
  $('#audit-body').replaceChildren(...rows.map(r => el('tr', {}, el('td', { textContent: r.created_at }), el('td', { textContent: r.action }),
    el('td', { textContent: `${r.entity}${r.entity_id ? ' #' + r.entity_id : ''}` }), el('td', { textContent: r.meta ? JSON.stringify(r.meta) : '' }))));
}

api('GET', '/api/me').then(showApp).catch(() => showAuth());

// --- Mobile: etichette per le celle (le tabelle diventano schede su schermi stretti) ---
for (const tb of document.querySelectorAll('tbody')) {
  const heads = [...tb.closest('table').querySelectorAll('thead th')].map(th => th.textContent);
  const label = () => tb.querySelectorAll('tr').forEach(tr => [...tr.children].forEach((td, i) => { if (heads[i]) td.dataset.label = heads[i]; }));
  new MutationObserver(label).observe(tb, { childList: true });
}
// In modifica, porta il modulo in vista (utile su telefono).
document.addEventListener('click', e => {
  if (e.target.matches?.('button.link') && e.target.textContent === 'Modifica') setTimeout(() => e.target.closest('.tab')?.querySelector('form')?.scrollIntoView({ behavior: 'smooth' }), 50);
});

// --- PWA: service worker (solo asset statici, mai /api) ---
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// Mobile: i moduli "Nuovo/Modifica" sono richiudibili, così l'elenco è subito visibile.
const mq = window.matchMedia('(max-width: 700px)');
for (const f of document.querySelectorAll('#offer-form, #supplier-form')) {
  const h = f.querySelector('h3'); h.setAttribute('role', 'button'); h.tabIndex = 0;
  const toggle = () => f.classList.toggle('collapsed');
  h.addEventListener('click', () => mq.matches && toggle());
  h.addEventListener('keydown', e => { if (mq.matches && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(); } });
  if (mq.matches) f.classList.add('collapsed');
  f.addEventListener('submit', () => mq.matches && setTimeout(() => f.classList.add('collapsed'), 300));
  f.addEventListener('reset', () => mq.matches && f.classList.add('collapsed'));
}
document.addEventListener('click', e => {
  if (e.target.matches?.('button.link') && e.target.textContent === 'Modifica') e.target.closest('.tab')?.querySelector('form')?.classList.remove('collapsed');
}, true);
