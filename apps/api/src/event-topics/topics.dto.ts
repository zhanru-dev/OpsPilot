import { BadRequestException } from '@nestjs/common';
import { Transform, Type, plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';
import type { TopicFilter } from '@opspilot/topics-contracts';
export class TopicTextDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;
}
export class CreateTopicDto extends TopicTextDto {
  @IsUUID('4') clientOperationId!: string;
}
export class TopicVersionDto {
  @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
}
export class EditTopicDto extends TopicTextDto {
  @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
}
export class PinTopicDto extends TopicVersionDto {
  @IsBoolean() pinned!: boolean;
}
export class TopicSettingsDto {
  @IsBoolean() audiencePublishing!: boolean;
  @IsBoolean() audienceReplies!: boolean;
  @IsBoolean() moderationRequired!: boolean;
  @IsInt() @Min(0) @Max(2147483647) expectedRevision!: number;
}
export class TopicQuery {
  @IsOptional()
  @IsIn(['all', 'approved', 'pending', 'pinned'])
  filter: TopicFilter = 'all';
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  before?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
}
export function parseTopicDto<T extends object>(
  type: new () => T,
  input: unknown,
): T {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException('Invalid Topics request.');
  const result = plainToInstance(type, input);
  if (
    validateSync(result, { whitelist: true, forbidNonWhitelisted: true }).length
  )
    throw new BadRequestException('Invalid Topics request.');
  return result;
}
