import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DeleteObjectCommand, PutObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { OrbitEnv } from '@orbit/config';
import { ORBIT_ENV } from '../config/env.token';

const PRESIGNED_URL_TTL_SECONDS = 15 * 60;

/**
 * Thin wrapper around the S3-compatible object store (MinIO locally, any
 * S3-API-compatible provider in production — §5/§53, ASSUMPTIONS #6).
 * Files never transit through the API process: the frontend uploads
 * directly to a presigned URL, and DocumentsService only ever persists the
 * resulting object key as metadata (see documents.service.ts).
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  /**
   * Signs with the same credentials but a browser-reachable endpoint
   * (`S3_PUBLIC_ENDPOINT`, falling back to `S3_ENDPOINT`) — `getSignedUrl`
   * never actually connects, it only needs the client's configured
   * endpoint/region/credentials to compute the signature, so a second
   * client purely for presigning costs nothing at runtime. Without this,
   * a presigned URL built inside the dockerized api container would
   * embed the Docker-internal hostname ("http://minio:9000"), which only
   * resolves inside the compose network, not in the user's browser.
   */
  private readonly presignClient: S3Client;
  private readonly bucket: string;
  private readonly publicEndpoint: string;

  constructor(@Inject(ORBIT_ENV) env: OrbitEnv) {
    this.bucket = env.S3_BUCKET;
    this.publicEndpoint = env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT;
    const credentials = { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY };
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials,
    });
    this.presignClient = new S3Client({
      endpoint: this.publicEndpoint,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials,
    });
  }

  /** Discards any directory component and anything but a conservative safe character set — shared by every key-building method below. */
  private sanitizeFileName(fileName: string): string {
    const basename = fileName.split(/[/\\]/).pop() ?? 'file';
    return basename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '_').slice(-100);
  }

  /** Deterministic, collision-free object key; never derived from user input directly. */
  buildStorageKey(tenantId: string, fileName: string): string {
    return `tenants/${tenantId}/documents/${randomUUID()}-${this.sanitizeFileName(fileName)}`;
  }

  /**
   * Same idea, under the `public/` prefix the MinIO bucket policy grants
   * anonymous read on (`mc anonymous set download .../public`, see
   * docker-compose.yml) — for assets meant to be loaded directly in an
   * `<img>` tag on every page view (a tenant's logo), not re-signed on
   * every view like a private document. Never use this prefix for
   * anything that isn't meant to be publicly readable by anyone with the URL.
   */
  buildPublicStorageKey(tenantId: string, category: string, fileName: string): string {
    return `public/tenants/${tenantId}/${category}/${randomUUID()}-${this.sanitizeFileName(fileName)}`;
  }

  async getUploadUrl(storageKey: string, contentType: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      ContentType: contentType,
    });
    return getSignedUrl(this.presignClient, command, { expiresIn: PRESIGNED_URL_TTL_SECONDS });
  }

  async getDownloadUrl(storageKey: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: storageKey });
    return getSignedUrl(this.presignClient, command, { expiresIn: PRESIGNED_URL_TTL_SECONDS });
  }

  /** Same presigned-PUT mechanism as `getUploadUrl` — the write itself still requires this short-lived signed URL (so still gated by whoever our own API chose to hand it to); only the resulting GET is unauthenticated. */
  getPublicUploadUrl(storageKey: string, contentType: string): Promise<string> {
    return this.getUploadUrl(storageKey, contentType);
  }

  /** Permanent, unsigned URL for a `public/`-prefixed object — never expires, safe to store and render directly (e.g. TenantBranding.logoUrl). */
  getPublicUrl(storageKey: string): string {
    return `${this.publicEndpoint}/${this.bucket}/${storageKey}`;
  }

  async delete(storageKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }));
  }

  /**
   * Downloads an object's full bytes into memory — used server-side for
   * processing (OCR extraction, Phase 7), never for serving a file to a
   * browser (that goes through `getDownloadUrl`'s presigned URL instead).
   */
  async getObjectBytes(storageKey: string): Promise<Buffer> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }));
    const bytes = await response.Body?.transformToByteArray();
    return Buffer.from(bytes ?? []);
  }

  /**
   * Uploads bytes directly, server-side — used when the API process
   * itself receives file content (an inbound-email attachment via
   * IntakeService, Phase 18) rather than a browser doing a presigned-URL
   * PUT. This is the one legitimate exception to this class's own "files
   * never transit through the API process" rule above: a real mail
   * connector's webhook handler would face the identical situation
   * (Microsoft Graph/Gmail hand you attachment bytes directly, not a URL
   * for the browser to upload to).
   */
  async putObjectBytes(storageKey: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: storageKey, Body: bytes, ContentType: contentType }),
    );
  }
}
