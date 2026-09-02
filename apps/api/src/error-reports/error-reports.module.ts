import { Module } from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter';
import { ErrorReportsController } from './error-reports.controller';
import { ErrorReportsService } from './error-reports.service';

@Module({
  controllers: [ErrorReportsController],
  providers: [ErrorReportsService, ApiExceptionFilter],
  exports: [ErrorReportsService, ApiExceptionFilter],
})
export class ErrorReportsModule {}
