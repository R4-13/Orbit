import { Injectable } from '@nestjs/common';
import { profileForPrompt } from '@orbit/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Das Betriebsprofil als Text für die KI-Anweisungen (Triage, Anforderungsanalyse): Branche, Leistungen, Zeiten, Notdienst, Tonalität, freigegebene Antworten.
 * Eigenes, schlankes Modul ohne weitere Abhängigkeiten, damit Eingang und Prozess es nutzen können, ohne das Verwaltungsmodul (und dessen Versand) zu beziehen.
 * Ohne Profil: leer – die KI arbeitet dann allgemein, wie bisher.
 */
@Injectable()
export class ProfileContextService {
  constructor(private readonly prisma: PrismaService) {}

  /** Abschnitt „Betriebsprofil“ oder leer. Der Text stammt vom Betrieb selbst (Anweisung, nicht Kundendaten). */
  async promptFor(tenantId: string): Promise<string> {
    const profile = await this.prisma.forTenantId(tenantId).tenantProfile.findUnique({ where: { tenantId } });
    if (!profile) return '';
    const text = profileForPrompt({
      industry: profile.industry,
      description: profile.description,
      services: profile.services,
      exclusions: profile.exclusions,
      serviceArea: profile.serviceArea,
      openingHours: profile.openingHours,
      emergencyService: profile.emergencyService,
      emergencyNote: profile.emergencyNote,
      tone: profile.tone,
      languages: profile.languages,
      faqs: profile.faqs,
    });
    return text.trim() ? `Betriebsprofil (vom Betrieb gepflegt):\n${text}` : '';
  }
}
