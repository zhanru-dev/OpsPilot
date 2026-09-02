import { MediaKind } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateMediaUploadDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsEnum(MediaKind)
  kind!: MediaKind;

  @IsString()
  @MaxLength(100)
  contentType!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
