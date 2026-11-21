import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyViewport,
  isKeyboardViewportShrink,
} from './useViewportLayout';
import { detectIosDevice } from './usePWAInstall';

test('classifyViewport identifies phone landscape (e.g., 844x390, 667x375) as compact landscape', () => {
  const iphone14Landscape = classifyViewport(844, 390);
  assert.equal(iphone14Landscape.isPhoneLandscape, true);
  assert.equal(iphone14Landscape.isCompactTouch, true);
  assert.equal(iphone14Landscape.isDesktopWide, false);

  const iphoneSeLandscape = classifyViewport(667, 375);
  assert.equal(iphoneSeLandscape.isPhoneLandscape, true);
  assert.equal(iphoneSeLandscape.isCompactTouch, true);
  assert.equal(iphoneSeLandscape.isDesktopWide, false);
});

test('classifyViewport identifies phone portrait (390x844, 360x800) as compact touch but not landscape', () => {
  const portrait = classifyViewport(390, 844);
  assert.equal(portrait.isPhoneLandscape, false);
  assert.equal(portrait.isCompactTouch, true);
  assert.equal(portrait.isDesktopWide, false);

  const androidPortrait = classifyViewport(360, 800);
  assert.equal(androidPortrait.isPhoneLandscape, false);
  assert.equal(androidPortrait.isCompactTouch, true);
  assert.equal(androidPortrait.isDesktopWide, false);
});

test('classifyViewport does not misclassify square or portrait soft-keyboard viewports as phone landscape', () => {
  // Portrait phone with virtual keyboard open (390x420)
  const phoneKb = classifyViewport(390, 420);
  assert.equal(phoneKb.isPhoneLandscape, false);
  assert.equal(phoneKb.isCompactTouch, true);

  // Square split-screen window (500x500)
  const square = classifyViewport(500, 500);
  assert.equal(square.isPhoneLandscape, false);
  assert.equal(square.isCompactTouch, true);
});

test('isKeyboardViewportShrink ignores soft-keyboard height collapse only while input is focused', () => {
  // Android portrait 390x844 -> 390x460 while typing in input
  assert.equal(isKeyboardViewportShrink(390, 844, 390, 460, true), true);
  // Same dimensions without focused input -> treat as real resize
  assert.equal(isKeyboardViewportShrink(390, 844, 390, 460, false), false);
  // Real device rotation 390x844 -> 844x390 (width changed dramatically) -> NOT keyboard shrink
  assert.equal(isKeyboardViewportShrink(390, 844, 844, 390, true), false);
});

test('classifyViewport identifies desktop (1440x900) and tablet landscape (1024x768) as desktop wide', () => {
  const desktop = classifyViewport(1440, 900);
  assert.equal(desktop.isPhoneLandscape, false);
  assert.equal(desktop.isCompactTouch, false);
  assert.equal(desktop.isDesktopWide, true);

  const tablet = classifyViewport(1024, 768);
  assert.equal(tablet.isPhoneLandscape, false);
  assert.equal(tablet.isCompactTouch, false);
  assert.equal(tablet.isDesktopWide, true);
});

test('detectIosDevice recognizes iPhone, iPad, and iPadOS 13+ (MacIntel with touch points)', () => {
  assert.equal(
    detectIosDevice(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15',
      'iPhone',
      5
    ),
    true
  );
  assert.equal(
    detectIosDevice(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      'MacIntel',
      5
    ),
    true
  );
  assert.equal(
    detectIosDevice(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'MacIntel',
      0
    ),
    false
  );
  assert.equal(
    detectIosDevice(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile',
      'Linux armv8l',
      5
    ),
    false
  );
});
