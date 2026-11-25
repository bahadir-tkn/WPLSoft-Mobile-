# Güvenlik Notları

Bu sayfa, programın sizi ve bilgisayarınızı korumak için neler yaptığını sade bir dille özetler.

## Kısaca

- **Program internete veri göndermez.** Çizdiğiniz devreler yalnızca kendi cihazınızda (tarayıcınızda) saklanır.
- **Şifre, anahtar veya gizli bilgi içermez.** Kodun içinde kimseye ait parola ya da erişim anahtarı yoktur.
- **Dışarıdan açılan dosyalar kontrol edilir.** Bozuk, çok büyük veya zararlı içerikli proje / komut dosyaları açılmadan reddedilir.

## Ayrıntılar

| Konu | Ne yapıldı? |
| :--- | :--- |
| Proje dosyası açma (`.json`) | Dosyadaki her bilgi tek tek kontrol edilir. Geçersiz aygıt adları (ör. `X0`, `Y0`, `M0` dışındaki şeyler) ve zararlı olabilecek alanlar reddedilir. |
| Komut listesi açma (`.il`, `.txt`) | En fazla 512 KB ve 5000 satır kabul edilir. Böylece çok büyük bir dosya tarayıcıyı kilitleyemez. |
| Windows sürümü | Program yalnızca kendi dosyalarını açar; başka sitelere yönlendirilemez, kamera/mikrofon gibi izinler istemez. |
| Dosya indirme | Kaydedilen dosya adlarındaki özel karakterler temizlenir. |

Bu kontrollerin her biri otomatik testlerle (`npm test`) doğrulanmaktadır.
