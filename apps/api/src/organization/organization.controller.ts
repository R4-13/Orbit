import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, StaffInputSchema, UpdateTenantProfileRequestSchema, ValidationFailedError } from '@orbit/shared';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AuthenticatedUser } from '../auth/types';
import { ApiKeyOrJwtGuard } from '../api-keys/api-key-or-jwt.guard';
import { AttentionService } from './attention.service';
import { ProfileSuggestionService } from './profile-suggestion.service';
import { StaffService } from './staff.service';
import { TenantProfileService } from './tenant-profile.service';

/** Prüft einen Anfragetext gegen ein Schema; Verstöße erscheinen als verständliche Meldung (400), nicht als Stacktrace. */
function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationFailedError(parsed.error.issues.map((i) => `${i.path.join('.') || 'Eingabe'}: ${i.message}`).join('; '), { issues: parsed.error.issues });
  }
  return parsed.data;
}

const CsvBodySchema = z.object({ csv: z.string().min(1).max(1_500_000), deactivateMissing: z.boolean().optional() }).strict();
const SyncBodySchema = z.object({ staff: z.array(z.unknown()).min(1).max(2000), deactivateMissing: z.boolean().optional(), dryRun: z.boolean().optional() }).strict();

/** Entweder ein eingefügter Text oder eine Datei (Base64, bis etwa 1,4 MB wegen der Größe der Anfrage). */
const SuggestBodySchema = z.union([
  z.object({ text: z.string().max(40_000) }).strict(),
  z.object({ fileName: z.string().min(1).max(255), mimeType: z.string().min(3).max(120), contentBase64: z.string().min(4).max(1_900_000) }).strict(),
]);

/** Betriebsprofil und Einrichtungs-Checkliste (`/tenant/profile`). Lesen wie Schreiben erfordern `tenant.profile.manage` (TENANT_ADMIN). */
@ApiTags('organization')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.TENANT_PROFILE_MANAGE)
@Controller({ path: 'tenant/profile' })
export class TenantProfileController {
  constructor(
    private readonly profile: TenantProfileService,
    private readonly suggestions: ProfileSuggestionService,
  ) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.profile.get(user.tenantId);
  }

  /** Profil aus einem eingefügten Text vorschlagen (AUT-10): speichert nichts, der Vorschlag wird im Formular geprüft. */
  @Post('suggest')
  @HttpCode(HttpStatus.OK)
  suggest(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const parsed = parseBody(SuggestBodySchema, body);
    return 'text' in parsed ? this.suggestions.suggest(user.tenantId, parsed.text) : this.suggestions.suggestFromFile(user.tenantId, parsed);
  }

  @Put()
  update(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.profile.update(user.tenantId, user.id, parseBody(UpdateTenantProfileRequestSchema, body));
  }
}

/**
 * Mitarbeiterverzeichnis (`/staff`): einzeln erfassen, per CSV-Datei einlesen (erst Vorschau, dann Übernahme) oder über die Schnittstelle `PUT /staff/sync`
 * abgleichen. Personen werden deaktiviert, nicht gelöscht.
 */
@ApiTags('organization')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.TENANT_PROFILE_MANAGE)
@Controller({ path: 'staff' })
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('includeInactive') includeInactive?: string) {
    return this.staff.list(user.tenantId, includeInactive === 'true' || includeInactive === '1');
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.staff.create(user.tenantId, user.id, parseBody(StaffInputSchema, body));
  }

  // Feste Pfade vor `:id`, damit sie nicht als Kennung gelesen werden.
  @Post('import/preview')
  previewImport(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const { csv, deactivateMissing } = parseBody(CsvBodySchema, body);
    return this.staff.previewCsv(user.tenantId, csv, deactivateMissing ?? false);
  }

  @Post('import')
  importCsv(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const { csv, deactivateMissing } = parseBody(CsvBodySchema, body);
    return this.staff.importCsv(user.tenantId, user.id, csv, { dryRun: false, deactivateMissing: deactivateMissing ?? false });
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.staff.get(user.tenantId, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.staff.update(user.tenantId, user.id, id, parseBody(StaffInputSchema.partial(), body));
  }

  /** Deaktiviert die Person (sie wird bei Meldungen übersprungen); wieder aktivieren per `PATCH { "active": true }`. */
  @Delete(':id')
  deactivate(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.staff.deactivate(user.tenantId, user.id, id);
  }
}

/**
 * Schnittstelle für größere Betriebe (`PUT /staff/sync`): das Verzeichnis des führenden Systems (Personalverwaltung, Verzeichnisdienst) als JSON-Liste, Schlüssel
 * `externalId`. Aufrufbar mit einem Konto mit `staff.sync` **oder** mit einem Zugriffsschlüssel dieses Bereichs (Dienstzugang, AUT-12) – ein Schlüssel kann sonst nichts.
 */
@ApiTags('organization')
@ApiBearerAuth()
@UseGuards(ApiKeyOrJwtGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.STAFF_SYNC)
@Controller({ path: 'staff/sync' })
export class StaffSyncController {
  constructor(private readonly staff: StaffService) {}

  @Put()
  sync(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const { staff, deactivateMissing, dryRun } = parseBody(SyncBodySchema, body);
    return this.staff.sync(user.tenantId, user.id, staff, { dryRun: dryRun ?? false, deactivateMissing: deactivateMissing ?? false });
  }
}

/**
 * Was zu einem Vorgang gemeldet wurde und die Quittierung „Ich kümmere mich“. Jeder, der Vorgänge sehen darf, sieht den Stand der Meldungen; quittieren darf,
 * wer Vorgänge bearbeiten darf.
 */
@ApiTags('organization')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'attention' })
export class AttentionController {
  constructor(private readonly attention: AttentionService) {}

  @Get('cases/:caseId')
  @RequirePermissions(PERMISSIONS.CASE_READ)
  async forCase(@CurrentUser() user: AuthenticatedUser, @Param('caseId', new ParseUUIDPipe()) caseId: string) {
    // Als Objekt, nie `null` direkt: ein leerer Antwortkörper würde clientseitig als Fehler gelesen.
    return { attention: await this.attention.forCase(user.tenantId, caseId) };
  }

  @Post(':id/acknowledge')
  @RequirePermissions(PERMISSIONS.CASE_MANAGE)
  acknowledge(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.attention.acknowledge(user.tenantId, user.id, id);
  }
}
