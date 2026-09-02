import { RunbookStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateRunbookItemDto {
  @IsEnum(RunbookStatus)
  status!: RunbookStatus;
}
