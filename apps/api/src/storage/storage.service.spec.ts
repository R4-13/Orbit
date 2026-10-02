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

describe('StorageService.buildPublicStorageKey / getPublicUrl', () => {
  let service: StorageService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [StorageService, { provide: ORBIT_ENV, useValue: ENV }],
    }).compile();
    service = moduleRef.get(StorageService);
  });

  it('namespaces the key under public/tenants/<id>/<category>/ — the prefix the anonymous-read bucket policy is scoped to', () => {
    const key = service.buildPublicStorageKey('tenant_1', 'branding', 'logo.png');
    expect(key).toMatch(/^public\/tenants\/tenant_1\/branding\/.+-logo\.png$/);
  });

  it('sanitizes filenames the same way as buildStorageKey', () => {
    const key = service.buildPublicStorageKey('tenant_1', 'branding', '../../etc/passwd');
    expect(key.startsWith('public/tenants/tenant_1/branding/')).toBe(true);
    expect(key).not.toContain('..');
  });

  it('getPublicUrl builds a permanent, unsigned URL from the configured public endpoint and bucket', () => {
    const url = service.getPublicUrl('public/tenants/tenant_1/branding/abc-logo.png');
    expect(url).toBe('http://localhost:9000/orbit-documents/public/tenants/tenant_1/branding/abc-logo.png');
  });

  it('getPublicUrl falls back to S3_ENDPOINT when S3_PUBLIC_ENDPOINT is not set', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [StorageService, { provide: ORBIT_ENV, useValue: { ...ENV, S3_ENDPOINT: 'http://internal:9000' } }],
    }).compile();
    const internalOnlyService = moduleRef.get(StorageService);
    expect(internalOnlyService.getPublicUrl('public/x')).toBe('http://internal:9000/orbit-documents/public/x');
  });

  it('getPublicUrl prefers S3_PUBLIC_ENDPOINT over S3_ENDPOINT when both are set', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: ORBIT_ENV, useValue: { ...ENV, S3_ENDPOINT: 'http://minio:9000', S3_PUBLIC_ENDPOINT: 'http://localhost:9000' } },
      ],
    }).compile();
    const dualEndpointService = moduleRef.get(StorageService);
    expect(dualEndpointService.getPublicUrl('public/x')).toBe('http://localhost:9000/orbit-documents/public/x');
  });
});
