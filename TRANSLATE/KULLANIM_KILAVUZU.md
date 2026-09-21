# 🚀 Oppo GKM Çeviri & Form Otomasyon Asistanı (v2.9)

Kullanıcının *"Sadece belli başlı HTML'leri istemiyorum, bir önceki sürümdeki gibi genel bir translate yap"* talebi doğrultusunda v2.9 tamamlandı.

---

## ⚡ v2.9 Yenilikleri ve Özellikler

1. **🌐 Genel Sayfa Çevirisi (Full Page General Translate):**
   - Sayfa belirli HTML etiketleri veya sınıflarıyla (sadece content veya card ile) kısıtlanmaz.
   - Sayfadaki tüm başlıklar (`h1-h6`), etiketler, butonlar, açıklamalar, soru başlıkları, tablolar ve makale gövdesi Google Chrome'un yerel "Türkçe diline çevir" mantığıyla **genel olarak** Türkçeye çevrilir.
   - Sayfa içindeki editör veya iframe içerikleri de genel çeviri kapsamına alınır.

2. **⚡ Dinamik SPA İzleyicisi (MutationObserver):**
   - Oppo GKM sistemi Vue/SPA olduğu için sayfa açıldıktan sonra gelen metinler `MutationObserver` ile anında algılanır ve otomatik çevrilir.
   - İlk birkaç kelime yüklendiğinde durmaz; makale gövdesi sonradan gelse dahi tamamını yakalar.

3. **🚫 Başlık Kutusu Boş ve Kontrolünüzde:**
   - `* Translate Title` ve diğer form input / textarea kutularına **asla otomatik yazı yazılmaz**. Kendi kopyalama-yapıştırma akışınızı dilediğiniz gibi yapabilirsiniz.

4. **🔒 Kalıcı Açık/Kapalı Ayarı (F5 Korumalı):**
   - Sayfaya **F5** attığınızda veya yeni göreve geçtiğinizde ayar **AÇIK** kalmaya devam eder ve tüm sayfayı kendiliğinden Türkçeye çevirir.
   - `Ctrl + B` ile istediğiniz an orijinal İngilizceye veya Türkçeye dönebilirsiniz.

5. **☑️ "None" Kutusu Otomatik Seçimi:**
   - *Select Collection* yanındaki `None` onay kutusu otomatik olarak işaretlenir.

6. **⚠️ Roma Rakamı Uyarısı (Alert):**
   - Metin otomatik değiştirilmez. Sayfada Roma rakamının Türkçe yanlış çevirisi (`"Ben."` / `"I."`) tespit edilirse ekrana dikkat uyarısı (`alert`) verilir.

7. **🛡️ Sağ Editör Alanı (rightEditor / UEditor) Korunur:**
   - Türkçe makaleyi yazdığınız / düzenlediğiniz sağ editör (`.rightEditor`, `ueditor_0`, araç çubuğu butonları ve sayaçlar) **kesinlikle çeviriye dahil edilmez**, orijinal hali ve editör düzeni korunur.

8. **🍏 Apple İlhamlı Resmi Bej Tasarım:**
   - Koyu renkli tema yerine resmi, kurumsal ve Apple estetiğinde sıcak bej/krem (`Cupertino Warm Beige`) tasarımı uygulandı.
   - macOS tarzı 3 renkli pencere noktaları, resmi `GKM` etiketi, SF Pro yazı tipi hiyerarşisi ve zarif buzlu cam (`backdrop-filter`) efektleriyle resmi ve prestijli bir görünüm kazandırıldı.

9. **🎯 Makale İçerik Alanı (`.ant-card-body` & `.content`):**
   - Problem Description, Cause Analysis, Solution, dahili not blokları (`code-block-body`) ve tüm makale gövdesi öncelikli olarak çeviriye dahil edildi.
   - Akıllı kaynak dil algılama (`sl=auto`) ile hem İngilizce açıklamalar hem de dahili sistem etiketleri (`🔒仅内部查看` -> "🔒Yalnızca dahili görüntüleme") eksiksiz olarak Türkçeye çevrilir.

10. **Makaleyi Kopyala (Buton & `Alt + C`):**
    - Makale içeriğini (`<div class="ant-card-body"><div class="content">...</div></div>`) **tüm renkleri, kalınlıkları ve stilleriyle** tek tuşla panoya kopyalar.
    - Fareyle seçip `Ctrl + C` yapma işlemini birebir simüle eder; tarayıcının yerel Seçim API'si üzerinden panoya zengin metin (`text/html`) ve (`text/plain`) formatında yazar.
    - Kırmızı metinler (`color: rgb(255, 0, 0)`), kalın (`<strong>`) yazılar, `OPPOSans` font stilleri ve özel bloklar olduğu gibi korunur.
    - **Makaleyi Kopyala** butonuna bastığınızda veya klavyeden **`Alt + C`** tuşladığınızda içerik kopyalanır ve ekranda yeşil onay bildirimi belirir.
11. **🚀 Kotasız Çeviri & Hızlı Paketleme Motoru:**
    - Google'ın genel ücretsiz istemcisi (`client=gtx`) çok fazla paralel istek atıldığında `HTTP 429 (Too Many Requests / Kota Limiti)` verip çeviriyi durduruyordu.
    - Resmi Chrome çeviri istemcisine (`client=dict-chrome-ex`) geçildi ve tüm metinler 50-100 ayrı istek yerine paketlenip tek bir istekte çevrilerek geri dağıtıldı.
    - Artık kota engeline takılmadan sayfadaki tüm metinler anında çevrilir.

---

## 🔄 Güncelleme Adımı (10 Saniye)

### Eğer Chrome Eklentisi Olarak Kullanıyorsanız:
1. Chrome'da **`chrome://extensions`** adresine gidin.
2. **Çeviri & Form Otomasyon Asistanı** eklenti kartının üzerindeki **Yenile (🔄)** butonuna tıklayın.
3. `gkm.oppo.com` sayfasında **F5** atın.

### Eğer Tampermonkey ile Kullanıyorsanız:
- `translate_helper.user.js` dosyasının içeriğini Tampermonkey düzenleyicisine yapıştırıp **Ctrl + S** ile kaydedin.

Artık sayfa tek bir etiket grubuna sıkışmadan genel olarak tüm görünür metinleriyle Türkçeye çevrilecektir!
