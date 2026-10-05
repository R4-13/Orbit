/**
 * UI/UX v2 §4–§6: die verbindliche Shell-Geometrie als reine, getestete Funktionen. Sie rechnen mit der tatsächlich
 * verfügbaren CSS-Viewportgröße (nie mit der Displayauflösung) und entscheiden, ob Sonde angedockt bleiben darf.
 */

export const HEADER_HEIGHT = 56;
export const NAV_WIDTH = 208;
export const NAV_RAIL_WIDTH = 72;
export const SONDE_DEFAULT_WIDTH = 384;
export const SONDE_MIN_WIDTH = 360;
export const SONDE_MAX_WIDTH = 480;
/** Mindestbreite des Hauptinhalts, solange Sonde angedockt ist (§4.1). */
export const MIN_DOCKED_MAIN_WIDTH = 800;
/** Unterhalb davon wird die Navigation zur Schublade (Tablet/Mobil, §25). */
export const NAV_DRAWER_BREAKPOINT = 1024;

export type NavMode = 'labels' | 'rail';
export type SondeDisplay = 'docked' | 'overlay';

/** 16 px Seitenabstand, auf sehr großen Anzeigen 24 px (§4.1). */
export function mainPaddingFor(viewportWidth: number): number {
  return viewportWidth >= 1800 ? 24 : 16;
}

export function navWidthFor(viewportWidth: number, navMode: NavMode): number {
  if (viewportWidth < NAV_DRAWER_BREAKPOINT) return 0;
  return navMode === 'rail' ? NAV_RAIL_WIDTH : NAV_WIDTH;
}

export function clampSondeWidth(width: number): number {
  return Math.min(SONDE_MAX_WIDTH, Math.max(SONDE_MIN_WIDTH, Math.round(width)));
}

/** `nettoMain = viewportWidth - navWidth - dockedSondeWidth - 2 * mainPadding` (§4.1). */
export function netMainWidth(viewportWidth: number, navWidth: number, dockedSondeWidth: number, mainPadding: number): number {
  return viewportWidth - navWidth - dockedSondeWidth - 2 * mainPadding;
}

/** Die größte Sonde-Breite, bei der der Hauptinhalt noch mindestens 800 px netto behält; `0`, wenn nicht einmal das Minimum passt. */
export function maxDockableSondeWidth(viewportWidth: number, navWidth: number, mainPadding: number): number {
  const available = viewportWidth - navWidth - 2 * mainPadding - MIN_DOCKED_MAIN_WIDTH;
  if (available < SONDE_MIN_WIDTH) return 0;
  return Math.min(SONDE_MAX_WIDTH, available);
}

export interface ShellGeometry {
  navWidth: number;
  mainPadding: number;
  /** Tatsächlich belegte Breite der angedockten Sonde (0 bei Overlay/geschlossen). */
  dockedSondeWidth: number;
  sondeDisplay: SondeDisplay;
  netMain: number;
}

/**
 * Entscheidet die Darstellung. Sonde bleibt nur angedockt, wenn `nettoMain >= 800`; sonst Overlay (§4.1, AC-08). Ein manuell
 * gewählter Breitenwunsch wird auf das Zulässige begrenzt, überschreitet die Grenze also nie.
 */
export function resolveShellGeometry(input: { viewportWidth: number; navMode: NavMode; sondeWidth: number }): ShellGeometry {
  const mainPadding = mainPaddingFor(input.viewportWidth);
  const navWidth = navWidthFor(input.viewportWidth, input.navMode);
  const maxDock = maxDockableSondeWidth(input.viewportWidth, navWidth, mainPadding);
  if (maxDock === 0) {
    return { navWidth, mainPadding, dockedSondeWidth: 0, sondeDisplay: 'overlay', netMain: netMainWidth(input.viewportWidth, navWidth, 0, mainPadding) };
  }
  const dockedSondeWidth = Math.min(clampSondeWidth(input.sondeWidth), maxDock);
  return {
    navWidth,
    mainPadding,
    dockedSondeWidth,
    sondeDisplay: 'docked',
    netMain: netMainWidth(input.viewportWidth, navWidth, dockedSondeWidth, mainPadding),
  };
}

/** Erststart ohne gespeicherte Präferenz: Sonde offen nur, wenn sie angedockt werden kann (§8.2). */
export function defaultSondeOpen(geometry: Pick<ShellGeometry, 'sondeDisplay'>): boolean {
  return geometry.sondeDisplay === 'docked';
}

export interface HomeLimits {
  attention: number;
  inbox: number;
  tasks: number;
  completed: number;
  /** Unter 620 px Nettohöhe: kompakte Fachkarten und Abschlusszeile nur mit Count und Link (§6.3). */
  compact: boolean;
}

/** Vorschaugrenzen nach Nettohöhe des Arbeitsbereichs (nach Header und Padding), §6.3. */
export function homeLimitsFor(netHeight: number): HomeLimits {
  if (netHeight < 620) return { attention: 2, inbox: 2, tasks: 1, completed: 1, compact: true };
  if (netHeight < 720) return { attention: 3, inbox: 3, tasks: 2, completed: 2, compact: false };
  if (netHeight < 900) return { attention: 4, inbox: 4, tasks: 2, completed: 2, compact: false };
  return { attention: 5, inbox: 5, tasks: 3, completed: 3, compact: false };
}

/** Die Home-Einbildschirmgeometrie gilt auf Desktop; darunter (schmal, stark gezoomt, niedrig) darf vertikal gescrollt werden (HOME-03). */
export function homeFitsOneScreen(netWidth: number, netHeight: number): boolean {
  return netWidth >= 720 && netHeight >= 560;
}
