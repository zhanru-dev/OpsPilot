import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AccessTokenPayload, RefreshTokenPayload } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { memberships: { include: { workspace: true }, take: 1 } },
    });

    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Email or password is incorrect.');
    }

    return this.createSession(user);
  }

  async refresh(rawToken: string) {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(rawToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Refresh token is invalid.');
    }

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sessionId },
      include: {
        user: {
          include: { memberships: { include: { workspace: true }, take: 1 } },
        },
      },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !(await argon2.verify(session.refreshTokenHash, rawToken))
    ) {
      throw new UnauthorizedException('Session is no longer active.');
    }

    return this.rotateSession(session.user, session.id);
  }

  async logout(sessionId?: string) {
    if (sessionId) {
      await this.prisma.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  private async createSession(user: UserWithMembership) {
    const sessionId = randomUUID();
    return this.rotateSession(user, sessionId, true);
  }

  private async rotateSession(
    user: UserWithMembership,
    sessionId: string,
    create = false,
  ) {
    const membership = user.memberships[0];
    if (!membership) {
      throw new UnauthorizedException('User does not belong to a workspace.');
    }

    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      sessionId,
      workspaceId: membership.workspaceId,
      email: user.email,
      name: user.name,
      workspaceName: membership.workspace.name,
      role: membership.role,
    };
    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      sessionId,
      type: 'refresh',
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload, {
        secret: this.accessSecret,
        expiresIn: '15m',
      }),
      this.jwt.signAsync(refreshPayload, {
        secret: this.refreshSecret,
        expiresIn: '7d',
      }),
    ]);
    const refreshTokenHash = await argon2.hash(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    if (create) {
      await this.prisma.session.create({
        data: { id: sessionId, userId: user.id, refreshTokenHash, expiresAt },
      });
    } else {
      await this.prisma.session.update({
        where: { id: sessionId },
        data: { refreshTokenHash, expiresAt },
      });
    }

    return {
      accessToken,
      refreshToken,
      user: accessPayload,
    };
  }

  private get accessSecret() {
    return this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  private get refreshSecret() {
    return this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
  }
}

type UserWithMembership = Prisma.UserGetPayload<{
  include: { memberships: { include: { workspace: true } } };
}>;
