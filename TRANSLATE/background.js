/**
 * Background Service Worker (Manifest V3)
 * Hızlı, kotasız ve akıllı paket çeviri motoru.
 * client=dict-chrome-ex (Resmi Chrome eklenti istemcisi - 429 kotalarından etkilenmez)
 */

const translationCache = new Map();

async function translateSingle(text, sl = 'auto', tl = 'tr') {
  if (!text || !text.trim()) return text;
  const trimmed = text.trim();
  if (translationCache.has(trimmed)) {
    return translationCache.get(trimmed);
  }

  const clients = ['dict-chrome-ex', 'gtx'];
  for (const client of clients) {
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=${client}&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(trimmed)}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        if (data && data[0] && Array.isArray(data[0])) {
          const res = data[0].map(segment => segment[0]).filter(Boolean).join('');
          if (res) {
            translationCache.set(trimmed, res);
            return res;
          }
        }
      }
    } catch (e) {}
  }

  return text;
}

// Birden çok metni tek bir istekte birleştirerek çevirir (İstek sayısını onlarca kat azaltır ve 429 hatasını önler)
async function translateBatchGroup(texts, sl = 'auto', tl = 'tr') {
  if (!texts || texts.length === 0) return [];

  const results = new Array(texts.length);
  const toFetchIndices = [];
  const toFetchTexts = [];

  texts.forEach((txt, idx) => {
    const trimmed = (txt || '').trim();
    if (!trimmed) {
      results[idx] = txt;
    } else if (translationCache.has(trimmed)) {
      results[idx] = translationCache.get(trimmed);
    } else {
      toFetchIndices.push(idx);
      toFetchTexts.push(trimmed);
    }
  });

  if (toFetchTexts.length === 0) {
    return results;
  }

  const SEP = '\n=====\n';
  const joined = toFetchTexts.join(SEP);

  let fetched = false;
  const clients = ['dict-chrome-ex', 'gtx'];

  for (const client of clients) {
    if (fetched) break;
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=${client}&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(joined)}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        if (data && data[0] && Array.isArray(data[0])) {
          const fullTranslation = data[0].map(s => s[0]).filter(Boolean).join('');
          const splitResults = fullTranslation.split(/\n\s*=====\s*\n/);
          
          if (splitResults.length === toFetchTexts.length) {
            toFetchIndices.forEach((origIdx, i) => {
              const trText = (splitResults[i] || toFetchTexts[i]).trim();
              translationCache.set(toFetchTexts[i], trText);
              results[origIdx] = trText;
            });
            fetched = true;
          }
        }
      }
    } catch (e) {}
  }

  if (!fetched) {
    for (let i = 0; i < toFetchTexts.length; i++) {
      const origIdx = toFetchIndices[i];
      const tr = await translateSingle(toFetchTexts[i], sl, tl);
      results[origIdx] = tr;
    }
  }

  return results;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translateBatch') {
    const texts = request.texts || [];
    translateBatchGroup(texts, request.sl || 'auto', request.tl || 'tr')
      .then(results => sendResponse({ success: true, results }))
      .catch(err => sendResponse({ success: false, error: err.message, results: texts }));
    return true;
  }

  if (request.action === 'translateText') {
    translateSingle(request.text, request.sl || 'auto', request.tl || 'tr')
      .then(translated => sendResponse({ success: true, translated }))
      .catch(err => sendResponse({ success: false, error: err.message, original: request.text }));
    return true;
  }
});
