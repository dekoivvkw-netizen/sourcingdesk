'use strict';
// Estrazione dati offerta da HTML: JSON-LD (schema.org Product/Offer), Open Graph, meta, <title>.
const decode = s => String(s ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

function meta(html, key) {
  const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${key.replace(/[.:]/g, '\\$&')}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1]) || null : null;
}
function parsePrice(v) {
  if (v === null || v === undefined || v === '') return null;
  let s = String(v).replace(/[^\d.,-]/g, '');
  if (!/\d/.test(s)) return null;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
function findProduct(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const p = findProduct(n); if (p) return p; } return null; }
  const t = [].concat(node['@type'] || []);
  if (t.includes('Product')) return node;
  return findProduct(node['@graph']);
}
function extractOffer(html, url) {
  const out = { title: null, description: null, price: null, currency: null, supplierName: null, url };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const p = findProduct(JSON.parse(m[1]));
      if (!p) continue;
      const offer = [].concat(p.offers || [])[0] || {};
      out.title ||= decode(p.name) || null;
      out.description ||= decode(p.description) || null;
      out.price ??= parsePrice(offer.price ?? offer.lowPrice);
      out.currency ||= offer.priceCurrency || null;
      out.supplierName ||= decode(offer.seller?.name || p.brand?.name || (typeof p.brand === 'string' ? p.brand : '')) || null;
    } catch { /* JSON-LD non valido: ignorato */ }
  }
  out.title ||= meta(html, 'og:title') || decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]) || null;
  out.description ||= meta(html, 'og:description') || meta(html, 'description');
  out.price ??= parsePrice(meta(html, 'product:price:amount') || meta(html, 'og:price:amount') || meta(html, 'price'));
  out.currency ||= meta(html, 'product:price:currency') || meta(html, 'og:price:currency') || meta(html, 'priceCurrency');
  out.supplierName ||= meta(html, 'og:site_name');
  if (out.currency) out.currency = String(out.currency).toUpperCase().slice(0, 3);
  if (out.title) out.title = out.title.slice(0, 500);
  if (out.description) out.description = out.description.slice(0, 2000);
  return out;
}
module.exports = { extractOffer, parsePrice };
