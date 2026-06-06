import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
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
import { runGamePulseCheck } from './gamepulse/jobs/checker.js';
import { requestLogger, errorHandler, notFoundHandler } from './gamepulse/routes/middleware.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  }
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// 请求日志
app.use(requestLogger);

app.use('/api/public', gamePulsePublicRouter);
app.use('/api/public', hotSearchRouter);
app.use('/api/admin', createAdminRouter(io));
app.use('/api/settings', settingsRouter);
app.use('/api/notifications', notificationsRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: 'game-pulse', timestamp: new Date().toISOString() });
});

app.post('/api/check-hotspots', async (_req, res) => {
  try {
    const result = await runGamePulseCheck(io);
    res.json({ message: 'Game Pulse check completed', result });
  } catch (error) {
    console.error('Manual Game Pulse check failed:', error);
    res.status(500).json({ error: 'Failed to run Game Pulse check' });
  }
});

// 静态文件托管（前端）
const clientDistPath = path.resolve(process.cwd(), '../client/dist');
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

cron.schedule('*/30 * * * *', async () => {
  console.log('[GamePulse] Running scheduled check...');
  try {
    const result = await runGamePulseCheck(io);
    console.log('[GamePulse] Scheduled check completed:', result);
  } catch (error) {
    console.error('[GamePulse] Scheduled check failed:', error);
  }
});

export { io };

const PORT = process.env.PORT || 3001;

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
