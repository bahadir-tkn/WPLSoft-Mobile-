import React, { useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compactHeight?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  compactHeight = false,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // Suppress button when already running as an installed standalone PWA
  if (isInstalled) {
    return null;
  }

  const sizeClass = compactHeight
    ? 'h-7 w-7 sm:w-auto sm:px-2'
    : 'h-7 w-7 sm:h-8 sm:w-auto sm:px-2 lg:px-2.5';

  // Chromium / Android / Desktop native install prompt
  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => {
          void install();
        }}
        data-testid="pwa-install-btn"
        aria-label="Uygulamayı cihaza kur (PWA)"
        title="Uygulamayı cihaza kur (Çevrimdışı çalışır)"
        className={`${sizeClass} rounded border border-[#0B4EA2] bg-[#EEF4FC] hover:bg-[#DCE9FA] text-xs font-semibold text-[#0B4EA2] flex items-center justify-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer`}
      >
        <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span className="hidden lg:inline">Kur</span>
      </button>
    );
  }

  // iOS / iPadOS Safari guided "Add to Home Screen" modal
  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          data-testid="pwa-ios-install-btn"
          aria-label="iOS ana ekrana ekleme rehberi"
          title="Ana Ekrana Ekle (iOS)"
          className={`${sizeClass} rounded border border-[#C5CDD9] bg-white hover:bg-[#EDF2F8] text-xs font-semibold text-[#0B4EA2] flex items-center justify-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer`}
        >
          <Smartphone className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">Kur</span>
        </button>

        {showIOSGuide && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-pwa-guide-title"
            className="fixed inset-0 z-50 bg-[#0F172A]/45 flex items-end sm:items-center justify-center p-0 sm:p-4 [@media(max-height:500px)]:p-1!"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowIOSGuide(false);
            }}
          >
            <div className="w-full sm:max-w-sm bg-white border border-[#BFC7D5] sm:rounded shadow-xl overflow-hidden">
              <div className="bg-[#0B4EA2] text-white px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Smartphone className="w-4 h-4" aria-hidden="true" />
                  <h2 id="ios-pwa-guide-title" className="text-sm font-semibold">
                    iPhone / iPad Kurulum Rehberi
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Kapat"
                  className="p-1 rounded hover:bg-white/15 cursor-pointer"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
              <div className="p-4 space-y-3 text-xs text-[#334155] leading-relaxed">
                <p>
                  <strong>WPLSoft Web</strong> uygulamasını çevrimdışı çalışan tam ekran uygulama olarak eklemek için:
                </p>
                <ol className="list-decimal list-inside space-y-2 text-[#0F172A]">
                  <li>
                    Safari araç çubuğundaki{' '}
                    <span className="inline-flex items-center gap-1 font-semibold text-[#0B4EA2]">
                      <Share className="w-3.5 h-3.5 inline" aria-hidden="true" />
                      Paylaş
                    </span>{' '}
                    simgesine dokunun.
                  </li>
                  <li>
                    Aşağı kaydırıp <strong>Ana Ekrana Ekle</strong> seçeneğine dokunun.
                  </li>
                  <li>
                    Sağ üstten <strong>Ekle</strong> düğmesine basarak kurulumu tamamlayın.
                  </li>
                </ol>
              </div>
              <div className="px-4 py-3 wpl-safe-bottom bg-[#F4F6F9] border-t border-[#CBD2DC] flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="h-9 px-4 rounded bg-[#0B4EA2] text-white hover:bg-[#073878] text-xs font-semibold cursor-pointer"
                >
                  Anladım
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
