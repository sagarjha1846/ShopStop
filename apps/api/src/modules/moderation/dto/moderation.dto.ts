import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ModerationDecision, ReportSubject } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateReportDto {
  @ApiProperty({ enum: ReportSubject })
  @IsEnum(ReportSubject)
  subjectType!: ReportSubject;

  @ApiProperty({ description: 'Id of the listing / user / message being reported' })
  @IsString()
  subjectId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  details?: string;
}

export class ModerationActionDto {
  @ApiProperty({ enum: ModerationDecision })
  @IsEnum(ModerationDecision)
  decision!: ModerationDecision;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
