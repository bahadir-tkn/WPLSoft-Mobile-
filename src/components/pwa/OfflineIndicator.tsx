import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-indicator"
      className="fixed bottom-10 left-3 z-40 flex items-center gap-2 rounded border border-[#D97706] bg-[#FFFBEB] px-3 py-1.5 text-xs font-semibold text-[#92400E] shadow-md"
    >
      <WifiOff className="w-3.5 h-3.5 text-[#D97706] shrink-0" aria-hidden="true" />
      <span>Çevrimdışı Mod — Yerel önbellek ve taslak belleği aktif</span>
    </div>
  );
};
