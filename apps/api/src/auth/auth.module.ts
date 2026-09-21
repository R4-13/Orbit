import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { OrbitEnv } from '@orbit/config';
import { ORBIT_ENV } from '../config/env.token';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ORBIT_ENV],
      useFactory: (env: OrbitEnv) => ({
        secret: env.JWT_SECRET,
        signOptions: { expiresIn: env.JWT_ACCESS_TTL },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
