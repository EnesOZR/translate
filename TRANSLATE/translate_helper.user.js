// ==UserScript==
// @name         Oppo GKM Çeviri & Form Otomasyon Asistanı (v2.9)
// @namespace    http://tampermonkey.net/
// @version      2.9.0
// @description  Tüm sayfayı genel olarak Türkçeye çevirir, Vue/SPA dinamik içeriklerini izler, None seçer ve Roma rakamı alert bildirimi verir.
// @author       Antigravity
// @match        *://gkm.oppo.com/*
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function() {
  'use strict';

  if (window.__trUserScriptLoaded) return;
  window.__trUserScriptLoaded = true;

  const translationMemory = [];
  const processedNodes = new WeakSet();
  let isTranslated = false;
  let isTranslating = false;
  let isNoneChecked = false;
  let hasAlertedForRoman = false;
  let mutationDebounceTimer = null;

  // Kalıcı ayar: Varsayılan AÇIK (true)
  let isAutoTranslateActive = true;
  try {
    const val = typeof GM_getValue !== 'undefined' ? GM_getValue('gkm_translation_active', true) : localStorage.getItem('gkm_translation_active');
    if (val !== null && val !== undefined) isAutoTranslateActive = (val === true || val === 'true');
  } catch (e) {}

  function persistState(val) {
    isAutoTranslateActive = val;
    try {
      if (typeof GM_setValue !== 'undefined') GM_setValue('gkm_translation_active', val);
      localStorage.setItem('gkm_translation_active', val ? 'true' : 'false');
    } catch (e) {}
  }

  // Toast Bildirim
  function showToast(msg, type = 'success') {
    let c = document.getElementById('tr-toast-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'tr-toast-container';
      document.body.appendChild(c);
    }
    const t = document.createElement('div');
    t.className = `tr-toast ${type}`;
    t.innerHTML = `<span style="font-weight: 500;">${msg}</span>`;
    c.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  // None kutusu seçimi
  function setNoneCheckboxChecked(silent = true) {
    const wrappers = document.querySelectorAll('.ant-checkbox-wrapper, label');
    for (const w of wrappers) {
      if ((w.textContent || '').trim().toLowerCase().includes('none')) {
        const input = w.querySelector('input[type="checkbox"]') || (w.matches('input') ? w : null);
        if (input && !input.checked) {
          input.click();
          input.checked = true;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('input', { bubbles: true }));
          isNoneChecked = true;
          if (!silent) showToast('"None" kutusu işaretlendi.', 'success');
          return true;
        } else if (input && input.checked) {
          isNoneChecked = true;
          return true;
        }
      }
    }
    return false;
  }

  const userTranslationCache = new Map();

  async function rawFetchUrl(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'undefined') {
        GM_xmlhttpRequest({
          method: 'GET',
          url: url,
          onload: (res) => {
            try {
              const data = JSON.parse(res.responseText);
              resolve(data);
            } catch (e) { reject(e); }
          },
          onerror: (err) => reject(err)
        });
      } else {
        fetch(url)
          .then(r => r.json())
          .then(resolve)
          .catch(reject);
      }
    });
  }

  async function fetchTranslateSingle(text, sl = 'auto', tl = 'tr') {
    if (!text || !text.trim()) return text;
    const trimmed = text.trim();
    if (userTranslationCache.has(trimmed)) {
      return userTranslationCache.get(trimmed);
    }

    const clients = ['dict-chrome-ex', 'gtx'];
    for (const client of clients) {
      try {
        const url = `https://translate.googleapis.com/translate_a/single?client=${client}&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(trimmed)}`;
        const data = await rawFetchUrl(url);
        if (data && data[0] && Array.isArray(data[0])) {
          const res = data[0].map(s => s[0]).filter(Boolean).join('');
          if (res) {
            userTranslationCache.set(trimmed, res);
            return res;
          }
        }
      } catch (e) {}
    }
    return text;
  }

  async function translateBatch(texts, sl = 'auto', tl = 'tr') {
    if (!texts || texts.length === 0) return [];

    const results = new Array(texts.length);
    const toFetchIndices = [];
    const toFetchTexts = [];

    texts.forEach((txt, idx) => {
      const trimmed = (txt || '').trim();
      if (!trimmed) {
        results[idx] = txt;
      } else if (userTranslationCache.has(trimmed)) {
        results[idx] = userTranslationCache.get(trimmed);
      } else {
        toFetchIndices.push(idx);
        toFetchTexts.push(trimmed);
      }
    });

    if (toFetchTexts.length === 0) return results;

    const SEP = '\n=====\n';
    const joined = toFetchTexts.join(SEP);

    let fetched = false;
    const clients = ['dict-chrome-ex', 'gtx'];

    for (const client of clients) {
      if (fetched) break;
      try {
        const url = `https://translate.googleapis.com/translate_a/single?client=${client}&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(joined)}`;
        const data = await rawFetchUrl(url);
        if (data && data[0] && Array.isArray(data[0])) {
          const fullTranslation = data[0].map(s => s[0]).filter(Boolean).join('');
          const splitResults = fullTranslation.split(/\n\s*=====\s*\n/);
          if (splitResults.length === toFetchTexts.length) {
            toFetchIndices.forEach((origIdx, i) => {
              const trText = (splitResults[i] || toFetchTexts[i]).trim();
              userTranslationCache.set(toFetchTexts[i], trText);
              results[origIdx] = trText;
            });
            fetched = true;
          }
        }
      } catch (e) {}
    }

    if (!fetched) {
      for (let i = 0; i < toFetchTexts.length; i++) {
        const origIdx = toFetchIndices[i];
        const tr = await fetchTranslateSingle(toFetchTexts[i], sl, tl);
        results[origIdx] = tr;
      }
    }

    return results;
  }

  function isRightEditorElement(el) {
    if (!el) return false;
    return !!el.closest('.rightEditor, .edui-editor, .edui-default, [id^="editor_"], [id^="edui"], #tr-auto-widget, #tr-toast-container');
  }

  // Belli başlı HTML seçicileriyle sınırlandırılmaz; tüm genel metinleri toplar
  function collectAllPageTextNodes() {
    const list = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          if (!node.parentElement) return NodeFilter.FILTER_REJECT;
          if (node.parentElement.closest('#tr-auto-widget, #tr-toast-container')) {
            return NodeFilter.FILTER_REJECT;
          }
          const tag = node.parentElement.tagName.toLowerCase();
          // Input ve textarea kutularına dokunma!
          if (['script', 'style', 'noscript', 'textarea', 'input', 'select'].includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }

          // Kural: Makale içerik alanı (.content veya .ant-card-body) KESİNLİKLE ÇEVRİLSİN!
          const isArticleContent = node.parentElement.closest('.content, .ant-card-body');

          // Sağ editör alanını çeviri dışı tut
          if (!isArticleContent && isRightEditorElement(node.parentElement)) {
            return NodeFilter.FILTER_REJECT;
          }

          if (processedNodes.has(node)) {
            return NodeFilter.FILTER_REJECT;
          }
          const val = (node.nodeValue || '').trim();
          if (val.length < 2 || /^\d+$/.test(val)) {
            return NodeFilter.FILTER_REJECT;
          }
          if (!/[a-zA-Z\u4e00-\u9fa5]/.test(val)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let cur;
    while ((cur = walker.nextNode())) list.push(cur);

    // Eğer iframe varsa onu da topla (Sağ editör iframe'leri hariç)
    document.querySelectorAll('iframe').forEach(iframe => {
      try {
        if (isRightEditorElement(iframe)) {
          return;
        }
        if (iframe.contentDocument && iframe.contentDocument.body) {
          const ifWalker = iframe.contentDocument.createTreeWalker(
            iframe.contentDocument.body,
            NodeFilter.SHOW_TEXT,
            {
              acceptNode: function(node) {
                if (!node.parentElement) return NodeFilter.FILTER_REJECT;
                const tag = node.parentElement.tagName.toLowerCase();
                if (['script', 'style', 'noscript', 'textarea', 'input', 'select'].includes(tag)) return NodeFilter.FILTER_REJECT;
                const isContent = node.parentElement.closest('.content, .ant-card-body');
                if (!isContent && isRightEditorElement(node.parentElement)) return NodeFilter.FILTER_REJECT;
                if (processedNodes.has(node)) return NodeFilter.FILTER_REJECT;
                const val = (node.nodeValue || '').trim();
                if (val.length < 2 || /^\d+$/.test(val)) return NodeFilter.FILTER_REJECT;
                if (!/[a-zA-Z\u4e00-\u9fa5]/.test(val)) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
              }
            }
          );
          let n;
          while ((n = ifWalker.nextNode())) list.push(n);
        }
      } catch (e) {}
    });

    return list;
  }

  // Genel çeviriyi uygula
  async function applyFullPageTranslation(isIncremental = false) {
    if (isTranslating) return;

    if (!isIncremental && translationMemory.length > 0 && !isTranslated) {
      translationMemory.forEach(item => {
        if (item.node && item.node.parentNode) item.node.nodeValue = item.translated;
      });
      isTranslated = true;
      setNoneCheckboxChecked(true);
      updateUI();
      showToast('Genel Çeviri Aktif (TR)', 'active');
      return;
    }

    const nodes = collectAllPageTextNodes();
    if (nodes.length === 0) {
      if (!isIncremental) updateUI();
      return;
    }

    isTranslating = true;
    updateUI();
    if (!isIncremental) showToast('Sayfa genel olarak çevriliyor...', 'info');

    // Benzersiz metinler (Hızlı paralel çeviri)
    const uniqueMap = new Map();
    nodes.forEach(n => {
      const orig = n.nodeValue.trim();
      if (!uniqueMap.has(orig)) uniqueMap.set(orig, '');
    });

    const uniqueTexts = Array.from(uniqueMap.keys());
    const chunkSize = 20;

    for (let i = 0; i < uniqueTexts.length; i += chunkSize) {
      const chunk = uniqueTexts.slice(i, i + chunkSize);
      const translatedChunk = await translateBatch(chunk);
      chunk.forEach((orig, idx) => {
        uniqueMap.set(orig, translatedChunk[idx] || orig);
      });
    }

    let romanFound = false;

    nodes.forEach(node => {
      const orig = node.nodeValue.trim();
      const tr = uniqueMap.get(orig) || orig;

      if (/(?:^|(?<=[\s\n\r>]))Ben\./i.test(tr) || /(?:^|(?<=[\s\n\r>]))Ben\s+[A-ZÇĞİÖŞÜ]/.test(tr)) {
        romanFound = true;
      }

      processedNodes.add(node);
      translationMemory.push({ node, original: node.nodeValue, translated: tr });
      node.nodeValue = tr;
    });

    isTranslating = false;
    isTranslated = true;
    setNoneCheckboxChecked(true);

    if (romanFound && !hasAlertedForRoman) {
      hasAlertedForRoman = true;
      showToast('Dikkat: Sayfada "Ben." (I.) tespit edildi!', 'warning');
      setTimeout(() => {
        alert('DİKKAT:\n\nSayfada Roma rakamı ("Ben." / "I.") tespit edildi!\nLütfen ilgili başlığı kontrol ediniz.');
      }, 300);
    }

    updateUI();
    if (!isIncremental) showToast('Tüm sayfa genel olarak çevrildi.', 'active');
  }

  function restoreOriginal() {
    translationMemory.forEach(item => {
      if (item.node && item.node.parentNode) item.node.nodeValue = item.original;
    });
    isTranslated = false;
    updateUI();
    showToast('Orijinal dile dönüldü (EN).', 'info');
  }

  function toggle() {
    if (isAutoTranslateActive) {
      persistState(false);
      restoreOriginal();
    } else {
      persistState(true);
      applyFullPageTranslation();
    }
  }

  function updateUI() {
    const badge = document.getElementById('u-badge');
    const btn = document.getElementById('u-btn-toggle');
    const count = document.getElementById('u-count');

    if (badge && btn) {
      if (isAutoTranslateActive) {
        badge.className = 'tr-state-badge active';
        badge.innerHTML = `<span><span class="tr-dot"></span> <strong>GENEL ÇEVİRİ: AÇIK (TR)</strong></span> <span class="tr-badge-toggle-hint">Ctrl+B</span>`;
        btn.className = 'tr-btn tr-btn-danger';
        btn.innerHTML = `<span>Çeviriyi Duraklat (Ctrl + B)</span>`;
      } else {
        badge.className = 'tr-state-badge inactive';
        badge.innerHTML = `<span><span class="tr-dot"></span> <strong>GENEL ÇEVİRİ: KAPALI (EN)</strong></span> <span class="tr-badge-toggle-hint">Ctrl+B</span>`;
        btn.className = 'tr-btn tr-btn-primary';
        btn.innerHTML = `<span>Çeviriyi Başlat (Ctrl + B)</span>`;
      }
    }
    if (count) {
      count.textContent = `Çevrilen: ${translationMemory.length}`;
    }
  }

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      toggle();
    }
  }, true);

  function createUI() {
    if (document.getElementById('tr-auto-widget')) return;

    // Apple Beige CSS Stili Ekle
    const style = document.createElement('style');
    style.textContent = `
      #tr-auto-widget {
        position: fixed; bottom: 24px; right: 24px; z-index: 9999999;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", Arial, sans-serif;
        font-size: 13px; color: #24201c; user-select: none;
      }
      #tr-auto-widget * { box-sizing: border-box; }
      .tr-widget-card {
        background: rgba(251, 249, 245, 0.94);
        backdrop-filter: blur(24px) saturate(180%);
        -webkit-backdrop-filter: blur(24px) saturate(180%);
        border: 1px solid rgba(212, 203, 189, 0.85);
        border-radius: 16px;
        box-shadow: 0 16px 40px -6px rgba(45, 35, 25, 0.12), 0 4px 16px -2px rgba(45, 35, 25, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.9);
        width: 326px; overflow: hidden;
      }
      .tr-widget-header {
        padding: 10px 14px;
        background: linear-gradient(180deg, #f7f4ed 0%, #ece5d8 100%);
        border-bottom: 1px solid rgba(212, 203, 189, 0.85);
        display: flex; align-items: center; justify-content: space-between;
      }
      .tr-apple-dots { display: inline-flex; align-items: center; gap: 5.5px; }
      .tr-apple-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
      .tr-apple-dot.red { background: #ff5f56; border: 0.5px solid rgba(0,0,0,0.12); }
      .tr-apple-dot.yellow { background: #ffbd2e; border: 0.5px solid rgba(0,0,0,0.12); }
      .tr-apple-dot.green { background: #27c93f; border: 0.5px solid rgba(0,0,0,0.12); }
      .tr-brand-tag {
        font-size: 10px; font-weight: 700; padding: 1.5px 5.5px; border-radius: 4px;
        background: rgba(180, 165, 145, 0.25); color: #52473c; text-transform: uppercase;
      }
      .tr-state-badge {
        display: flex; align-items: center; justify-content: space-between;
        padding: 9px 12px; border-radius: 9px; font-size: 12px; font-weight: 600;
      }
      .tr-state-badge.active {
        background: rgba(27, 99, 56, 0.08); border: 1px solid rgba(27, 99, 56, 0.24); color: #1b6338;
      }
      .tr-state-badge.inactive {
        background: rgba(107, 99, 89, 0.07); border: 1px solid rgba(107, 99, 89, 0.2); color: #6b6359;
      }
      .tr-dot { width: 7.5px; height: 7.5px; border-radius: 50%; display: inline-block; }
      .tr-state-badge.active .tr-dot { background: #1b6338; box-shadow: 0 0 0 2.5px rgba(27, 99, 56, 0.15); }
      .tr-state-badge.inactive .tr-dot { background: #877e73; }
      .tr-badge-toggle-hint { font-size: 10.5px; opacity: 0.75; background: rgba(0,0,0,0.05); padding: 2px 5px; border-radius: 4px; }
      .tr-btn {
        display: flex; align-items: center; justify-content: center; gap: 7px;
        padding: 9px 12px; border-radius: 9px; font-size: 12px; font-weight: 600;
        cursor: pointer; border: 1px solid transparent; transition: all 0.18s ease; outline: none; width: 100%;
      }
      .tr-btn:active { transform: scale(0.98); }
      .tr-btn-primary { background: #1b6338; color: #fff; border: 1px solid #144f2c; box-shadow: 0 2px 6px rgba(27,99,56,0.2); }
      .tr-btn-danger { background: #24201c; color: #faf8f5; border: 1px solid #161310; box-shadow: 0 2px 6px rgba(36,32,28,0.18); }
      .tr-btn-copy {
        background: rgba(255, 255, 255, 0.9); border: 1px solid rgba(214, 205, 191, 0.9);
        color: #24201c; box-shadow: 0 1px 2px rgba(45,35,25,0.05); font-weight: 600;
        display: flex; align-items: center; justify-content: center; gap: 7px;
      }
      .tr-btn-copy:hover {
        background: #ffffff; border-color: rgba(185, 173, 156, 1);
        box-shadow: 0 2px 6px rgba(45, 35, 25, 0.09); transform: translateY(-1px);
      }
      .tr-btn-secondary {
        background: rgba(255, 255, 255, 0.82); border: 1px solid rgba(214, 205, 191, 0.9); color: #2c2722;
        box-shadow: 0 1px 2px rgba(45,35,25,0.05);
      }
      .tr-btn-secondary:hover { background: #fff; border-color: rgba(185, 173, 156, 0.95); }
      .tr-btn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .tr-copy-highlight { animation: tr-copy-glow 0.8s ease-out; border-radius: 6px; }
      @keyframes tr-copy-glow {
        0% { outline: 3px solid rgba(27, 99, 56, 0.6); background-color: rgba(27, 99, 56, 0.05); }
        100% { outline: 3px solid transparent; background-color: transparent; }
      }
      #tr-toast-container { position: fixed; top: 24px; right: 24px; z-index: 10000001; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
      .tr-toast {
        pointer-events: auto; min-width: 250px; padding: 10px 14px; border-radius: 12px;
        background: rgba(251, 249, 245, 0.95); backdrop-filter: blur(20px);
        color: #24201c; font-size: 12px; border: 1px solid rgba(212, 203, 189, 0.85);
        border-left: 3.5px solid #1b6338; box-shadow: 0 12px 32px rgba(45, 35, 25, 0.12);
      }
    `;
    document.head.appendChild(style);

    const w = document.createElement('div');
    w.id = 'tr-auto-widget';
    w.innerHTML = `
      <div class="tr-widget-card">
        <div class="tr-widget-header">
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="tr-apple-dots">
              <span class="tr-apple-dot red"></span>
              <span class="tr-apple-dot yellow"></span>
              <span class="tr-apple-dot green"></span>
            </span>
            <span style="font-weight:600;font-size:12.5px;color:#24201c;">Çeviri Asistanı</span>
            <span class="tr-brand-tag">Enes OZER</span>
          </div>
        </div>
        <div style="padding:14px 15px;display:flex;flex-direction:column;gap:10px;">
          <div id="u-badge" class="tr-state-badge ${isAutoTranslateActive ? 'active' : 'inactive'}">
            <span><span class="tr-dot"></span> <strong>${isAutoTranslateActive ? 'GENEL ÇEVİRİ: AÇIK (TR)' : 'GENEL ÇEVİRİ: KAPALI (EN)'}</strong></span>
            <span class="tr-badge-toggle-hint">Ctrl+B</span>
          </div>
          <button class="tr-btn ${isAutoTranslateActive ? 'tr-btn-danger' : 'tr-btn-primary'}" id="u-btn-toggle">
            <span>${isAutoTranslateActive ? 'Çeviriyi Duraklat (Ctrl + B)' : 'Çeviriyi Başlat (Ctrl + B)'}</span>
          </button>
          <button class="tr-btn tr-btn-copy" id="u-btn-copy" title="Makaleyi tüm renk ve stilleriyle kopyalar (Alt + C)">
            <span id="u-btn-copy-text">Makaleyi Kopyala</span>
          </button>
          <div class="tr-btn-grid">
            <button class="tr-btn tr-btn-secondary" id="u-btn-none">None Seç</button>
            <button class="tr-btn tr-btn-secondary" id="u-btn-re">Yeniden Çevir</button>
          </div>
          <div style="font-size:11px;color:#6e6459;display:flex;justify-content:space-between;border-top:1px solid rgba(224, 216, 204, 0.7);padding-top:8px;">
            <span>Kayıtlı: <strong style="color:#1b6338;">AÇIK</strong></span>
            <span id="u-count">Çevrilen: 0</span>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(w);

    document.getElementById('u-btn-toggle').onclick = toggle;
    document.getElementById('u-btn-copy').onclick = copyRichArticleContent;
    document.getElementById('u-btn-none').onclick = () => setNoneCheckboxChecked(false);
    document.getElementById('u-btn-re').onclick = () => {
      translationMemory.length = 0;
      hasAlertedForRoman = false;
      applyFullPageTranslation();
    };

    updateUI();
  }

  // Makale İçeriğini Renkleriyle Birlikte Kopyalama
  function findArticleContentElement() {
    // 1. Doğrudan sol taraftaki makale gövdesini ara (.content ve türevleri)
    const selectors = [
      '.ant-card-body .content',
      '.content[data-v-e78230f6]',
      'div.content',
      '[class*="content"]',
      '.ant-card-body',
      '.ant-card'
    ];

    for (const sel of selectors) {
      try {
        const candidates = document.querySelectorAll(sel);
        for (const el of candidates) {
          if (!isRightEditorElement(el)) {
            // Eğer aranan öğe içinde .content varsa onu önceliklendir
            const inner = el.classList.contains('content') ? el : (el.querySelector('.content') || el);
            const txt = (inner.innerText || inner.textContent || '').trim();
            if (txt.length > 10) {
              return inner;
            }
          }
        }
      } catch (e) {}
    }

    // 2. Başlık bazlı akıllı arama: Sayfada "Sorunun Tanımı" / "Problem Description" içeren başlığı bul
    const headings = document.querySelectorAll('h1, h2, h3, strong, span, p');
    for (const h of headings) {
      if (isRightEditorElement(h)) continue;
      const t = (h.textContent || '').trim().toLowerCase();
      if (
        t.includes('sorunun tanımı') ||
        t.includes('problem description') ||
        t.includes('cause analysis') ||
        t.includes('neden analizi') ||
        t.includes('solution') ||
        t.includes('çözüm') ||
        t.includes('senaryo') ||
        t.includes('scenario') ||
        t.includes('kapsam') ||
        t.includes('scope') ||
        t.startsWith('i.')
      ) {
        const container = h.closest('.content, .ant-card-body, [data-v-e78230f6], .ant-card');
        if (container && !isRightEditorElement(container)) {
          const inner = container.classList.contains('content') ? container : (container.querySelector('.content') || container);
          return inner;
        }

        let parent = h.parentElement;
        while (parent && parent !== document.body && !isRightEditorElement(parent)) {
          const pText = (parent.innerText || parent.textContent || '').trim();
          if (pText.length > 50 && (parent.querySelector('h1') || parent.querySelectorAll('p').length >= 2)) {
            return parent;
          }
          parent = parent.parentElement;
        }
      }
    }

    // 3. Yapısal arama: Sağ editör dışında olup başlık ve birden fazla paragraf içeren ana div
    const allDivs = document.querySelectorAll('div');
    for (const d of allDivs) {
      if (isRightEditorElement(d)) continue;
      if (d.querySelector('h1') && d.querySelectorAll('p').length >= 2) {
        const txt = (d.innerText || d.textContent || '').trim();
        if (txt.length > 50) {
          const inner = d.querySelector('.content') || d;
          return inner;
        }
      }
    }

    // 4. İframe içindeki makaleler (sağ editör hariç)
    const iframes = document.querySelectorAll('iframe');
    for (const ifr of iframes) {
      try {
        if (isRightEditorElement(ifr)) continue;
        const ifrDoc = ifr.contentDocument || (ifr.contentWindow && ifr.contentWindow.document);
        if (ifrDoc) {
          for (const sel of selectors) {
            const candidates = ifrDoc.querySelectorAll(sel);
            for (const el of candidates) {
              if (!isRightEditorElement(el)) {
                const txt = (el.innerText || el.textContent || '').trim();
                if (txt.length > 10) {
                  return el;
                }
              }
            }
          }
        }
      } catch (e) {}
    }

    // 5. Kullanıcının aktif seçimi varsa onu kopyala
    const selObj = window.getSelection();
    if (selObj && selObj.rangeCount > 0 && !selObj.isCollapsed) {
      const range = selObj.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const el = container.nodeType === 1 ? container : container.parentElement;
      if (!isRightEditorElement(el)) {
        return el;
      }
    }

    return null;
  }

  function copyRichArticleContent() {
    const el = findArticleContentElement();
    if (!el) {
      showToast('⚠️ Makale içerik alanı (.content) bulunamadı!', 'warning');
      return false;
    }

    el.classList.remove('tr-copy-highlight');
    void el.offsetWidth;
    el.classList.add('tr-copy-highlight');
    setTimeout(() => el.classList.remove('tr-copy-highlight'), 1000);

    let copied = false;

    try {
      const doc = el.ownerDocument || document;
      const win = doc.defaultView || window;
      const selection = win.getSelection();
      const prevRange = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

      const range = doc.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);

      copied = doc.execCommand('copy');

      selection.removeAllRanges();
      if (prevRange) {
        try { selection.addRange(prevRange); } catch (e) {}
      }
    } catch (err) {
      console.warn('execCommand copy hatası:', err);
      copied = false;
    }

    if (!copied && navigator.clipboard && window.ClipboardItem) {
      try {
        const htmlData = el.innerHTML;
        const textData = el.innerText || el.textContent;
        const htmlBlob = new Blob([htmlData], { type: 'text/html' });
        const textBlob = new Blob([textData], { type: 'text/plain' });

        navigator.clipboard.write([
          new ClipboardItem({
            'text/html': htmlBlob,
            'text/plain': textBlob
          })
        ]).then(() => {
          triggerCopySuccessUI();
        }).catch(err => {
          console.error('ClipboardItem yazma hatası:', err);
          showToast('Kopyalama başarısız oldu.', 'error');
        });
        return true;
      } catch (err) {
        console.error('Clipboard fallback hatası:', err);
      }
    }

    if (copied) {
      triggerCopySuccessUI();
      return true;
    } else {
      showToast('Kopyalama yapılamadı, lütfen tekrar deneyin.', 'error');
      return false;
    }
  }

  function triggerCopySuccessUI() {
    showToast('Makale kopyalandı.', 'success');
    const btnText = document.getElementById('u-btn-copy-text');
    if (btnText) {
      const old = btnText.textContent;
      btnText.textContent = 'Kopyalandı';
      setTimeout(() => { btnText.textContent = old; }, 1800);
    }
  }

  // Dinamik İzleyici (Vue/SPA DOM güncellemeleri)
  function setupWatcher() {
    const observer = new MutationObserver(() => {
      if (!isAutoTranslateActive) return;
      if (!isNoneChecked) setNoneCheckboxChecked(true);

      clearTimeout(mutationDebounceTimer);
      mutationDebounceTimer = setTimeout(() => {
        if (isAutoTranslateActive) applyFullPageTranslation(true);
      }, 300);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    let sweeps = 0;
    const interval = setInterval(() => {
      sweeps++;
      if (isAutoTranslateActive) {
        setNoneCheckboxChecked(true);
        applyFullPageTranslation(true);
      }
      if (sweeps >= 10) clearInterval(interval);
    }, 600);
  }

  // Klavye Kısayolları (Ctrl + B = Aç/Kapa, Alt + C = Renkli Kopyala)
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      toggle();
    } else if (e.altKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      copyRichArticleContent();
    }
  }, true);

  function init() {
    createUI();
    setNoneCheckboxChecked(true);
    if (isAutoTranslateActive) {
      applyFullPageTranslation();
    }
    setupWatcher();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
