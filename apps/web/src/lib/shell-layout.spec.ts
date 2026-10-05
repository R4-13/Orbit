import { describe, expect, it } from 'vitest';
import {
  MIN_DOCKED_MAIN_WIDTH,
  defaultSondeOpen,
  homeFitsOneScreen,
  homeLimitsFor,
  maxDockableSondeWidth,
  netMainWidth,
  resolveShellGeometry,
} from './shell-layout';

describe('netMainWidth (UI v2 §4.1)', () => {
  it('matches the worked examples of the specification: 816 px at 1440, 656 px at 1280', () => {
    expect(netMainWidth(1440, 208, 384, 16)).toBe(816);
    expect(netMainWidth(1280, 208, 384, 16)).toBe(656);
  });
});

describe('resolveShellGeometry', () => {
  it('docks Sonde at 1440 (net main 816 ≥ 800)', () => {
    const g = resolveShellGeometry({ viewportWidth: 1440, navMode: 'labels', sondeWidth: 384 });
    expect(g.sondeDisplay).toBe('docked');
    expect(g.dockedSondeWidth).toBe(384);
    expect(g.netMain).toBe(816);
    expect(defaultSondeOpen(g)).toBe(true);
  });

  it.each([1280, 1366])('uses an overlay at %i px instead of squeezing the work area (AC-08)', (viewportWidth) => {
    const g = resolveShellGeometry({ viewportWidth, navMode: 'labels', sondeWidth: 384 });
    expect(g.sondeDisplay).toBe('overlay');
    expect(g.dockedSondeWidth).toBe(0);
    expect(g.netMain).toBeGreaterThanOrEqual(viewportWidth - 208 - 32);
    expect(defaultSondeOpen(g)).toBe(false);
  });

  it('allows docking at 1280 only in the explicit rail mode, and only if the real calculation holds', () => {
    // 1280 − 72 − 32 − 800 = 376 ≥ 360, so a 376-px Sonde fits; a manual request for 480 is capped to what keeps 800 px.
    const g = resolveShellGeometry({ viewportWidth: 1280, navMode: 'rail', sondeWidth: 480 });
    expect(g.sondeDisplay).toBe('docked');
    expect(g.dockedSondeWidth).toBe(376);
    expect(g.netMain).toBe(MIN_DOCKED_MAIN_WIDTH);
  });

  it('never lets a manual resize undercut the 800 px main width', () => {
    for (const viewportWidth of [1500, 1600, 1920, 2560]) {
      const g = resolveShellGeometry({ viewportWidth, navMode: 'labels', sondeWidth: 9999 });
      if (g.sondeDisplay === 'docked') expect(g.netMain).toBeGreaterThanOrEqual(MIN_DOCKED_MAIN_WIDTH);
      expect(g.dockedSondeWidth).toBeLessThanOrEqual(480);
    }
  });

  it('collapses the navigation to a drawer below 1024 px and always overlays Sonde there', () => {
    const g = resolveShellGeometry({ viewportWidth: 900, navMode: 'labels', sondeWidth: 384 });
    expect(g.navWidth).toBe(0);
    expect(g.sondeDisplay).toBe('overlay');
  });

  it('uses 24 px padding on very large displays', () => {
    expect(resolveShellGeometry({ viewportWidth: 1920, navMode: 'labels', sondeWidth: 384 }).mainPadding).toBe(24);
    expect(resolveShellGeometry({ viewportWidth: 1440, navMode: 'labels', sondeWidth: 384 }).mainPadding).toBe(16);
  });
});

describe('maxDockableSondeWidth', () => {
  it('is zero when not even the minimum Sonde width fits next to 800 px of work area', () => {
    expect(maxDockableSondeWidth(1366, 208, 16)).toBe(0);
    expect(maxDockableSondeWidth(1440, 208, 16)).toBe(400);
  });
});

describe('homeLimitsFor (UI v2 §6.3)', () => {
  it('follows the table of the specification', () => {
    expect(homeLimitsFor(632)).toMatchObject({ attention: 3, inbox: 3, tasks: 2, completed: 2, compact: false });
    expect(homeLimitsFor(719)).toMatchObject({ attention: 3, inbox: 3 });
    expect(homeLimitsFor(720)).toMatchObject({ attention: 4, inbox: 4, tasks: 2, completed: 2 });
    expect(homeLimitsFor(899)).toMatchObject({ attention: 4, inbox: 4 });
    expect(homeLimitsFor(900)).toMatchObject({ attention: 5, inbox: 5, tasks: 3, completed: 3 });
    expect(homeLimitsFor(1000)).toMatchObject({ attention: 5, inbox: 5 });
  });

  it('uses the extra compact rule below 620 px', () => {
    expect(homeLimitsFor(600)).toMatchObject({ attention: 2, inbox: 2, compact: true });
  });
});

describe('homeFitsOneScreen', () => {
  it('allows vertical scrolling for narrow or low work areas (reflow, zoom)', () => {
    expect(homeFitsOneScreen(1000, 700)).toBe(true);
    expect(homeFitsOneScreen(600, 700)).toBe(false);
    expect(homeFitsOneScreen(1000, 400)).toBe(false);
  });
});
