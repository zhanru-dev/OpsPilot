import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class CreateEventDto {
  @IsString()
  @MinLength(3)
  title!: string;

  @IsString()
  @MinLength(10)
  description!: string;

  @IsDateString()
  scheduledStart!: string;

  @IsDateString()
  scheduledEnd!: string;

  @IsString()
  timezone!: string;

  @IsInt()
  @Min(0)
  @Max(1000000)
  expectedAttendees!: number;

  @IsOptional()
  @IsUUID()
  ownerId?: string;
}
