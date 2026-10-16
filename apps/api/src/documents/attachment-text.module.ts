import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AttachmentTextService } from './attachment-text.service';

@Module({
  imports: [StorageModule],
  providers: [AttachmentTextService],
  exports: [AttachmentTextService],
})
export class AttachmentTextModule {}
