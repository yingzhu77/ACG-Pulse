import { Router } from 'express';
import storiesRouter from './stories.js';
import sourcesRouter from './sources.js';
import statsRouter from './stats.js';

const router = Router();

// 挂载子路由
router.use('/', storiesRouter);
router.use('/', sourcesRouter);
router.use('/', statsRouter);

export default router;
