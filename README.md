# WPLSoft Web — Delta PLC Devre Çizme ve Deneme Programı

Delta DVP serisi PLC'ler için **telefonda, tablette ve bilgisayarda** çalışan bir programdır.
Merdiven (Ladder) diyagramı çizer, devreyi PLC'ye yüklemeden önce ekranda çalıştırıp deneyebilirsiniz.

## Hemen Kullan

### Tarayıcıda Aç (kurulum gerekmez)

👉 **[Uygulamayı Aç](https://bahadir-tkn.github.io/WPLSoft-Mobile-/)**

> İpucu: Açtıktan sonra tarayıcı menüsünden **"Ana Ekrana Ekle"** veya **"Yükle"** derseniz
> program telefonunuza / bilgisayarınıza kurulur ve internet olmadan da çalışır.

### Windows'a İndir

- **[Kurulum dosyası (.exe)](https://github.com/bahadir-tkn/WPLSoft-Mobile-/releases/latest/download/WPLSoft-Windows-Setup.exe)** — Normal bir program gibi kurar, masaüstüne kısayol ekler.
- **[Kurulumsuz sürüm (.exe)](https://github.com/bahadir-tkn/WPLSoft-Mobile-/releases/latest/download/WPLSoft-Windows-Portable.exe)** — İndirip çift tıklamanız yeterli.
- **[Tüm sürümler](https://github.com/bahadir-tkn/WPLSoft-Mobile-/releases)**

> Windows "Bilgisayarınız korundu" uyarısı verirse **Ek bilgi → Yine de çalıştır** seçeneğine tıklayın.
> Program imzasız olduğu için bu uyarı normaldir.

---

## Neler Yapabilirsiniz?

- **Devre çizme:** Kontak, bobin, zamanlayıcı (`TMR`), sayıcı (`CNT`), karşılaştırma ve hesap komutlarını yerleştirin.
- **Deneme (simülasyon):** Girişlere (`X0`, `X1`…) dokunun, çıkışların (`Y0`, `Y1`…) yanıp söndüğünü canlı izleyin.
- **Komut listesi:** Çizdiğiniz devrenin WPLSoft komut listesini (IL) görün, kopyalayıp gerçek WPLSoft'a yapıştırın.
  WPLSoft'tan kopyaladığınız komutları da bu programa aktarabilirsiniz.
- **Kablo bağlantı rehberi:** Hangi kablonun PLC'nin hangi ucuna takılacağını adım adım gösterir.
- **Hazır örnekler:** Mühürleme (start-stop), yıldız-üçgen, ileri-geri, trafik lambası gibi devreleri tek dokunuşla açın.

## Kısa Kullanım

| Tuş | Ne yapar? |
| :-- | :-- |
| **F1 / F2** | Açık kontak / Kapalı kontak |
| **F3 / F4** | Yükselen kenar / Düşen kenar kontağı |
| **F5** | Karşılaştırma (`LD=`, `LD>` …) |
| **F6** | Uygulama komutu (`TMR`, `CNT`, `MOV` …) |
| **F7 / F8** | Çıkış bobini (`OUT`) / `SET` – `RST` |
| **F9** | Yatay çizgi |
| **F10** | Paralel kol — seçili hücrenin **solundan** aşağı iner (gerçek WPLSoft gibi) |
| **F11** | Yeni satır ekle |
| **F12** veya **Del** | Sil |
| **Enter** | Seçili elemanı düzenle |
| **Ctrl+Z / Ctrl+Y** | Geri al / İleri al |

Telefonda bu tuşların yerine üstteki **Komutlar** menüsünü kullanabilirsiniz.

## Desteklenen PLC Modelleri

- **DVP-SX2** (analog giriş/çıkış ve saat özellikli — önerilen)
- **DVP-14SS2**
- **DVP-12SA2**

---

<details>
<summary><b>Geliştiriciler için (isteğe bağlı)</b></summary>

Bilgisayarınızda çalıştırmak için [Node.js](https://nodejs.org) (22 veya üstü) kurulu olmalıdır.

```bash
npm install --legacy-peer-deps   # gerekli paketleri indir
npm run dev                      # http://localhost:3000 adresinde açılır
npm test                         # testleri çalıştır
npm run build                    # yayın dosyalarını dist/ klasörüne üretir
```

**Web sitesinin yayınlanması:** `main` dalına her gönderimde site otomatik olarak GitHub Pages'e yüklenir.
Bunun çalışması için depoda **bir kez** şu ayarın yapılmış olması gerekir:
**Settings → Pages → Build and deployment → Source: "GitHub Actions"**.

**Windows sürümü:** `main` dalına her gönderimde `.exe` dosyaları otomatik üretilip
[Releases](https://github.com/bahadir-tkn/WPLSoft-Mobile-/releases) sayfasına eklenir.

</details>
