import { Module } from '@nestjs/common';
import { AccessPoliciesController } from './access-policies.controller';

@Module({ controllers: [AccessPoliciesController] })
export class AccessPoliciesModule {}
