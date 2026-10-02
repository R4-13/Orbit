import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Only raster formats — deliberately excludes SVG. An uploaded SVG is
 * rendered directly in an <img>/<svg> context without any sanitization
 * pipeline in this first cut (stripping <script>/event-handler attributes/
 * external references correctly is its own non-trivial piece of work), so
 * accepting one would mean trusting arbitrary tenant-supplied markup to be
 * safe to render — see docs/ASSUMPTIONS.md.
 */
export const ALLOWED_LOGO_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export class RequestLogoUploadUrlDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @IsIn(ALLOWED_LOGO_CONTENT_TYPES, {
    message: `contentType must be one of: ${ALLOWED_LOGO_CONTENT_TYPES.join(', ')}.`,
  })
  contentType!: (typeof ALLOWED_LOGO_CONTENT_TYPES)[number];
}
