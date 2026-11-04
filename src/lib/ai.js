'use strict';
// Valutazione AI opzionale: API compatibile OpenAI con timeout; senza chiave (o in caso di errore)
// si usa una valutazione euristica locale, così l'app funziona sempre.
class AiError extends Error { constructor(msg, status, cause) { super(msg, { cause }); this.status = status; } }

async function aiFetch(url, opts = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new AiError(`AI HTTP ${res.status}`, 502);
    return await res.json();
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e.name === 'AbortError') throw new AiError('AI timeout', 504, e);
    throw new AiError('AI non raggiungibile', 502, e);
  } finally { clearTimeout(t); }
}

function heuristicScore(o) {
  let score = 40; const notes = [];
  if (o.price != null) { score += 15; } else notes.push('prezzo mancante');
  if (o.currency) score += 5;
  if (o.moq != null) { score += 10; if (o.moq > 1000) { score -= 10; notes.push('MOQ alto'); } } else notes.push('MOQ non indicato');
  if (o.lead_time_days != null) { score += 10; if (o.lead_time_days > 30) { score -= 10; notes.push('tempi di consegna lunghi'); } } else notes.push('tempi di consegna non indicati');
  if (o.supplier_id) score += 10; else notes.push('fornitore non collegato');
  if (o.description && o.description.length > 80) score += 10;
  score = Math.max(0, Math.min(100, score));
  return { score, summary: notes.length ? `Da verificare: ${notes.join(', ')}.` : 'Dati completi.', source: 'euristica' };
}

function createEvaluator(cfg, fetchJson = aiFetch) {
  return async function evaluate(offer) {
    if (!cfg.apiKey) return heuristicScore(offer);
    try {
      const data = await fetchJson(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model, temperature: 0, response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'Sei un buyer B2B. Valuta l\'offerta di fornitura. Rispondi solo JSON {"score":0-100,"summary":"max 2 frasi in italiano"}.' },
            { role: 'user', content: JSON.stringify({ title: offer.title, price: offer.price, currency: offer.currency, moq: offer.moq, lead_time_days: offer.lead_time_days, description: offer.description?.slice(0, 1500) }) },
          ],
        }),
      }, cfg.timeoutMs);
      const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
      const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score))));
      if (!Number.isFinite(score)) throw new AiError('risposta AI non valida', 502);
      return { score, summary: String(parsed.summary || '').slice(0, 1000), source: 'ai' };
    } catch (e) {
      const h = heuristicScore(offer);
      return { ...h, summary: `${h.summary} (AI non disponibile: ${e.message})`, source: 'euristica' };
    }
  };
}
module.exports = { aiFetch, AiError, heuristicScore, createEvaluator };
