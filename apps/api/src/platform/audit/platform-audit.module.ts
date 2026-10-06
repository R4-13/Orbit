import { Module } from '@nestjs/common';
import { PlatformAuditService } from './platform-audit.service';

/** Eigenes kleines Modul, damit Plattform- und Governance-Module den Audit-Schreibpfad teilen, ohne sich gegenseitig zu importieren. */
@Module({ providers: [PlatformAuditService], exports: [PlatformAuditService] })
export class PlatformAuditModule {}
