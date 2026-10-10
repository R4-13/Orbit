import { Module } from '@nestjs/common';
import { ProfileContextService } from './profile-context.service';

@Module({ providers: [ProfileContextService], exports: [ProfileContextService] })
export class ProfileContextModule {}
