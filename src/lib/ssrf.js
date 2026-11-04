'use strict';
// Validazione destinazioni per il robot: IPv4 e IPv6 ammessi, indirizzi interni bloccati.
const dns = require('node:dns').promises;
const net = require('node:net');

const bl = new net.BlockList();
for (const [a, p] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],
  ['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],
  ['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) bl.addSubnet(a, p, 'ipv4');
// NB: niente ::ffff:0:0/96 nella BlockList: Node lo applicherebbe anche agli IPv4 puri.
for (const [a, p] of [['::',128],['::1',128],['fe80::',10],['fec0::',10],['fc00::',7],['ff00::',8],['64:ff9b::',96],
  ['64:ff9b:1::',48],['2001:db8::',32],['100::',64],['2002::',16]]) bl.addSubnet(a, p, 'ipv6');

function isBlockedIp(ip) {
  const fam = net.isIP(ip);
  if (!fam) return true;
  if (fam === 4) return bl.check(ip, 'ipv4');
  if (/^::ffff:/i.test(ip) || /^(0{1,4}:){5}ffff:/i.test(ip) || /^::(\d+\.){3}\d+$/.test(ip)) return true; // IPv4-mapped/compat
  return bl.check(ip, 'ipv6');
}

/** Risolve l'host e verifica che TUTTI gli indirizzi siano pubblici. Ritorna { host, address, family }. */
async function resolvePublic(rawUrl, { lookup = dns.lookup, allowPrivate = false } = {}) {
  let u;
  try { u = new URL(rawUrl); } catch { throw Object.assign(new Error('URL non valido'), { status: 400 }); }
  if (!['http:', 'https:'].includes(u.protocol)) throw Object.assign(new Error('protocollo non consentito'), { status: 400 });
  if (u.username || u.password) throw Object.assign(new Error('credenziali nell\'URL non consentite'), { status: 400 });
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await lookup(host, { all: true, verbatim: true });
  if (!addrs.length) throw Object.assign(new Error('host non risolvibile'), { status: 400 });
  if (!allowPrivate && addrs.some(a => isBlockedIp(a.address))) throw Object.assign(new Error('host non consentito'), { status: 400 });
  return { url: u, host, address: addrs[0].address, family: addrs[0].family || net.isIP(addrs[0].address) };
}
module.exports = { isBlockedIp, resolvePublic };
