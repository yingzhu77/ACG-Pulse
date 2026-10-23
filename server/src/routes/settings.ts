import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAdmin } from '../gamepulse/auth.js';
import { EDITABLE_SETTING_KEYS, isEditableSettingKey, UpdateSettingsSchema } from '../gamepulse/validation.js';

const router = Router();
router.use(requireAdmin);

// 获取所有设置
router.get('/', async (req, res) => {
  try {
    const settings = await prisma.setting.findMany({
      where: { key: { in: [...EDITABLE_SETTING_KEYS] } }
    });
    const settingsMap = settings.reduce((acc: Record<string, string>, item: { key: string; value: string }) => {
      acc[item.key] = item.value;
      return acc;
    }, {} as Record<string, string>);

    res.json(settingsMap);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// 更新设置
router.put('/', async (req, res) => {
  try {
    const parsed = UpdateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid settings format or unsupported key' });
    }

    const updates = Object.entries(parsed.data).map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value }
      })
    );

    await Promise.all(updates);

    res.json({ message: 'Settings updated' });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// 获取单个设置
router.get('/:key', async (req, res) => {
  try {
    if (!isEditableSettingKey(req.params.key)) {
      return res.status(404).json({ error: 'Setting not found' });
    }

    const setting = await prisma.setting.findUnique({
      where: { key: req.params.key }
    });

    if (!setting) {
      return res.status(404).json({ error: 'Setting not found' });
    }

    res.json({ key: setting.key, value: setting.value });
  } catch (error) {
    console.error('Error fetching setting:', error);
    res.status(500).json({ error: 'Failed to fetch setting' });
  }
});

// 更新单个设置
router.put('/:key', async (req, res) => {
  try {
    if (!isEditableSettingKey(req.params.key)) {
      return res.status(404).json({ error: 'Setting not found' });
    }

    const { value } = req.body;

    if (typeof value !== 'string') {
      return res.status(400).json({ error: 'Value must be a string' });
    }

    const setting = await prisma.setting.upsert({
      where: { key: req.params.key },
      update: { value: String(value) },
      create: { key: req.params.key, value: String(value) }
    });

    res.json(setting);
  } catch (error) {
    console.error('Error updating setting:', error);
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

export default router;
