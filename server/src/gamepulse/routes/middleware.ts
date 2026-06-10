import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';

/**
 * 请求日志中间件
 */
export function requestLogger(req: Request, _res: Response, next: NextFunction): void {
  const timestamp = new Date().toISOString();
  const method = req.method;
  const url = req.originalUrl;
  const ip = req.ip || req.socket.remoteAddress || 'unknown';

  console.log(`[${timestamp}] ${method} ${url} - ${ip}`);
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
