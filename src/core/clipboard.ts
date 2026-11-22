/**
 * Cross-platform clipboard helper with full iOS Safari (standalone PWA & iframe)
 * and Android WebView fallback when `navigator.clipboard.writeText` is unavailable
 * or rejected due to transient user-gesture restrictions.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy execCommand('copy') path for iOS Safari / iframe contexts
    }
  }

  if (typeof document === 'undefined' || !document.body) {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  textarea.style.fontSize = '16px'; // Prevent iOS Safari zoom during selection

  const previousActive = document.activeElement as HTMLElement | null;
  document.body.appendChild(textarea);

  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    // iOS Safari requires explicit setSelectionRange on readonly/contentEditable fields
    textarea.setSelectionRange(0, text.length);
    const ok =
      typeof document.execCommand === 'function' && document.execCommand('copy');
    return Boolean(ok);
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
    if (previousActive && typeof previousActive.focus === 'function') {
      try {
        previousActive.focus({ preventScroll: true });
      } catch {
        // Ignore focus restoration errors
      }
    }
  }
}

/**
 * Returns true only on non-touch desktop/trackpad environments with a fine pointer
 * where automatic input focus improves keyboard speed without triggering
 * an intrusive virtual keyboard on phones or Android/iPad tablets.
 */
export function shouldAutoFocusInput(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) {
    return false;
  }
  if (
    window.matchMedia('(pointer: coarse)').matches ||
    window.matchMedia('(any-pointer: coarse)').matches
  ) {
    return false;
  }
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}
