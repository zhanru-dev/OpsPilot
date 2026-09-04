import { AccessMode } from '@prisma/client';
import { Transform } from 'class-transformer';
import { canonicalDomain } from '../../attendee-access/attendee-eligibility';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsString,
  IsFQDN,
} from 'class-validator';

export class UpsertAccessPolicyDto {
  @IsEnum(AccessMode)
  mode!: AccessMode;

  @IsArray()
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((domain: unknown) =>
          typeof domain === 'string' ? canonicalDomain(domain) : domain,
        )
      : value,
  )
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsFQDN({}, { each: true })
  allowedDomains!: string[];

  @IsBoolean()
  requiresConsent!: boolean;

  @IsBoolean()
  collectCompany!: boolean;

  @IsBoolean()
  collectJobTitle!: boolean;
}
