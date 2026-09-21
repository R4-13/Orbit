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
  private readonly bucket: string;

  constructor(@Inject(ORBIT_ENV) env: OrbitEnv) {
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
    });
  }

  /** Deterministic, collision-free object key; never derived from user input directly. */
  buildStorageKey(tenantId: string, fileName: string): string {
    // Discard any directory component the client-supplied filename might
    // carry (e.g. "../../etc/passwd") — only the basename is ever used —
    // then strip everything but a conservative safe character set.
    const basename = fileName.split(/[/\\]/).pop() ?? 'file';
    const safeSuffix = basename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '_').slice(-100);
    return `tenants/${tenantId}/documents/${randomUUID()}-${safeSuffix}`;
  }

  async getUploadUrl(storageKey: string, contentType: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      ContentType: contentType,
    });
    return getSignedUrl(this.client, command, { expiresIn: PRESIGNED_URL_TTL_SECONDS });
  }

  async getDownloadUrl(storageKey: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: storageKey });
    return getSignedUrl(this.client, command, { expiresIn: PRESIGNED_URL_TTL_SECONDS });
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
}
