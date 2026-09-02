import { ContentBlockType } from '@prisma/client';
import { IsBoolean, IsEnum, IsString, MinLength } from 'class-validator';

export class CreateContentBlockDto {
  @IsEnum(ContentBlockType)
  type!: ContentBlockType;

  @IsString()
  @MinLength(2)
  title!: string;

  @IsString()
  @MinLength(5)
  body!: string;

  @IsBoolean()
  isVisible!: boolean;
}
