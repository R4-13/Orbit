import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { isOrbitError } from '@orbit/shared';
import { ORBIT_ENV } from '../config/env.token';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

const ENV = {
  JWT_SECRET: 'test_secret_at_least_16_chars',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '7d',
};

function buildUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user_1',
    tenantId: 'tenant_1',
    email: 'admin@musterwerk.example',
    status: 'ACTIVE',
    tenant: { id: 'tenant_1', status: 'ACTIVE', suspensionScopes: [] as string[] },
    roles: [
      {
        role: {
          name: 'TENANT_ADMIN',
          permissions: [{ permission: 'invoice.approve' }, { permission: 'user.manage' }],
        },
      },
    ],
    ...overrides,
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock };
    refreshToken: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    withRlsBypass: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      // Real PrismaService.withRlsBypass() runs `fn` inside a transaction
      // with an RLS-bypass GUC set (Phase 15); the mock just runs `fn`
      // against this same mock object, since it exposes the identical
      // user/refreshToken delegate shape a real `tx` would.
      withRlsBypass: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: new JwtService({ secret: ENV.JWT_SECRET }) },
        { provide: ORBIT_ENV, useValue: ENV },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('login', () => {
    it('rejects an unknown email with UnauthorizedException', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.login('nobody@example.com', 'whatever')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a deactivated user', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser({ status: 'DEACTIVATED' }));
      await expect(service.login('admin@musterwerk.example', 'whatever')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a user on a suspended tenant', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ tenant: { id: 'tenant_1', status: 'SUSPENDED', suspensionScopes: [] } }),
      );
      await expect(service.login('admin@musterwerk.example', 'whatever')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a wrong password without revealing whether the email exists', async () => {
      const passwordHash = await argon2.hash('correct-password');
      prisma.user.findUnique.mockResolvedValue(buildUser({ passwordHash }));

      await expect(
        service.login('admin@musterwerk.example', 'wrong-password'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('on success, returns a signed access token, a random refresh token, and the flattened permission set', async () => {
      const passwordHash = await argon2.hash('correct-password');
      prisma.user.findUnique.mockResolvedValue(buildUser({ passwordHash }));

      const result = await service.login('admin@musterwerk.example', 'correct-password');

      expect(typeof result.accessToken).toBe('string');
      expect(result.accessToken.split('.')).toHaveLength(3); // JWT has 3 segments
      expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);
      expect(result.user).toEqual({
        id: 'user_1',
        tenantId: 'tenant_1',
        email: 'admin@musterwerk.example',
        roles: ['TENANT_ADMIN'],
        permissions: ['invoice.approve', 'user.manage'],
      });
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('refresh', () => {
    it('throws AuthenticationExpiredError for an unknown refresh token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      let caught: unknown;
      try {
        await service.refresh('does-not-exist');
      } catch (error) {
        caught = error;
      }
      expect(isOrbitError(caught)).toBe(true);
      expect((caught as { code: string }).code).toBe('AUTHENTICATION_EXPIRED');
    });

    it('throws AuthenticationExpiredError for a revoked token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt_1',
        userId: 'user_1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 100000),
      });

      await expect(service.refresh('revoked-token')).rejects.toMatchObject({
        code: 'AUTHENTICATION_EXPIRED',
      });
    });

    it('throws AuthenticationExpiredError for an expired token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt_1',
        userId: 'user_1',
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.refresh('expired-token')).rejects.toMatchObject({
        code: 'AUTHENTICATION_EXPIRED',
      });
    });

    it('rotates a valid token: revokes the old one and issues a new token pair', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt_1',
        userId: 'user_1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 100000),
      });
      prisma.user.findUnique.mockResolvedValue(buildUser());

      const result = await service.refresh('valid-token');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt_1' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(result.refreshToken).toMatch(/^[0-9a-f]{64}$/);
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('logout', () => {
    it('revokes the matching, not-yet-revoked refresh token', async () => {
      await service.logout('some-refresh-token');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { tokenHash: expect.any(String), revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});
