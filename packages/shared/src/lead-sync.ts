import { sha256Hex } from './sha256';

/** Größtes Feld, das ins CRM geschrieben wird (HubSpot: Beschreibung des Deals); längere Texte werden dort gekürzt, der Abgleich vergleicht mit dem gekürzten Wortlaut. */
export const CRM_NOTES_MAX_CHARS = 2000;
export const CRM_TITLE_MAX_CHARS = 150;

/** Zeilenenden vereinheitlicht und Ränder entfernt – CRM-Systeme speichern Zeilenumbrüche nicht immer byte-genau zurück. */
export const normalizeCrmText = (text: string): string => text.replace(/\r\n?/g, '\n').trim();

/** Der Wortlaut, wie das CRM ihn hält (gekürzt auf das Feldlimit). */
export const crmFieldText = (notes: string): string => normalizeCrmText(notes.slice(0, CRM_NOTES_MAX_CHARS));

/** Fingerabdruck des Leadinhalts (Titel und Beschreibung): gleicher Stand ergibt dieselbe Zeichenfolge. */
export const leadContentHash = (title: string, notes: string): string => sha256Hex(`${title.trim()}\n${crmFieldText(notes)}`);
