import { Module } from '@nestjs/common';
import { PlatformControlModule } from '../platform-control/platform-control.module';
import { ApiKeyOrJwtGuard } from './api-key-or-jwt.guard';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';

/** Zugriffsschlüssel (Dienstzugang): Verwaltung und Prüfung. Module, die einen Endpunkt für Schlüssel öffnen, importieren dieses Modul und nutzen `ApiKeyOrJwtGuard`. */
@Module({
  imports: [PlatformControlModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysService, ApiKeyOrJwtGuard],
  exports: [ApiKeysService, ApiKeyOrJwtGuard],
})
export class ApiKeysModule {}
