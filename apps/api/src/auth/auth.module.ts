import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { StaffAuthorityService } from './staff-authority.service';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, StaffAuthorityService],
  exports: [AuthService, AuthGuard, StaffAuthorityService, JwtModule],
})
export class AuthModule {}
