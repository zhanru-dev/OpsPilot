import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';
import { CreateMediaUploadDto } from './create-media-upload.dto';
export class MultipartUploadDto extends CreateMediaUploadDto {
  @IsUUID('4') clientOperationId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^[a-f0-9]{64}$/, { each: true })
  hashes!: string[];
}
