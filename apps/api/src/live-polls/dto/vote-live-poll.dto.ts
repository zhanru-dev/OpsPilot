import { IsUUID } from 'class-validator';

export class VoteLivePollDto {
  @IsUUID()
  optionId!: string;
}
