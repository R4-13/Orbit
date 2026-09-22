import { Global, Module } from '@nestjs/common';
import { CredentialEncryptionService } from './credential-encryption.service';

/** Global like PrismaModule/AuditModule — CredentialEncryptionService has no per-request state, one instance suffices for the whole process. */
@Global()
@Module({
  providers: [CredentialEncryptionService],
  exports: [CredentialEncryptionService],
})
export class SecurityModule {}
