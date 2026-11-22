# WPLSoft — Delta DVP PLC Editörü ve Simülatörü

Delta DVP serisi PLC'ler için klasik WPLSoft arayüzlü **Ladder diyagram editörü**, **PC WPLSoft uyumlu Instruction List (IL) dönüştürücüsü**, **kablolama şeması analizörü** ve **gerçek zamanlı 20ms tarama simülatörü**.

---

## İndir ve Kullan

### 1. Windows Masaüstü Uygulaması (`.exe`)
Her kod güncellemesinde **GitHub Releases** bölümüne otomatik olarak yeni kurulum dosyaları eklenir:

- **[Windows Kurulum Sihirbazı İndir (`WPLSoft-Windows-Setup.exe`)](../../releases/latest/download/WPLSoft-Windows-Setup.exe)** — Bilgisayara kurar, masaüstü ve Başlat menüsü kısayolu oluşturur.
- **[Windows Taşınabilir Sürüm İndir (`WPLSoft-Windows-Portable.exe`)](../../releases/latest/download/WPLSoft-Windows-Portable.exe)** — Kurulum gerektirmez, doğrudan çift tıklayarak çalıştırabilirsiniz.
- **[Tüm Sürümleri ve Dosyaları Gör (`Releases`)](../../releases)**

> **Not:** İlk kez çalıştırırken Windows SmartScreen uyarısı çıkarsa *"Ek bilgi"* -> *"Yine de çalıştır"* seçeneğini kullanabilirsiniz (açık kaynak kodlu imzasız derlemeler için normaldir).

### 2. Tarayıcıdan Aç / Telefona veya Bilgisayara Kur (PWA)
Depo **GitHub Pages** üzerinden otomatik yayınlanır. Web sürümünü açtıktan sonra tarayıcınızın sağ üstündeki **Yükle / Install** düğmesine basarak uygulamayı internetsiz çalışacak şekilde cihazınıza kurabilirsiniz.
*(Yayın adresi: deponun sağ sütunundaki **Deployments / github-pages** bölümünde görünür.)*

---

## Öne Çıkan Özellikler

- **Delta DVP Model Desteği:** DVP-14SS2, DVP-12SA2, DVP-12SE, DVP-28SV, DVP-10SX2, DVP-20EX2 ve DVP-32ES2 modelleri.
- **Ladder Diyagram Editörü:** NO/NC kontaklar, yükselen/düşen kenar (`LDP`/`LDF`), çıkış bobinleri (`OUT`/`SET`/`RST`), zamanlayıcı (`TMR`), sayıcı (`CNT`), karşılaştırma ve matematik komutları.
- **Çift Yönlü IL Dönüşümü:** PC WPLSoft ile uyumlu Instruction List (`LD`, `AND`, `OR`, `ANB`, `ORB`, `MPS`/`MRD`/`MPP`, `OUT`, `END`) derleme ve ayrıştırma.
- **Gerçek Zamanlı Online Simülasyon:** 20ms tarama döngüsü, canlı akım akışı renklendirmesi, Device Monitor ile X/Y/M/T/C/D zorlama (Force) ve izleme.
- **Otomatik Kablolama Şeması:** Projede kullanılan giriş/çıkış uçlarına göre interaktif PLC bağlantı şeması.
- **Hazır Şablonlar ve Yerel Kayıt:** Start/Stop mühürleme, trafik ışığı, yıldız-üçgen yol verme gibi hazır devreler ve tarayıcı/masaüstü yerel taslak kaydı.

---

## Geliştiriciler İçin

```bash
npm install
npm run dev      # Yerel geliştirme sunucusu (http://localhost:3000)
npm test         # Çekirdek PLC mantığı ve arayüz yerleşim testleri
npm run build    # Üretim web derlemesi (dist/)
```
