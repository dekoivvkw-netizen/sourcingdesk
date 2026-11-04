'use strict';
const { HttpError } = require('./http');
const str = (v, max, name, required = false) => {
  if (v === undefined || v === null || v === '') { if (required) throw new HttpError(400, `${name} obbligatorio`); return null; }
  if (typeof v !== 'string') throw new HttpError(400, `${name} non valido`);
  const s = v.trim(); if (required && !s) throw new HttpError(400, `${name} obbligatorio`);
  if (s.length > max) throw new HttpError(400, `${name} troppo lungo (max ${max})`);
  return s || null;
};
const num = (v, name, { int = false, min = 0, max = 1e10 } = {}) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) throw new HttpError(400, `${name} non valido`);
  return n;
};
const httpUrl = (v, name, required) => {
  const s = str(v, 2048, name, required); if (!s) return null;
  let u; try { u = new URL(s); } catch { throw new HttpError(400, `${name} non è un URL valido`); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new HttpError(400, `${name} deve essere http(s)`);
  return u.toString();
};
module.exports = { str, num, httpUrl };
