/**
 * Sürüm bildirimini imzalar ve yayımlanacak version.json dosyasını üretir.
 *
 *   node scripts/sign_release.mjs                               -> sürümü "active" yayımlar
 *   node scripts/sign_release.mjs --disable "Bakım çalışması"   -> aynı sürümü yönetim kararıyla devre dışı bırakır
 *   --payload <yol>  (varsayılan release/version.payload.json)   --out <yol>  (varsayılan release/version.json)
 *
 * Özel anahtar şu sırayla aranır:
 *   1. TRANSLATOR_SIGNING_KEY_JWK ortam değişkeni: anahtarın KENDİSİ (GitHub Actions secret'ı)
 *   2. TRANSLATOR_SIGNING_KEY ortam değişkeni: anahtar dosyasının yolu
 *   3. %USERPROFILE%\.translator-signing\private_key.jwk
 * Anahtar hiçbir zaman ekrana yazılmaz.
 * issuedAt imza anında yazılır; eklenti daha eski tarihli bildirimi (tekrar oynatma) kabul etmez.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const fail = (msg) => { console.error(`❌ ${msg}`); process.exit(1); };

const payloadPath = path.resolve(argValue('--payload', path.join('release', 'version.payload.json')));
const outPath = path.resolve(argValue('--out', path.join('release', 'version.json')));

let jwkText = process.env.TRANSLATOR_SIGNING_KEY_JWK || '';
if (!jwkText.trim()) {
  const privPath = process.env.TRANSLATOR_SIGNING_KEY || path.join(os.homedir(), '.translator-signing', 'private_key.jwk');
  if (!fs.existsSync(privPath)) fail('Özel anahtar bulunamadı (TRANSLATOR_SIGNING_KEY_JWK secret\'ı veya anahtar dosyası).');
  jwkText = fs.readFileSync(privPath, 'utf8');
}
let jwk;
try { jwk = JSON.parse(jwkText); } catch (e) { fail('Özel anahtar okunamadı: geçerli bir JWK (JSON) değil.'); }
if (!jwk.d) fail('Verilen anahtar özel anahtar değil ("d" alanı yok).');

if (!fs.existsSync(payloadPath)) fail(`${payloadPath} yok. Önce: node scripts/build.mjs`);
const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
payload.issuedAt = Date.now();
if (args.includes('--disable')) {
  payload.status = 'disabled';
  payload.reason = String(argValue('--disable', '') || 'Yönetim sistemi kararı.').slice(0, 300);
} else {
  payload.status = 'active';
  payload.reason = null;
}

const { subtle } = globalThis.crypto;
let key;
try {
  key = await subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
} catch (e) {
  fail('Özel anahtar içe aktarılamadı (P-256 ECDSA olmalı).');
}
const payloadText = JSON.stringify(payload);
const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(payloadText));

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ payload: payloadText, signature: Buffer.from(sig).toString('base64') }, null, 2) + '\n');
console.log(`✅ ${outPath}`);
console.log(`   Sürüm: ${payload.latest} | Durum: ${payload.status}${payload.reason ? ` (${payload.reason})` : ''} | issuedAt: ${new Date(payload.issuedAt).toISOString()}`);
