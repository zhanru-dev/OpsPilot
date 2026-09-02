import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateClientErrorReportDto {
  @IsString()
  @MaxLength(500)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(8_000)
  stack?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  path?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
