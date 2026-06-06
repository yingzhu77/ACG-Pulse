import type { Source } from '@prisma/client';
import { prisma } from '../db.js';

interface DefaultSourceInput {
  name: string;
  type: string;
  game: string;
  url?: string;
  uid?: string;
  route?: string;
  isOfficial: boolean;
  followed?: boolean;
  priority: number;
  config?: Record<string, unknown>;
}

const MIHOYO_GAMES = [
  { game: '崩坏3', gids: 1 },
  { game: '原神', gids: 2 },
  { game: '崩坏：星穹铁道', gids: 6 },
  { game: '绝区零', gids: 8 }
];

const MIHOYO_TYPES = [
  { label: '公告', type: 1 },
  { label: '活动', type: 2 },
  { label: '资讯', type: 3 }
];

const BILIBILI_OFFICIALS: DefaultSourceInput[] = [
  { name: '原神', game: '原神', uid: '401742377', type: 'bilibili_video', isOfficial: true, priority: 20 },
  { name: '崩坏：星穹铁道', game: '崩坏：星穹铁道', uid: '1340190821', type: 'bilibili_video', isOfficial: true, priority: 20 },
  { name: '崩坏3第一偶像爱酱', game: '崩坏3', uid: '27534330', type: 'bilibili_video', isOfficial: true, priority: 20 },
  { name: '绝区零', game: '绝区零', uid: '1636034895', type: 'bilibili_video', isOfficial: true, priority: 20 },
  { name: '鸣潮', game: '鸣潮', uid: '1955897084', type: 'bilibili_video', isOfficial: true, priority: 20 },
  { name: '明日方舟', game: '明日方舟', uid: '161775300', type: 'bilibili_video', isOfficial: true, priority: 20 },
  { name: '明日方舟终末地', game: '明日方舟：终末地', uid: '1265652806', type: 'bilibili_video', isOfficial: true, priority: 20 },
  { name: '异环', game: '异环', uid: '3546636978489848', type: 'bilibili_video', isOfficial: true, priority: 20 }
];

interface FollowedUpInput {
  name: string;
  uid: string;
}

const FOLLOWED_UPS: FollowedUpInput[] = [
  { name: 'IGN中国', uid: '652239032' },
  { name: '乌鸦预告片', uid: '8465957' },
  { name: '夏日幻听MCE', uid: '224267770' },
  { name: 'aki惊蛰', uid: '15319615' }
];

export async function seedDefaultSources(): Promise<Source[]> {
  const inputs: DefaultSourceInput[] = [
    ...MIHOYO_GAMES.flatMap(game =>
      MIHOYO_TYPES.map(type => ({
        name: `米游社-${game.game}-${type.label}`,
        type: 'rsshub',
        game: game.game,
        route: `/mihoyo/bbs/official/${game.gids}/${type.type}/20`,
        isOfficial: true,
        priority: 10,
        config: { itemKind: 'official_post' }
      }))
    ),
    ...BILIBILI_OFFICIALS.map(source => ({
      ...source,
      url: `https://space.bilibili.com/${source.uid}`,
      config: {
        itemKind: 'official_post',
        rssHubRoutes: [
          `/bilibili/user/video/${source.uid}`
        ]
      }
    })),
    ...FOLLOWED_UPS.map(source => ({
      name: source.name,
      game: '',
      type: 'bilibili_video' as const,
      uid: source.uid,
      url: `https://space.bilibili.com/${source.uid}`,
      isOfficial: false,
      followed: true,
      priority: 60,
      config: { itemKind: 'creator_video', rssHubRoutes: [`/bilibili/user/video/${source.uid}`] }
    }))
  ];

  const created: Source[] = [];
  for (const input of inputs) {
    const existing = await prisma.source.findFirst({
      where: {
        type: input.type,
        game: input.game,
        OR: [
          ...(input.uid ? [{ uid: input.uid }] : []),
          ...(input.route ? [{ route: input.route }] : []),
          ...(input.url ? [{ url: input.url }] : [])
        ]
      }
    });
    if (existing) {
      created.push(await prisma.source.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          url: input.url || null,
          uid: input.uid || null,
          route: input.route || null,
          config: input.config ? JSON.stringify(input.config) : null,
          isOfficial: input.isOfficial,
          followed: input.followed ?? false,
          priority: input.priority,
          enabled: true
        }
      }));
      continue;
    }

    created.push(await prisma.source.create({
      data: {
        name: input.name,
        type: input.type,
        game: input.game,
        url: input.url || null,
        uid: input.uid || null,
        route: input.route || null,
        config: input.config ? JSON.stringify(input.config) : null,
        isOfficial: input.isOfficial,
        followed: input.followed ?? false,
        priority: input.priority
      }
    }));
  }

  return created;
}
