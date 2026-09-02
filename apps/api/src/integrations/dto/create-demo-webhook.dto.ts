import { IsIn, IsString, MaxLength } from 'class-validator';

export const demoWebhookModes = ['SUCCESS', 'FAIL_ONCE'] as const;
export type DemoWebhookMode = (typeof demoWebhookModes)[number];

export class CreateDemoWebhookDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsIn(demoWebhookModes)
  mode!: DemoWebhookMode;
}
