import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { MediaService } from './media.service';

class UploadUrlDto {
  @IsString()
  contentType!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  sizeBytes?: number;
}

@ApiTags('Listings')
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  /** Get a short-lived presigned upload URL. Requires auth (any signed-in user). */
  @Post('upload-url')
  createUploadUrl(@Body() dto: UploadUrlDto) {
    return this.media.createUploadTicket(dto.contentType, dto.sizeBytes);
  }
}
