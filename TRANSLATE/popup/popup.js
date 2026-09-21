/**
 * Popup Script (v2.1)
 */

document.addEventListener('DOMContentLoaded', () => {
  const btnToggle = document.getElementById('btn-toggle-tr');
  const btnCheckNone = document.getElementById('btn-check-none');
  const btnReload = document.getElementById('btn-reload-page');
  const popupStatusText = document.getElementById('popup-status-text');

  function sendToActiveTab(message, callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0] || !tabs[0].id) {
        popupStatusText.textContent = 'Aktif sekme bulunamadı.';
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
        if (chrome.runtime.lastError) {
          popupStatusText.textContent = 'Lütfen sayfayı yenileyip tekrar deneyin.';
        } else if (callback) {
          callback(response);
        }
      });
    });
  }

  btnToggle.addEventListener('click', () => {
    sendToActiveTab({ action: 'toggleTranslation' }, (res) => {
      if (res) {
        popupStatusText.textContent = res.isTranslated ? 'Türkçe Çeviri Aktif (TR)' : 'Orijinal İngilizceye Dönüldü (EN)';
      }
    });
  });

  btnCheckNone.addEventListener('click', () => {
    sendToActiveTab({ action: 'checkNone' }, (res) => {
      popupStatusText.textContent = res && res.success ? '"None" seçildi!' : 'Kutu bulunamadı.';
    });
  });

  btnReload.addEventListener('click', () => {
    chrome.tabs.reload();
    window.close();
  });
});
