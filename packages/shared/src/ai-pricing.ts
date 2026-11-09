/**
 * Preise der KI-Modelle und die Kostenrechnung, die vor und nach jedem Aufruf gebraucht wird (Pilotvorbereitung, Kostenkontrolle). Reine, datenbankfreie Regeln.
 *
 * Preise stehen hier mit **Quelle und Prüfdatum** – nie als stillschweigende Annahme. Ein Modell ohne Eintrag hat keinen Preis; dann kann ein durchgesetztes Kostenlimit
 * keinen Aufruf freigeben (ehrlicher Block statt Schätzung ins Blaue). Der Betreiber kann den Preis je Umgebung überschreiben (`costProfileOf`).
 */

export interface CostTier {
  /** Preis je 1 Mio. Eingabe-Token. */
  inputPerMtok: number;
  /** Preis je 1 Mio. Ausgabe-Token (bei Modellen mit Denkschritten zählen diese Token als Ausgabe, soweit der Anbieter sie so abrechnet). */
  outputPerMtok: number;
}

export interface ModelCostProfile extends CostTier {
  currency: string;
  /** Höhere Preisstufe für sehr lange Eingaben: gilt, sobald die Eingabe des Aufrufs die Schwelle überschreitet. */
  longContext?: CostTier & { aboveInputTokens: number };
}

export interface ModelPriceEntry {
  providerKey: string;
  modelId: string;
  profile: ModelCostProfile;
  /** Zwischengespeicherte Eingabe wird nie unterstellt: die Rechnung nimmt den vollen Eingabepreis (obere Schranke). Der Wert dient nur der Dokumentation. */
  cachedInputPerMtok?: number;
  source: {
    url: string;
    /** Tag (UTC), an dem die Quelle gelesen wurde. Die Seite selbst nennt kein Änderungsdatum. */
    checkedOn: string;
    note: string;
  };
}

/**
 * Preiskatalog. Quelle: offizielle Preisseite des Anbieters, am 02.11.2026 gelesen. Die Seite nennt „$“ ohne Währungskennung; ORBIT führt USD.
 * Die Seite enthält keinen Hinweis, dass Denk-Token anders als Ausgabe-Token berechnet würden („Tokens are billed at the chosen model's input and output rates“).
 * Der Betreiber bestätigt den Preis (Entscheidung E4); bis dahin gilt dieser Eintrag, jederzeit überschreibbar per Umgebung.
 */
export const MODEL_PRICE_CATALOG: readonly ModelPriceEntry[] = [
  {
    providerKey: 'openai',
    modelId: 'gpt-6-luna',
    profile: {
      currency: 'USD',
      inputPerMtok: 0.1,
      outputPerMtok: 0.5,
      longContext: { aboveInputTokens: 272_000, inputPerMtok: 0.2, outputPerMtok: 0.75 },
    },
    cachedInputPerMtok: 0.01,
    source: {
      url: 'https://developers.openai.com/api/docs/pricing',
      checkedOn: '2026-11-02',
      note: 'Standardstufe, Text-Token, je 1 Mio. Token. Kurzer Kontext bis 272.000 Eingabe-Token: 0,10 / 0,50 USD (zwischengespeichert 0,01). Langer Kontext darüber: 0,20 / 0,75 USD. Batch/Flex halb so teuer (wird nicht genutzt). Regionale Verarbeitung +10 % (nicht genutzt).',
    },
  },
];

export function findModelPrice(providerKey: string, modelId: string | undefined): ModelPriceEntry | undefined {
  if (!modelId) return undefined;
  return MODEL_PRICE_CATALOG.find((e) => e.providerKey === providerKey.toLowerCase() && e.modelId === modelId);
}

/** Überschreibung aus der Umgebung (vollständig oder gar nicht): beide Preise und die Währung müssen gesetzt sein, sonst gilt der Katalog. */
export interface CostOverride {
  inputPerMtok?: number | null;
  outputPerMtok?: number | null;
  currency?: string | null;
}

/** Das Kostenprofil, mit dem ein Aufruf gerechnet wird: Überschreibung vor Katalog; `null` = Preis unbekannt (kein Raten). */
export function costProfileOf(providerKey: string, modelId: string | undefined, override?: CostOverride): ModelCostProfile | null {
  if (override?.inputPerMtok != null && override.outputPerMtok != null && override.currency) {
    return { currency: override.currency.toUpperCase(), inputPerMtok: override.inputPerMtok, outputPerMtok: override.outputPerMtok };
  }
  return findModelPrice(providerKey, modelId)?.profile ?? null;
}

export function tierFor(profile: ModelCostProfile, inputTokens: number): CostTier {
  return profile.longContext && inputTokens > profile.longContext.aboveInputTokens ? profile.longContext : profile;
}

/** Tatsächliche Kosten eines Aufrufs aus den gemeldeten Token; `null`, wenn der Anbieter keine Angabe machte (nie 0 unterstellen). */
export function actualCost(usage: { inputTokens?: number | null; outputTokens?: number | null } | undefined, profile: ModelCostProfile): number | null {
  if (usage?.inputTokens == null || usage.outputTokens == null) return null;
  const tier = tierFor(profile, usage.inputTokens);
  return (usage.inputTokens * tier.inputPerMtok + usage.outputTokens * tier.outputPerMtok) / 1_000_000;
}

/** Länge in UTF-8-Bytes ohne Zwischenspeicher. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4; // Ersatzpaar: vier Bytes für zwei UTF-16-Einheiten
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/** Festzuschlag je Nachricht und für Rollen-/Werkzeugrahmen, den der Anbieter zusätzlich zählt (großzügig angesetzt). */
const TOKENS_PER_MESSAGE_OVERHEAD = 16;
const TOKENS_BASE_OVERHEAD = 256;

/**
 * Strenge Obergrenze der Eingabe-Token: die Byte-Länge des gesendeten Textes (ein Token umfasst mindestens ein Byte; das gilt für byteweise Tokenizer wie die der heutigen Anbieter) plus Festzuschläge für
 * den Nachrichtenrahmen. Bewusst deutlich über dem tatsächlichen Verbrauch (deutscher Text liegt bei etwa 3–4 Zeichen je Token): die Reservierung ist eine Schranke, keine Schätzung.
 */
export function inputTokensUpperBound(request: { systemPrompt?: string; messages: ReadonlyArray<{ content: string }>; tools: ReadonlyArray<unknown> }): number {
  let bytes = request.systemPrompt ? utf8Length(request.systemPrompt) : 0;
  for (const m of request.messages) bytes += utf8Length(m.content) + TOKENS_PER_MESSAGE_OVERHEAD;
  if (request.tools.length > 0) bytes += utf8Length(JSON.stringify(request.tools));
  return bytes + TOKENS_BASE_OVERHEAD;
}

/** Ausgabegrenze, die die Anbieter-Adapter (`OpenAILLMProvider`, `AnthropicLLMProvider`) als `max_completion_tokens`/`max_tokens` senden, wenn der Aufrufer keine nennt: Einzige Quelle für Adapter und Reservierung. Bei Denkmodellen zählen Denk-Token innerhalb dieser Grenze. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

/**
 * Schlimmster Fall für einen Aufruf: volle Eingabe-Obergrenze zum (ggf. höheren) Preis der Stufe plus die höchste zulässige Ausgabe. Diesen Betrag reserviert
 * ein durchgesetztes Kostenlimit **vor** dem Aufruf; nach dem Aufruf zählen die tatsächlichen Kosten.
 */
export function worstCaseCost(profile: ModelCostProfile, request: { systemPrompt?: string; messages: ReadonlyArray<{ content: string }>; tools: ReadonlyArray<unknown>; maxTokens?: number }): number {
  const input = inputTokensUpperBound(request);
  const output = request.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const tier = tierFor(profile, input);
  return (input * tier.inputPerMtok + output * tier.outputPerMtok) / 1_000_000;
}
