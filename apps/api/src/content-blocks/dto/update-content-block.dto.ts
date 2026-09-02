import { PartialType } from '@nestjs/mapped-types';
import { CreateContentBlockDto } from './create-content-block.dto';

export class UpdateContentBlockDto extends PartialType(CreateContentBlockDto) {}
