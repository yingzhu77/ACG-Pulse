import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import cron from 'node-cron';

import { prisma } from './db.js';
import settingsRouter from './routes/settings.js';
import notificationsRouter from './routes/notifications.js';
import gamePulsePublicRouter from './gamepulse/routes/public.js';
import hotSearchRouter from './gamepulse/routes/hotSearch.js';
import { createAdminRouter } from './gamepulse/routes/admin.js';
import communityRouter from './gamepulse/routes/community.js';
import { startAnalysisQueueWorker } from './gamepulse/ai/analysisQueue.js';
import { runGamePulseCheck, getCheckerStatus } from './gamepulse/jobs/checker.js';
import { scheduledCommunityRefresh } from './gamepulse/services/communityService.js';
import { requestLogger, errorHandler, notFoundHandler } from './gamepulse/routes/middleware.js';
import { requireAdmin } from './gamepulse/auth.js';
import { ensureFTS5, rebuildFTS5 } from './gamepulse/search.js';

dotenv.config();

// ===== Startup validation =====
const startupErrors: string[] = [];

if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'change_me') {
  startupErrors.push('ADMIN_PASSWORD is not set or using default value. Please set a secure password in .env');
}

if (!process.env.ADMIN_JWT_SECRET || process.env.ADMIN_JWT_SECRET.length < 32) {
  startupErrors.push('ADMIN_JWT_SECRET must be set and at least 32 characters. Generate one with: openssl rand -hex 32');
}

if (startupErrors.length > 0) {
  console.error('\n=== STARTUP VALIDATION FAILED ===');
  startupErrors.forEach(e => console.error(`  ❌ ${e}`));
  console.error('\n  Fix the above issues in your .env file and restart.\n');
  process.exit(1);
}

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_URL,
    methods: ['GET', 'POST']
  }
});

// Gzip compression
app.use(compression());

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"]
    }
  }
}));

// CORS — restrict to configured origin
app.use(cors({
  origin: CLIENT_URL,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: false
}));

// Global rate limit: 200 requests per minute per IP
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
}));

app.use(express.json({ limit: '1mb' }));

// 请求日志
app.use(requestLogger);

app.use('/api/public', gamePulsePublicRouter);
app.use('/api/public', hotSearchRouter);
app.use('/api/admin', createAdminRouter(io));
app.use('/api/community', communityRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/notifications', notificationsRouter);

app.get('/api/health', (_req, res) => {
  const checker = getCheckerStatus();
  res.json({
    status: 'ok',
    app: 'game-pulse',
    timestamp: new Date().toISOString(),
    checker: { running: checker.running, startedAt: checker.startedAt }
  });
});

app.post('/api/check-hotspots', requireAdmin, async (_req, res) => {
  try {
    const result = await runGamePulseCheck(io);
    res.json({ message: 'Game Pulse check completed', result });
  } catch (error) {
    console.error('Manual Game Pulse check failed:', error);
    res.status(500).json({ error: 'Failed to run Game Pulse check' });
  }
});

// 静态文件托管（前端）- 自动检测路径
const possiblePaths = [
  path.resolve(process.cwd(), '../client/dist'),
  path.resolve(process.cwd(), '../dist'),
  path.resolve(process.cwd(), 'dist')
];
const clientDistPath = possiblePaths.find(p => fs.existsSync(path.join(p, 'index.html'))) || possiblePaths[0];
app.use(express.static(clientDistPath));

// SPA 回退：非 API 路由返回 index.html
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  } else {
    next();
  }
});

// 404 处理
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// 统一错误处理
app.use(errorHandler);

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('subscribe:games', (games: string[]) => {
    games.forEach(game => socket.join(`game:${game}`));
  });

  socket.on('unsubscribe:games', (games: string[]) => {
    games.forEach(game => socket.leave(`game:${game}`));
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

startAnalysisQueueWorker(io);

cron.schedule('*/30 * * * *', async () => {
  console.log('[GamePulse] Running scheduled check...');
  try {
    const result = await runGamePulseCheck(io);
    console.log('[GamePulse] Scheduled check completed:', result);
  } catch (error) {
    console.error('[GamePulse] Scheduled check failed:', error);
  }
});

// Community data refresh: every 30 minutes, offset by 15 minutes
cron.schedule('15,45 * * * *', async () => {
  try {
    await scheduledCommunityRefresh(io);
  } catch (error) {
    console.error('[Community] Scheduled refresh failed:', error);
  }
});

export { io };

const PORT = process.env.PORT || 3001;

// Initialize FTS5 search index
ensureFTS5().catch(err => {
  console.error('[FTS5] Failed to initialize search index:', err);
});

httpServer.listen(PORT, () => {
  console.log(`
Game Pulse service is running.
Server: http://localhost:${PORT}
Public API: /api/public
Admin API: /api/admin
WebSocket: ready
Scheduled check: every 30 minutes
  `);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});
