import React from 'react';
import { Info, X } from 'lucide-react';

interface ToastBannerProps {
  message: string | null;
  onDismiss: () => void;
}

export const ToastBanner: React.FC<ToastBannerProps> = ({ message, onDismiss }) => {
  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-8 left-2.5 sm:bottom-9 sm:left-4 z-40 max-w-[calc(100vw-20px)] sm:max-w-sm bg-[#0F172A]/95 text-white text-[11px] rounded-md shadow-lg border border-[#334155] px-2.5 py-1.5 flex items-center gap-2"
    >
      <Info className="w-4 h-4 text-[#60A5FA] shrink-0" aria-hidden="true" />
      <span className="leading-snug">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Bildirimi kapat"
        className="text-[#94A3B8] hover:text-white p-0.5 cursor-pointer shrink-0"
      >
        <X className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  );
};
