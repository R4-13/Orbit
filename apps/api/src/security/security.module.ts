import { Global, Module } from '@nestjs/common';
import { CredentialEncryptionService } from './credential-encryption.service';
import { CredentialVaultService } from './credential-vault.service';

/** Global like PrismaModule/AuditModule — neither service has per-request state, one instance suffices for the whole process. */
@Global()
@Module({
  providers: [CredentialEncryptionService, CredentialVaultService],
  exports: [CredentialEncryptionService, CredentialVaultService],
})
export class SecurityModule {}
