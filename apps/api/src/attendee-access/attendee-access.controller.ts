import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { AttendeeAccessService } from './attendee-access.service';
import { attendeeSessionLifetime } from './attendee-token.service';
import {
  ResendVerificationDto,
  VerifyAttendeeDto,
} from './dto/attendee-access.dto';

@Public()
@Controller('public/events/:eventId/attendee')
export class AttendeeAccessController {
  constructor(
    private readonly access: AttendeeAccessService,
    private readonly config: ConfigService,
  ) {}

  @Post('resend')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  resend(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: ResendVerificationDto,
  ) {
    return this.access.resend(eventId, dto.email);
  }

  @Post('verify')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verify(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: VerifyAttendeeDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.access.verify(eventId, dto.token, dto.consent);
    response.cookie('opspilot_attendee', session.sessionToken, {
      ...this.cookieOptions(eventId),
      maxAge: attendeeSessionLifetime,
    });
    return { status: 'VERIFIED', eventId, expiresAt: session.expiresAt };
  }

  @Get('session')
  @Header('Cache-Control', 'no-store')
  session(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() request: Request,
  ) {
    return this.access.session(eventId, this.cookie(request));
  }

  @Post('logout')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async logout(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.access.logout(eventId, this.cookie(request));
    response.clearCookie('opspilot_attendee', this.cookieOptions(eventId));
  }

  private cookie(request: Request): string | undefined {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    return typeof cookies?.opspilot_attendee === 'string'
      ? cookies.opspilot_attendee
      : undefined;
  }

  private cookieOptions(eventId: string): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.getOrThrow<boolean>('COOKIE_SECURE'),
      sameSite: this.config.getOrThrow<'lax' | 'strict' | 'none'>(
        'COOKIE_SAME_SITE',
      ),
      path: `/api/v1/public/events/${eventId}`,
    };
  }
}
