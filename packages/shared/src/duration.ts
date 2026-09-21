/**
 * Parses short duration strings ("15m", "7d", "500ms") as used by
 * JWT_ACCESS_TTL/JWT_REFRESH_TTL (@orbit/config/env.ts) into milliseconds.
 * jsonwebtoken accepts these strings natively for `expiresIn`, but computing
 * a concrete expiry Date for a DB row (e.g. RefreshToken.expiresAt) needs an
 * actual millisecond offset — this is that conversion, kept dependency-free
 * rather than pulling in a library (ms, dayjs) for one function.
 */
const UNIT_TO_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

const DURATION_PATTERN = /^(\d+)\s*(ms|s|m|h|d)$/i;

export function parseDurationToMs(duration: string): number {
  const match = DURATION_PATTERN.exec(duration.trim());
  if (!match) {
    throw new Error(
      `Invalid duration "${duration}". Expected a number followed by one of: ms, s, m, h, d (e.g. "15m", "7d").`,
    );
  }
  // Both groups are guaranteed present by DURATION_PATTERN on a successful match.
  const amount = match[1]!;
  const unit = match[2]!.toLowerCase();
  return Number(amount) * UNIT_TO_MS[unit]!;
}
