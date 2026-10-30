import { IsInt, IsUUID, Max, Min } from 'class-validator';
export class BroadcastVersionDto {
  @IsInt() @Min(0) @Max(2147483647) expectedRevision!: number;
}
export class StartBroadcastDto extends BroadcastVersionDto {
  @IsUUID('4') clientOperationId!: string;
}
