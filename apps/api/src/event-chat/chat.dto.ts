import { BadRequestException } from '@nestjs/common';
import { Transform, Type, plainToInstance } from 'class-transformer';
import {
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

export class SendChatDto {
  @IsUUID('4') clientMessageId!: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;
}
export class DeleteChatDto {
  @IsUUID() messageId!: string;
}
export class ChatHistoryQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  before?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  after?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 30;
}
export class ChatReplayQuery {
  @Type(() => Number) @IsInt() @Min(0) @Max(2147483647) after!: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  through?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 200;
}
export function parseChatDto<T extends object>(
  type: new () => T,
  input: unknown,
): T {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException('Invalid Chat command.');
  const dto = plainToInstance(type, input);
  if (validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length)
    throw new BadRequestException('Invalid Chat command.');
  return dto;
}
