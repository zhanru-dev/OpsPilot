import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../common/request-context';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.login(dto.email, dto.password);
    this.setCookies(response, session.accessToken, session.refreshToken);
    return { user: this.publicUser(session.user) };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = request.cookies?.opspilot_refresh as string | undefined;
    if (!token) throw new UnauthorizedException('Refresh token is missing.');
    const session = await this.auth.refresh(token);
    this.setCookies(response, session.accessToken, session.refreshToken);
    return { user: this.publicUser(session.user) };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(user.sessionId);
    response.clearCookie('opspilot_access', this.cookieOptions('/'));
    response.clearCookie(
      'opspilot_refresh',
      this.cookieOptions('/api/v1/auth'),
    );
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return { user: this.publicUser(user) };
  }

  private setCookies(
    response: Response,
    accessToken: string,
    refreshToken: string,
  ) {
    response.cookie('opspilot_access', accessToken, {
      ...this.cookieOptions('/'),
      maxAge: 15 * 60 * 1000,
    });
    response.cookie('opspilot_refresh', refreshToken, {
      ...this.cookieOptions('/api/v1/auth'),
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  private cookieOptions(path: string): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.getOrThrow<boolean>('COOKIE_SECURE'),
      sameSite: this.config.getOrThrow<'lax' | 'strict' | 'none'>(
        'COOKIE_SAME_SITE',
      ),
      path,
    };
  }

  private publicUser(
    user: Omit<AuthenticatedUser, 'id'> & { sub?: string; id?: string },
  ) {
    return {
      id: user.id ?? user.sub,
      email: user.email,
      name: user.name,
      workspaceId: user.workspaceId,
      workspaceName: user.workspaceName,
      role: user.role,
    };
  }
}
