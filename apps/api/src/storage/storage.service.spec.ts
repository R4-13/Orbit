import { Test } from '@nestjs/testing';
import { ORBIT_ENV } from '../config/env.token';
import { StorageService } from './storage.service';

const ENV = {
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'eu-central-1',
  S3_BUCKET: 'orbit-documents',
  S3_ACCESS_KEY: 'minioadmin',
  S3_SECRET_KEY: 'minioadmin',
  S3_FORCE_PATH_STYLE: true,
};

describe('StorageService.buildStorageKey', () => {
  let service: StorageService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [StorageService, { provide: ORBIT_ENV, useValue: ENV }],
    }).compile();
    service = moduleRef.get(StorageService);
  });

  it('namespaces the key under the tenant and a documents/ prefix', () => {
    const key = service.buildStorageKey('tenant_1', 'invoice.pdf');
    expect(key).toMatch(/^tenants\/tenant_1\/documents\/.+-invoice\.pdf$/);
  });

  it('sanitizes filenames so path traversal / special characters cannot escape the prefix', () => {
    const key = service.buildStorageKey('tenant_1', '../../etc/passwd');
    expect(key.startsWith('tenants/tenant_1/documents/')).toBe(true);
    expect(key).not.toContain('..');
    expect(key).not.toContain('/etc/');
  });

  it('produces a different key on every call, even for the same filename', () => {
    const a = service.buildStorageKey('tenant_1', 'invoice.pdf');
    const b = service.buildStorageKey('tenant_1', 'invoice.pdf');
    expect(a).not.toBe(b);
  });
});
