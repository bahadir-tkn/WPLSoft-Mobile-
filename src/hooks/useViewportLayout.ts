import { useEffect, useState } from 'react';

export interface ViewportLayoutState {
  width: number;
  height: number;
  /** True on smartphones held horizontally (short height <= 500px, wide width >= 540px) */
  isPhoneLandscape: boolean;
  /** True on compact touch viewports (phone portrait < 768px OR phone landscape) */
  isCompactTouch: boolean;
  /** True on full desktop / large tablet screens where side-by-side IL & F1-F12 bar fit comfortably */
  isDesktopWide: boolean;
}

export function classifyViewport(width: number, height: number): ViewportLayoutState {
  const isPhoneLandscape = width > height && height <= 500 && width >= 540;
  const isCompactTouch = width < 768 || isPhoneLandscape;
  const isDesktopWide = width >= 1024 && height > 500;
  return {
    width,
    height,
    isPhoneLandscape,
    isCompactTouch,
    isDesktopWide,
  };
}

/**
 * Detects transient Android / iOS soft-keyboard resize events where viewport width
 * stays effectively identical while height shrinks sharply while an input is focused.
 * Ignoring these prevents jarring layout switches (e.g. closing panels or changing dock mode)
 * mid-typing.
 */
export function isKeyboardViewportShrink(
  prevWidth: number,
  prevHeight: number,
  nextWidth: number,
  nextHeight: number,
  activeInputFocused: boolean
): boolean {
  if (!activeInputFocused) return false;
  const widthDelta = Math.abs(nextWidth - prevWidth);
  const heightShrank = nextHeight < prevHeight * 0.85;
  return widthDelta <= 12 && heightShrank;
}

function isEditableElementFocused(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable === true
  );
}

function readWindowDimensions(): { width: number; height: number } {
  if (typeof window === 'undefined') {
    return { width: 1440, height: 900 };
  }
  const vv = window.visualViewport;
  // Use layout viewport width/height with visualViewport fallback so pinch-zoom does not distort layout classification
  const width = Math.round(window.innerWidth || vv?.width || 1440);
  const height = Math.round(window.innerHeight || vv?.height || 900);
  return { width, height };
}

function readCurrentViewport(): ViewportLayoutState {
  const { width, height } = readWindowDimensions();
  return classifyViewport(width, height);
}

export function useViewportLayout(): ViewportLayoutState {
  const [layout, setLayout] = useState<ViewportLayoutState>(readCurrentViewport);

  useEffect(() => {
    let orientationTimer: number | null = null;

    const syncViewport = () => {
      const { width, height } = readWindowDimensions();
      const inputFocused = isEditableElementFocused();

      setLayout((prev) => {
        if (prev.width === width && prev.height === height) return prev;
        if (
          isKeyboardViewportShrink(
            prev.width,
            prev.height,
            width,
            height,
            inputFocused
          )
        ) {
          return prev;
        }
        return classifyViewport(width, height);
      });
    };

    const handleOrientationChange = () => {
      syncViewport();
      // iOS Safari frequently commits final innerWidth/innerHeight ~120ms after orientationchange
      if (orientationTimer !== null) {
        window.clearTimeout(orientationTimer);
      }
      orientationTimer = window.setTimeout(() => {
        orientationTimer = null;
        syncViewport();
      }, 150);
    };

    window.addEventListener('resize', syncViewport, { passive: true });
    window.addEventListener('orientationchange', handleOrientationChange, {
      passive: true,
    });
    const vv = window.visualViewport;
    vv?.addEventListener('resize', syncViewport, { passive: true });

    return () => {
      if (orientationTimer !== null) {
        window.clearTimeout(orientationTimer);
      }
      window.removeEventListener('resize', syncViewport);
      window.removeEventListener('orientationchange', handleOrientationChange);
      vv?.removeEventListener('resize', syncViewport);
    };
  }, []);

  return layout;
}
