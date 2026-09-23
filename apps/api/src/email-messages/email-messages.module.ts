import { Module } from '@nestjs/common';
import { EmailMessagesController } from './email-messages.controller';
import { EmailMessagesService } from './email-messages.service';

@Module({
  controllers: [EmailMessagesController],
  providers: [EmailMessagesService],
  exports: [EmailMessagesService],
})
export class EmailMessagesModule {}
