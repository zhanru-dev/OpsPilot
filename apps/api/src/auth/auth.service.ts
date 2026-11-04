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
      session.userId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !(await argon2.verify(session.refreshTokenHash, rawToken))
    ) {
      throw new UnauthorizedException('Session is no longer active.');
    }

    return this.rotateSession(
      session.user,
      session.id,
      false,
      session.refreshTokenHash,
    );
  }

  async logout(rawAccessToken?: string) {
    if (rawAccessToken) {
      let identity: AccessTokenPayload;
      try {
        // A removed member or expired access token can still end its own signed
        // session. This route grants no resource access and still checks Origin.
        identity = await this.jwt.verifyAsync<AccessTokenPayload>(
          rawAccessToken,
          { secret: this.accessSecret, ignoreExpiration: true },
        );
        if (!identity.sessionId || !identity.sub) return;
      } catch {
        return;
      }
      await this.prisma.session.updateMany({
        where: {
          id: identity.sessionId,
          userId: identity.sub,
          revokedAt: null,
        },
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
    consumedHash?: string,
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
        jwtid: randomUUID(),
      }),
    ]);
    const refreshTokenHash = await argon2.hash(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    if (create) {
      await this.prisma.session.create({
        data: { id: sessionId, userId: user.id, refreshTokenHash, expiresAt },
      });
    } else {
      // Strict single consumption, including concurrent refresh/logout. A lost
      // rotation response requires a fresh login; never revive a revoked session.
      const consumed = await this.prisma.session.updateMany({
        where: {
          id: sessionId,
          userId: user.id,
          refreshTokenHash: consumedHash,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { refreshTokenHash, expiresAt },
      });
      if (consumed.count !== 1)
        throw new UnauthorizedException(
          'Refresh token was consumed or the session ended.',
        );
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
