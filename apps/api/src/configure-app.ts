import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import type { Application, NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from './openapi';
import { RequestTraceService } from './common/request-trace.service';
import { isAllowedRequestOrigin } from './config/request-origin';

export function configureApp(app: INestApplication) {
  const config = app.get(ConfigService);
  const trace = app.get(RequestTraceService);

  if (config.getOrThrow<boolean>('TRUST_PROXY')) {
    const express = app.getHttpAdapter().getInstance() as Application;
    express.set('trust proxy', 1);
  }

  const webOrigin = config.getOrThrow<string>('WEB_ORIGIN');
  app.use((request: Request, response: Response, next: NextFunction) => {
    const host = request.get('host');
    const requestOrigin = host ? `${request.protocol}://${host}` : '';
    if (
      isAllowedRequestOrigin(
        request.method,
        request.get('origin'),
        requestOrigin,
        webOrigin,
      )
    ) {
      next();
      return;
    }
    response.status(403).json({
      statusCode: 403,
      message: 'Cross-origin mutation is not allowed.',
      error: 'Forbidden',
    });
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
        },
      },
    }),
  );
  app.use(cookieParser());
  app.use((request: Request, response: Response, next: NextFunction) => {
    const requestId = request.header('x-request-id') ?? randomUUID();
    response.setHeader('x-request-id', requestId);
    trace.run(requestId, next);
  });
  app.enableCors({
    origin: webOrigin,
    credentials: true,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app
    .getHttpAdapter()
    .get('/docs/openapi.json', (_request: Request, response: Response) => {
      response.json(openApiDocument);
    });
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
}
