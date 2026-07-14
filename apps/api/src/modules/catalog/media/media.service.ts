import { Injectable } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '../../../config/config.module';
import { AppError } from '../../../common/errors/app-error';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'video/mp4']);
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

export interface UploadTicket {
  uploadUrl: string;
  storageKey: string;
  publicUrl: string;
}

/**
 * Direct-to-S3 uploads via short-lived presigned PUT URLs (docs/09 #8). The server
 * never proxies file bytes. Content-type + size are constrained here; an async
 * media-scan worker (Phase 4) sets Media.scanStatus and hides flagged content.
 */
@Injectable()
export class MediaService {
  private readonly s3: S3Client;

  constructor(private readonly config: AppConfigService) {
    this.s3 = new S3Client({
      region: config.get('S3_REGION'),
      endpoint: config.get('S3_ENDPOINT'),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE'),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY'),
        secretAccessKey: config.get('S3_SECRET_KEY'),
      },
    });
  }

  async createUploadTicket(contentType: string, sizeBytes?: number): Promise<UploadTicket> {
    if (!ALLOWED_TYPES.has(contentType)) {
      throw AppError.validation(`Unsupported content type: ${contentType}`);
    }
    if (sizeBytes !== undefined && sizeBytes > MAX_BYTES) {
      throw AppError.validation(`File exceeds ${MAX_BYTES / (1024 * 1024)}MB limit`);
    }

    const ext = contentType.split('/')[1] ?? 'bin';
    const storageKey = `uploads/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: this.config.get('S3_BUCKET'),
      Key: storageKey,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 300 });

    return {
      uploadUrl,
      storageKey,
      publicUrl: `${this.config.get('CDN_BASE_URL')}/${storageKey}`,
    };
  }
}
