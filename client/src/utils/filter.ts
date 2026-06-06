export function toggleFilterValue(current: string, value: string, multi: boolean): string {
  if (!multi) return current === value ? '' : value;
  const parts = current ? current.split(',').filter(Boolean) : [];
  const idx = parts.indexOf(value);
  if (idx >= 0) {
    parts.splice(idx, 1);
  } else {
    parts.push(value);
  }
  return parts.join(',');
}

export function hasFilterValue(current: string | string[], value: string): boolean {
  if (Array.isArray(current)) return current.includes(value);
  if (!current) return false;
  return current.split(',').includes(value);
}
