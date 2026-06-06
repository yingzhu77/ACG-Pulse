import { categories } from '../constants';

export function categoriesLabel(value: string): string {
  return categories[value] || value || '其他';
}

export function importanceLabel(value: string): string {
  return ({ high: '高', medium: '中', low: '低' } as Record<string, string>)[value] || value;
}

export function importanceShort(value: string): string {
  return ({ high: '高', medium: '中', low: '低' } as Record<string, string>)[value] || value;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

export function formatClock(value: string | null | undefined): string {
  if (!value) return '--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}
