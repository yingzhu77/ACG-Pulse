import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { getApiMetricsConfig } from '../config.js';
import { normalizeApiRoute, recordApiRequest } from '../observability/apiMetrics.js';

/**
 * 请求日志中间件
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  res.once('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const route = normalizeApiRoute(req.originalUrl);
    recordApiRequest({ timestamp: Date.now(), route, durationMs, statusCode: res.statusCode });
    const message = `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(1)}ms - ${req.ip || req.socket.remoteAddress || 'unknown'}`;
    if (durationMs >= getApiMetricsConfig().slowRequestMs) console.warn(`[SlowRequest] ${message}`);
    else console.log(message);
  });
  next();
}

/**
 * 统一错误处理中间件
 */
export const errorHandler: ErrorRequestHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (process.env.NODE_ENV === 'development') {
    console.error(`[Error] ${err.message}`, err.stack);
  } else {
    console.error(`[Error] ${err.message}`);
  }

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
};

/**
 * 404 处理中间件
 */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}
