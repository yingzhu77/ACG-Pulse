import { normalizeImportance } from '../storyAggregation.js';
import type { PrismaWhereClause } from '../types.js';

/**
 * 将查询参数转换为字符串数组
 */
export function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const s = value ? String(value).trim() : '';
  return s ? [s] : [];
}

/**
 * 追加 AND 条件到 where 对象（mutates the object for Prisma compatibility）
 */
export function appendAnd(where: PrismaWhereClause, condition: PrismaWhereClause): void {
  where.AND = [...(where.AND || []), condition];
}

/**
 * 合并 AND 条件返回新对象
 */
export function andWhere(base: PrismaWhereClause, condition: PrismaWhereClause): PrismaWhereClause {
  return {
    ...base,
    AND: [...(base.AND || []), condition]
  };
}

/**
 * 获取公开可见性条件
 */
export function publicVisibilityRelationWhere(): PrismaWhereClause {
  return {
    OR: [
      { analysis: null },
      { analysis: { is: { visibility: 'public' } } }
    ]
  };
}

/**
 * 获取公开或静音可见性条件
 */
export function publicOrMutedVisibilityWhere(analysis: PrismaWhereClause = {}): PrismaWhereClause {
  return {
    OR: [
      ...(Object.keys(analysis).length === 0 ? [{ analysis: null }] : []),
      {
        analysis: {
          is: {
            ...analysis,
            visibility: { in: ['public', 'muted'] }
          }
        }
      }
    ]
  };
}

/**
 * 获取公开可见性过滤条件（包含低价值排除）
 */
export function publicVisibilityWhere(): PrismaWhereClause {
  return andWhere(andWhere({ hidden: false }, publicVisibilityRelationWhere()), lowValueNoticeExclusionWhere());
}

/**
 * 低价值通知排除短语列表
 */
export const LOW_VALUE_NOTICE_PHRASES = [
  '封禁名单',
  '封号名单',
  '处罚名单',
  '处罚公示',
  '违规账号',
  '外挂封禁',
  '作弊处罚',
  '账号处罚',
  '名单公示',
  '举报处理',
  '外挂处理',
  '违规处理'
];

/**
 * 获取低价值通知排除条件
 */
export function lowValueNoticeExclusionWhere(): PrismaWhereClause {
  const phraseConditions = LOW_VALUE_NOTICE_PHRASES.flatMap(phrase => [
    { title: { contains: phrase } },
    { content: { contains: phrase } }
  ]);

  return {
    NOT: {
      OR: [
        { analysis: { is: { category: 'enforcement' } } },
        ...phraseConditions
      ]
    }
  };
}

/**
 * 应用低价值通知过滤
 */
export function applyLowValueNoticeFilter(where: PrismaWhereClause, visibility?: unknown): void {
  const visibilityFilter = visibility ? String(visibility) : '';
  if (visibilityFilter === 'muted' || visibilityFilter === 'all') return;
  appendAnd(where, lowValueNoticeExclusionWhere());
}

/** Analysis filter fields. */
interface AnalysisFilters {
  category?: unknown;
  importance?: unknown;
  visibility?: unknown;
}

/**
 * 应用分析过滤条件
 */
export function applyAnalysisFilters(
  where: PrismaWhereClause,
  filters: AnalysisFilters
): void {
  const analysis: PrismaWhereClause = {};
  const category = filters.category ? String(filters.category) : '';
  const importance = filters.importance ? String(filters.importance) : '';
  const visibility = filters.visibility ? String(filters.visibility) : '';

  if (category) analysis.category = category;
  if (importance) {
    analysis.importance = normalizeImportance(importance) === 'high' ? { in: ['high', 'urgent'] } : normalizeImportance(importance);
  }

  if (visibility === 'muted') {
    analysis.visibility = 'muted';
    appendAnd(where, { analysis: { is: analysis } });
    return;
  }

  if (visibility === 'all') {
    appendAnd(where, publicOrMutedVisibilityWhere(analysis));
    return;
  }

  analysis.visibility = 'public';
  if (Object.keys(analysis).length > 1 || category || importance) {
    appendAnd(where, { analysis: { is: analysis } });
    return;
  }

  appendAnd(where, publicVisibilityRelationWhere());
}
