-- Aufbewahrung auch für Nachrichtentexte und überholte Fakten (BPF-03, DSGVO-Datensparsamkeit)
ALTER TYPE "RetentionCategory" ADD VALUE IF NOT EXISTS 'EMAIL_BODIES';
ALTER TYPE "RetentionCategory" ADD VALUE IF NOT EXISTS 'SUPERSEDED_FACTS';
