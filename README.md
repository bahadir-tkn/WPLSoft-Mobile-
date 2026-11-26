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
- **Komut listesi:** Çizdiğiniz devrenin WPLSoft komut listesini (IL) görün ve bilgisayardaki WPLSoft'un komut (Instruction) ekranına aktarın
  (adımlar uygulamada **Dosya / IL → Dışa Aktar** penceresinde anlatılır).
  WPLSoft'tan kopyaladığınız komutları da bu programa aktarabilirsiniz.
- **WPLSoft proje dosyası (.dvp):** DVP-SX2 programlarını WPLSoft'ta **Dosya → Aç** ile doğrudan açılan `.dvp` dosyası olarak indirin
  (aygıt açıklamaları dahil; WPLSoft 2.52 ile denendi). Komutları tek tek girmeniz gerekmez.
- **Açıklamalar (etiketler):** Kontak ve bobinlere "Start", "Motor" gibi açıklamalar yazın. Açıklamalı komut listesini indirebilir,
  açıklama listesini kopyalayıp WPLSoft'taki aygıt açıklamalarına girebilirsiniz.
- **Kablo bağlantı rehberi:** Hangi kablonun PLC'nin hangi ucuna takılacağını adım adım gösterir.
- **Hazır örnekler:** Mühürleme (start-stop), yıldız-üçgen, ileri-geri, trafik lambası gibi devreleri tek dokunuşla açın.
- **Laboratuvar deneyleri:** Şablonlar → **Deneyler** sekmesinde Deney 4 (Çamaşır Makinesi), Deney 5 (Dalgıç Pompa) ve Deney 6 (Su–Köpük) föydeki diyagramlarla hazır gelir.

## Ders Kitabıyla Uyum

Uygulama, *Delta DVP-PLC Serisi Programlama ve Otomasyon* kitabındaki konuları destekler:

- Temel komutlar, zamanlayıcılar (100 ms / 10 ms / 1 ms), sayıcılar, özel röleler (`M1000`, `M1002`, `M1013`…)
- Karşılaştırma, `MOV`, `CMP`, aritmetik ve ondalıklı işlemler, SX2 analog girişler (`D1110`…)
- Gerçek zaman saati (`D1313`–`D1319`, `TRD`, `TWRP`, `TZCP`)
- Adım (SFC) programlama: `S` adımları, `STL` ve `RET`
- Diyagramlardaki **↑ / ↓** sonuç kenarı (`NP` / `PN`) ve WPLSoft'un "çıkıştan sonra AND" yazımı
- Genişleme modülü adresleri (ör. pnömatik uygulamadaki `X20`–`X27`, `Y20`–`Y27`)

- Simülatör, gerçek PLC'nin komut listesini satır satır çalıştırmasıyla birebir aynı sonucu verecek şekilde test edilir
  (ör. `ALT` giriş açıkken her taramada değişir, tek butonla aç/kapa için `ALTP` veya `LDP` kullanılır).

> Not: Kitaptaki bazı çizimlerde hatalar var (ör. aynı çıkışın iki ayrı satırda `OUT` olarak kullanılması).
> Uygulama bu durumları "Derleme Çıktısı" bölümünde uyarı olarak gösterir.

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
| **F1** penceresinde | NP ↑, PN ↓, STL (adım), RET seçenekleri |
| **F12** veya **Del** | Sil |
| **Enter** | Seçili elemanı düzenle |
| **Ctrl+Z / Ctrl+Y** | Geri al / İleri al |

Telefonda bu tuşların yerine üstteki **Komutlar** menüsünü kullanabilirsiniz.

## Desteklenen PLC Modelleri

- **DVP-SX2** (analog giriş/çıkış ve saat özellikli — önerilen)
- **DVP-14SS2**
- **DVP-12SA2**

---


