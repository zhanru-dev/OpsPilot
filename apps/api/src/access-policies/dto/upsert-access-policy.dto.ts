import { AccessMode } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsString,
  Matches,
} from 'class-validator';

export class UpsertAccessPolicyDto {
  @IsEnum(AccessMode)
  mode!: AccessMode;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^[a-z0-9.-]+\.[a-z]{2,}$/i, { each: true })
  allowedDomains!: string[];

  @IsBoolean()
  requiresConsent!: boolean;

  @IsBoolean()
  collectCompany!: boolean;

  @IsBoolean()
  collectJobTitle!: boolean;
}
