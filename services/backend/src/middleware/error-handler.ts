import type { Request, Response, NextFunction } from 'express';
import { logger } from '../telemetry/logger';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const requestId = req.headers['x-request-id'] as string;

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.issues,
      requestId,
    });
  }

  if (err instanceof AppError) {
    logger.warn({ err, requestId }, 'AppError');
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      requestId,
    });
  }

  // Unexpected errors — don't leak internals
  logger.error({ err, requestId, path: req.path }, 'Unhandled error');
  res.status(500).json({
    error: 'Internal server error',
    requestId,
  });
}
