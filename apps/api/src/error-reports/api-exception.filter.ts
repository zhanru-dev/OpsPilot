import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ErrorReportSeverity, ErrorReportSource } from '@prisma/client';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../common/request-context';
import { RequestTraceService } from '../common/request-trace.service';
import { ErrorReportsService } from './error-reports.service';

type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly errors: ErrorReportsService,
    private readonly trace: RequestTraceService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<AuthenticatedRequest>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= 500 && request.user?.workspaceId) {
      const error =
        exception instanceof Error ? exception : new Error('Unknown API error');
      void this.errors
        .capture({
          workspaceId: request.user.workspaceId,
          userId: request.user.id,
          source: ErrorReportSource.API,
          severity: ErrorReportSeverity.ERROR,
          message: error.message,
          stack: error.stack,
          path: request.originalUrl,
          metadata: { method: request.method, status },
        })
        .catch(() => undefined);
    }

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      response
        .status(status)
        .json(
          typeof body === 'string'
            ? { statusCode: status, message: body }
            : body,
        );
      return;
    }
    response.status(status).json({
      statusCode: status,
      message: 'An unexpected server error occurred.',
      requestId: this.trace.current(),
    });
  }
}
