import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { findRepoRootEnvFile } from '@orbit/config';

const rootEnvFile = findRepoRootEnvFile(__dirname);

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: rootEnvFile ? [rootEnvFile] : undefined })],
})
export class WorkerModule {}
