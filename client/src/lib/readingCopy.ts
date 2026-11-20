function condensed(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function pairs(text: string): Set<string> {
  const chars = [...text];
  return new Set(chars.slice(1).map((char, index) => chars[index] + char));
}

/** A short repeated headline/summary or a bare recommendation adds no reading value. */
export function distinctImpact(impact: string | null, summary: string | null, title: string): string | null {
  const value = impact?.trim();
  if (!value) return null;
  const candidate = condensed(value);
  if (!candidate || /^(?:重要消息|重要性较高|重要性高|值得关注|建议关注|玩家值得关注|值得一看|请关注|建议查看原文)$/.test(candidate)) return null;
  const original = condensed([title, summary ?? ''].join(' '));
  if (original.includes(candidate)) return null;
  const impactPairs = pairs(candidate);
  const originalPairs = pairs(original);
  const repeated = [...impactPairs].filter(pair => originalPairs.has(pair)).length;
  if (impactPairs.size >= 6 && repeated / impactPairs.size >= .86) return null;
  return value;
}
