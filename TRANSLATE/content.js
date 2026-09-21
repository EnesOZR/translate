/**
 * Oppo GKM Çeviri & Form Otomasyon Asistası (v2.9)
 * 
 * 1. GENEL SAYFA ÇEVİRİSİ (Full Page General Translate):
 *    - Belli başlı HTML sınıflarıyla (content, card vb.) sınırlandırılmaz.
 *    - Sayfadaki tüm başlıkları (h1-h6), paragrafları, etiketleri, butonları,
 *      tabloları ve kartları Chrome'un sağ tık Translate özelliği gibi genel olarak çevirir.
 *    - Dinamik MutationObserver ile Vue/SPA sonradan içerik yüklediğinde de otomatik çevirir.
 * 
 * 2. Form Giriş Alanları Asla Doldurulmaz:
 *    - "* Translate Title" ve diğer form input / textarea kutularına kesinlikle dokunulmaz.
 * 
 * 3. Kalıcı Açık/Kapalı Ayarı:
 *    - F5 atıldığında veya yeni sayfaya geçildiğinde ayar AÇIK kalır ve sayfayı otomatik çevirir.
 * 
 * 4. Roma Rakamı Bildirimi (ALERT):
 *    - Metin otomatik değiştirilmez, sayfada "Ben." / "I." tespit edilirse ekrana alert uyarısı verilir.
 * 
 * 5. "None" Checkbox:
 *    - Select Collection yanındaki None kutucuğu otomatik işaretlenir.
 */

(function () {
  'use strict';

  if (window.__trAssistantLoaded) return;
  window.__trAssistantLoaded = true;

  // Bellek ve durum yönetimi
  const translationMemory = [];
  const processedNodes = new WeakSet();
  let isTranslated = false;
  let isTranslating = false;
  let isNoneChecked = false;
  let hasAlertedForRoman = false;
  let mutationObserver = null;
  let mutationDebounceTimer = null;

  // Kalıcı durum: Varsayılan AÇIK (true)
  let isAutoTranslateActive = true;
  try {
    const localVal = localStorage.getItem('gkm_translation_active');
    if (localVal !== null) {
      isAutoTranslateActive = (localVal === 'true');
    } else {
      isAutoTranslateActive = true;
      localStorage.setItem('gkm_translation_active', 'true');
    }
  } catch (e) {
    isAutoTranslateActive = true;
  }

  function initStorage(callback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['gkm_translation_active'], (res) => {
        if (res && typeof res.gkm_translation_active === 'boolean') {
          isAutoTranslateActive = res.gkm_translation_active;
        }
        if (callback) callback();
      });
    } else {
      if (callback) callback();
    }
  }

  function persistState(active) {
    isAutoTranslateActive = active;
    try {
      localStorage.setItem('gkm_translation_active', active ? 'true' : 'false');
    } catch (e) { }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ gkm_translation_active: active });
    }
  }

  // ==========================================
  // TOAST BİLDİRİM SİSTEMİ
  // ==========================================
  function showToast(message, type = 'success', duration = 3000) {
    let container = document.getElementById('tr-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'tr-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `tr-toast ${type}`;
    toast.innerHTML = `
      <div style="flex: 1; font-weight: 500;">${message}</div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-8px) scale(0.95)';
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  // ==========================================
  // 1. "NONE" CHECKBOX SEÇİMİ
  // ==========================================
  function findNoneCheckbox() {
    const wrappers = document.querySelectorAll('.ant-checkbox-wrapper, label');
    for (const w of wrappers) {
      const text = (w.textContent || '').trim().toLowerCase();
      if (text === 'none' || text.includes('none')) {
        const input = w.querySelector('input[type="checkbox"]') || (w.matches('input') ? w : null);
        return { wrapper: w, input: input };
      }
    }

    const buttons = Array.from(document.querySelectorAll('button, .ant-btn'));
    const btn = buttons.find(b => b.textContent.includes('Select Collection') || b.textContent.includes('Collection'));
    if (btn) {
      const container = btn.closest('div');
      if (container) {
        const chk = container.querySelector('.ant-checkbox-wrapper, input[type="checkbox"]');
        if (chk) {
          const input = chk.matches('input') ? chk : chk.querySelector('input');
          return { wrapper: chk, input: input };
        }
      }
    }
    return null;
  }

  function setNoneCheckboxChecked(silent = true) {
    const target = findNoneCheckbox();
    if (!target) return false;

    const { wrapper, input } = target;
    const checked = input ? input.checked : wrapper.classList.contains('ant-checkbox-wrapper-checked');

    if (checked) {
      isNoneChecked = true;
      return true;
    }

    if (input) {
      input.click();
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      wrapper.click();
    }

    isNoneChecked = true;
    if (!silent) showToast('"None" kutusu işaretlendi.', 'success');
    return true;
  }

  function watchNoneCheckbox() {
    if (setNoneCheckboxChecked(true)) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      if (setNoneCheckboxChecked(true) || attempts > 20) {
        clearInterval(timer);
      }
    }, 400);
  }

  // ==========================================
  // 2. HIZLI PARALEL ÇEVİRİ MOTORU
  // ==========================================
  async function requestBatchTranslation(texts) {
    if (!texts || texts.length === 0) return [];

    return new Promise((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          directBatchTranslate(texts).then(resolve);
        }
      }, 2500);

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        try {
          chrome.runtime.sendMessage({ action: 'translateBatch', texts }, (response) => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              if (response && response.success && response.results) {
                resolve(response.results);
              } else {
                directBatchTranslate(texts).then(resolve);
              }
            }
          });
        } catch (e) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            directBatchTranslate(texts).then(resolve);
          }
        }
      } else {
        clearTimeout(timeout);
        directBatchTranslate(texts).then(resolve);
      }
    });
  }

  const contentTranslationCache = new Map();

  async function directBatchTranslate(texts) {
    if (!texts || texts.length === 0) return [];

    const results = new Array(texts.length);
    const toFetchIndices = [];
    const toFetchTexts = [];

    texts.forEach((txt, idx) => {
      const trimmed = (txt || '').trim();
      if (!trimmed) {
        results[idx] = txt;
      } else if (contentTranslationCache.has(trimmed)) {
        results[idx] = contentTranslationCache.get(trimmed);
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
        const url = `https://translate.googleapis.com/translate_a/single?client=${client}&sl=auto&tl=tr&dt=t&q=${encodeURIComponent(joined)}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (data && data[0] && Array.isArray(data[0])) {
            const fullTranslation = data[0].map(s => s[0]).filter(Boolean).join('');
            const splitResults = fullTranslation.split(/\n\s*=====\s*\n/);
            if (splitResults.length === toFetchTexts.length) {
              toFetchIndices.forEach((origIdx, i) => {
                const trText = (splitResults[i] || toFetchTexts[i]).trim();
                contentTranslationCache.set(toFetchTexts[i], trText);
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
        let tr = toFetchTexts[i];
        for (const client of clients) {
          try {
            const url = `https://translate.googleapis.com/translate_a/single?client=${client}&sl=auto&tl=tr&dt=t&q=${encodeURIComponent(toFetchTexts[i])}`;
            const res = await fetch(url);
            if (res.ok) {
              const data = await res.json();
              if (data && data[0] && Array.isArray(data[0])) {
                tr = data[0].map(s => s[0]).filter(Boolean).join('');
                break;
              }
            }
          } catch (e) {}
        }
        contentTranslationCache.set(toFetchTexts[i], tr);
        results[origIdx] = tr;
      }
    }

    return results;
  }

  // ==========================================
  // 3. GENEL SAYFA METİNLERİNİ TOPLAMA (TreeWalker)
  // Belli başlı seçicilerle sınırlanmaz; tüm sayfayı genel tarar.
  // ==========================================
  function collectNodesFromDocument(doc, targetList) {
    if (!doc || !doc.body) return;

    const walker = doc.createTreeWalker(
      doc.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          if (!node.parentElement) return NodeFilter.FILTER_REJECT;

          // Eklenti kendi panelini ve bildirimlerini çevirmez
          if (node.parentElement.closest('#tr-auto-widget, #tr-toast-container')) {
            return NodeFilter.FILTER_REJECT;
          }

          // Script, style, textarea ve input kutularına ASLA dokunma! (Kullanıcının form alanları korunur)
          const tag = node.parentElement.tagName.toLowerCase();
          if (['script', 'style', 'noscript', 'textarea', 'input', 'select'].includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }

          // Kural: Eğer bu metin makale içerik alanı (.content veya .ant-card-body) içindeyse KESİNLİKLE ÇEVİR!
          const isArticleContent = node.parentElement.closest('.content, .ant-card-body');

          // Sağ editör alanını çeviri dışı tut
          // (Ama sol makale .content / .ant-card-body kesinlikle çevrilsin!)
          if (!isArticleContent && isRightEditorElement(node.parentElement)) {
            return NodeFilter.FILTER_REJECT;
          }

          // Zaten çevrilmiş düğümleri tekrar alma
          if (processedNodes.has(node)) {
            return NodeFilter.FILTER_REJECT;
          }

          const val = (node.nodeValue || '').trim();
          // Sayı veya tek karakterleri atla
          if (val.length < 2 || /^\d+$/.test(val)) {
            return NodeFilter.FILTER_REJECT;
          }

          // En az bir harf (İngilizce veya CJK/Çince) içermeli
          if (!/[a-zA-Z\u4e00-\u9fa5]/.test(val)) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let current;
    while ((current = walker.nextNode())) {
      targetList.push(current);
    }
  }

  function collectAllPageTextNodes() {
    const nodes = [];
    collectNodesFromDocument(document, nodes);

    // Eğer sayfa içinde iframe varsa onu da genel çeviriye dahil et (Sağ editör iframe'leri hariç)
    document.querySelectorAll('iframe').forEach(iframe => {
      try {
        if (isRightEditorElement(iframe)) {
          return;
        }
        if (iframe.contentDocument) {
          collectNodesFromDocument(iframe.contentDocument, nodes);
        }
      } catch (e) { }
    });

    return nodes;
  }

  // ==========================================
  // 4. GENEL SAYFA ÇEVİRİSİNİ UYGULAMA
  // ==========================================
  async function applyFullPageTranslation(isIncremental = false) {
    if (isTranslating) return;

    // Eğer tam çeviri isteniyorsa ve hafızada zaten kayıt varsa geri yükle
    if (!isIncremental && translationMemory.length > 0 && !isTranslated) {
      translationMemory.forEach(item => {
        if (item.node && item.node.parentNode) {
          item.node.nodeValue = item.translated;
        }
      });
      isTranslated = true;
      setNoneCheckboxChecked(true);
      updateWidgetUI();
      showToast('🇹🇷 Genel Çeviri Aktif (TR)', 'active');
      return;
    }

    const nodes = collectAllPageTextNodes();
    if (nodes.length === 0) {
      if (!isIncremental) {
        updateWidgetUI();
      }
      return;
    }

    isTranslating = true;
    updateWidgetUI();
    if (!isIncremental) {
      showToast('Sayfa genel olarak çevriliyor... ⏳', 'info', 1500);
    }

    // 1. Benzersiz metinleri çıkar (Performans optimizasyonu)
    const uniqueMap = new Map();
    nodes.forEach(n => {
      const orig = n.nodeValue.trim();
      if (!uniqueMap.has(orig)) {
        uniqueMap.set(orig, '');
      }
    });

    const uniqueTexts = Array.from(uniqueMap.keys());

    // 2. Parçalar halinde paralel çevir
    const chunkSize = 20;
    for (let i = 0; i < uniqueTexts.length; i += chunkSize) {
      const chunk = uniqueTexts.slice(i, i + chunkSize);
      const translatedChunk = await requestBatchTranslation(chunk);
      chunk.forEach((orig, idx) => {
        uniqueMap.set(orig, translatedChunk[idx] || orig);
      });
    }

    let hasRomanMistranslation = false;

    // 3. Düğümleri çevirilerle güncelle ve hafızaya ekle
    nodes.forEach(node => {
      const orig = node.nodeValue.trim();
      const tr = uniqueMap.get(orig) || orig;

      // Roma rakamı kontrolü (I. -> Ben. uyarısı)
      if (/(?:^|(?<=[\s\n\r>]))Ben\./i.test(tr) || /(?:^|(?<=[\s\n\r>]))Ben\s+([A-ZÇĞİÖŞÜ])/i.test(tr)) {
        hasRomanMistranslation = true;
      }

      processedNodes.add(node);
      translationMemory.push({
        node: node,
        original: node.nodeValue,
        translated: tr
      });

      node.nodeValue = tr;
    });

    isTranslating = false;
    isTranslated = true;

    // None kutusunu kontrol et
    setNoneCheckboxChecked(true);

    // Roma rakamı uyarısı (ALERT)
    if (hasRomanMistranslation && !hasAlertedForRoman) {
      hasAlertedForRoman = true;
      const alertBox = document.getElementById('tr-alert-banner');
      if (alertBox) alertBox.classList.add('visible');

      showToast('Dikkat: Sayfada "Ben." (I.) tespit edildi!', 'warning', 6000);
      setTimeout(() => {
        alert('DİKKAT:\n\nSayfada Roma rakamı ("Ben." / "I.") tespit edildi!\nLütfen ilgili başlığı kontrol ediniz.');
      }, 300);
    }

    updateWidgetUI();
    if (!isIncremental) {
      showToast('Tüm sayfa genel olarak çevrildi.', 'active');
    }
  }

  function restoreOriginal() {
    translationMemory.forEach(item => {
      if (item.node && item.node.parentNode) {
        item.node.nodeValue = item.original;
      }
    });
    isTranslated = false;
    updateWidgetUI();
    showToast('Orijinal dile dönüldü (EN).', 'info');
  }

  function toggleTranslation() {
    if (isAutoTranslateActive) {
      persistState(false);
      restoreOriginal();
    } else {
      persistState(true);
      applyFullPageTranslation();
    }
  }

  // ==========================================
  // 5. TEK TUŞLA RENKLİ VE STİLLİ İÇERİK KOPYALAMA
  // Renkler, yazı boyutları ve HTML etiketlerini birebir kopyalar
  // ==========================================
  function isRightEditorElement(el) {
    if (!el) return false;
    return !!el.closest('.rightEditor, .edui-editor, .edui-default, [id^="editor_"], [id^="edui"], #tr-auto-widget, #tr-toast-container');
  }

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
      } catch (e) { }
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
      } catch (e) { }
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

  function triggerCopySuccessUI() {
    showToast('Makale kopyalandı. (Alt + C)', 'success', 3000);

    const btnText = document.getElementById('tr-copy-btn-text');
    if (btnText) {
      const oldText = btnText.textContent;
      btnText.textContent = 'Kopyalandı';
      setTimeout(() => {
        btnText.textContent = oldText;
      }, 1800);
    }
  }

  function copyRichArticleContent() {
    const el = findArticleContentElement();
    if (!el) {
      showToast('Makale içerik alanı bulunamadı.', 'warning');
      return false;
    }

    // Görsel geri bildirim (Hafif yeşil çerçeve efekti)
    el.classList.remove('tr-copy-highlight');
    void el.offsetWidth;
    el.classList.add('tr-copy-highlight');
    setTimeout(() => el.classList.remove('tr-copy-highlight'), 1000);

    let copied = false;

    // Yöntem 1: Selection API + document.execCommand('copy')
    // Tarayıcının kendi Ctrl+C mekanizmasını birebir çalıştırır.
    // Tüm span'lardaki renkleri (color: rgb(255, 0, 0)), fontları ve stilleri kopyalar.
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
        try { selection.addRange(prevRange); } catch (e) { }
      }
    } catch (err) {
      console.warn('execCommand copy hatası:', err);
      copied = false;
    }

    // Yöntem 2: Clipboard API Fallback (Blob text/html + text/plain)
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

  // ==========================================
  // 6. SAYFA ÜSTÜ FLOATING WIDGET (UI)
  // ==========================================
  function createFloatingWidget() {
    if (document.getElementById('tr-auto-widget')) return;

    const widget = document.createElement('div');
    widget.id = 'tr-auto-widget';

    const pill = document.createElement('div');
    pill.className = 'tr-widget-pill';
    pill.id = 'tr-widget-pill';
    pill.innerHTML = `
      <span class="tr-dot" style="background: #1b6338; width: 7.5px; height: 7.5px; border-radius: 50%; display: inline-block;"></span>
      <span id="tr-pill-badge" style="font-size: 11px; padding: 2px 8px; border-radius: 9999px; background: #1b6338; color: #fff; font-weight: 600;">TR AÇIK</span>
    `;
    pill.onclick = () => widget.classList.remove('minimized');

    const card = document.createElement('div');
    card.className = 'tr-widget-card';
    card.innerHTML = `
      <div class="tr-widget-header" id="tr-drag-handle">
        <div class="tr-widget-title">
          <span class="tr-apple-dots">
            <span class="tr-apple-dot red"></span>
            <span class="tr-apple-dot yellow"></span>
            <span class="tr-apple-dot green"></span>
          </span>
          <span style="font-weight: 600; margin-left: 2px;">Çeviri Asistanı</span>
          <span class="tr-brand-tag">Enes OZER</span>
        </div>
        <button class="tr-icon-btn" id="tr-btn-minimize" title="Küçült">─</button>
      </div>

      <div class="tr-widget-body">
        <!-- DURUM ROZETİ (AÇIK / KAPALI) -->
        <div class="tr-state-badge active" id="tr-state-badge">
          <div class="tr-badge-left">
            <span class="tr-dot"></span>
            <span id="tr-state-text">GENEL ÇEVİRİ: AÇIK (TR)</span>
          </div>
          <span class="tr-badge-toggle-hint">Ctrl + B</span>
        </div>

        <!-- ROMA RAKAMI UYARI KUTUSU -->
        <div class="tr-alert-box" id="tr-alert-banner">
          <span><strong>Uyarı:</strong> Sayfada "Ben." (I.) tespit edildi!</span>
        </div>

        <!-- AÇMA / KAPAMA BUTONU -->
        <button class="tr-btn tr-btn-danger" id="tr-btn-toggle-action">
          <span id="tr-action-text">Çeviriyi Duraklat (Ctrl + B)</span>
        </button>

        <!-- MAKALEYİ KOPYALA BUTONU -->
        <button class="tr-btn tr-btn-copy" id="tr-btn-copy-rich" title="Makaleyi tüm renk ve stilleriyle kopyalar (Alt + C)">
          <span id="tr-copy-btn-text">Makaleyi Kopyala</span>
        </button>

        <div class="tr-btn-grid">
          <button class="tr-btn tr-btn-secondary" id="tr-btn-none">
            <span>None Seç</span>
          </button>
          <button class="tr-btn tr-btn-secondary" id="tr-btn-refresh-tr">
            <span>Yeniden Çevir</span>
          </button>
        </div>

        <div style="font-size: 11px; color: var(--tr-text-secondary); display: flex; justify-content: space-between; border-top: 1px solid var(--tr-border-subtle); padding-top: 8px;">
          <span>Kayıtlı Durum: <strong id="tr-persist-status" style="color: #1b6338;">AÇIK</strong></span>
          <span id="tr-mem-count">Çevrilen: 0</span>
        </div>
      </div>
    `;

    widget.appendChild(pill);
    widget.appendChild(card);
    document.body.appendChild(widget);

    document.getElementById('tr-btn-toggle-action').onclick = toggleTranslation;
    document.getElementById('tr-btn-copy-rich').onclick = copyRichArticleContent;
    document.getElementById('tr-btn-refresh-tr').onclick = () => {
      translationMemory.length = 0;
      hasAlertedForRoman = false;
      const alertBox = document.getElementById('tr-alert-banner');
      if (alertBox) alertBox.classList.remove('visible');
      applyFullPageTranslation();
    };
    document.getElementById('tr-btn-none').onclick = () => setNoneCheckboxChecked(false);
    document.getElementById('tr-btn-minimize').onclick = () => widget.classList.add('minimized');

    makeDraggable(widget, document.getElementById('tr-drag-handle'));
    updateWidgetUI();
  }

  function updateWidgetUI() {
    const badge = document.getElementById('tr-state-badge');
    const stateText = document.getElementById('tr-state-text');
    const actionBtn = document.getElementById('tr-btn-toggle-action');
    const actionText = document.getElementById('tr-action-text');
    const pillBadge = document.getElementById('tr-pill-badge');
    const persistStatus = document.getElementById('tr-persist-status');
    const memCount = document.getElementById('tr-mem-count');

    if (isAutoTranslateActive) {
      if (badge) {
        badge.className = 'tr-state-badge active';
        if (stateText) {
          stateText.textContent = isTranslating ? 'GENEL ÇEVİRİ: YÜKLENİYOR...' : 'GENEL ÇEVİRİ: AÇIK (TR)';
        }
      }
      if (actionBtn) {
        actionBtn.className = 'tr-btn tr-btn-danger';
        if (actionText) actionText.textContent = 'Çeviriyi Duraklat (Ctrl + B)';
      }
      if (pillBadge) {
        pillBadge.textContent = 'TR AÇIK';
        pillBadge.style.background = '#1b6338';
      }
      if (persistStatus) {
        persistStatus.textContent = 'AÇIK';
        persistStatus.style.color = '#1b6338';
      }
    } else {
      if (badge) {
        badge.className = 'tr-state-badge inactive';
        if (stateText) stateText.textContent = 'GENEL ÇEVİRİ: KAPALI (EN)';
      }
      if (actionBtn) {
        actionBtn.className = 'tr-btn tr-btn-primary';
        if (actionText) actionText.textContent = 'Çeviriyi Başlat (Ctrl + B)';
      }
      if (pillBadge) {
        pillBadge.textContent = 'EN KAPALI';
        pillBadge.style.background = '#6b6359';
      }
      if (persistStatus) {
        persistStatus.textContent = 'KAPALI';
        persistStatus.style.color = '#877e73';
      }
    }

    if (memCount) {
      memCount.textContent = `Çevrilen: ${translationMemory.length}`;
    }
  }

  function makeDraggable(el, handle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    handle.onmousedown = (e) => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; };
      document.onmousemove = (e) => {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        el.style.top = (el.offsetTop - pos2) + 'px';
        el.style.left = (el.offsetLeft - pos1) + 'px';
        el.style.bottom = 'auto';
        el.style.right = 'auto';
      };
    };
  }

  // Klavye Kısayolları (Ctrl + B = Aç/Kapa, Alt + C = Renkli Kopyala)
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      toggleTranslation();
    } else if (e.altKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      copyRichArticleContent();
    }
  }, true);

  // ==========================================
  // 6. DİNAMİK MUTATION OBSERVER & İZLEYİCİ
  // Vue/SPA dinamik içerik eklediğinde otomatik yakalar
  // ==========================================
  function setupContinuousWatcher() {
    if (mutationObserver) return;

    mutationObserver = new MutationObserver(() => {
      if (!isAutoTranslateActive) return;

      if (!isNoneChecked) {
        setNoneCheckboxChecked(true);
      }

      clearTimeout(mutationDebounceTimer);
      mutationDebounceTimer = setTimeout(() => {
        if (isAutoTranslateActive) {
          applyFullPageTranslation(true);
        }
      }, 300);
    });

    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    // F5 veya ilk yükleme sonrası Vue'nun render sürelerine göre periyodik kontrol
    let sweeps = 0;
    const sweepInterval = setInterval(() => {
      sweeps++;
      if (isAutoTranslateActive) {
        setNoneCheckboxChecked(true);
        applyFullPageTranslation(true);
      }
      if (sweeps >= 10) {
        clearInterval(sweepInterval);
      }
    }, 600);
  }

  // ==========================================
  // 7. BAŞLATICI
  // ==========================================
  function init() {
    initStorage(() => {
      createFloatingWidget();
      watchNoneCheckbox();

      if (isAutoTranslateActive) {
        applyFullPageTranslation();
      }

      setupContinuousWatcher();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
