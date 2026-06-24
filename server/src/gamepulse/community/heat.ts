interface HeatCandidate {
  source: string;
  heatScore: number;
  trend: number[];
}

export function calculateBilibiliHeat(
  stats: { view?: number; like?: number; reply?: number },
  publishedAt: number
): number {
  const ageHours = Math.max(0.1, (Date.now() / 1000 - publishedAt) / 3600);
  const decay = Math.pow(0.5, ageHours / 24);
  const viewScore = Math.min(40, ((stats.view || 0) / 500_000) * 40);
  const likeScore = Math.min(30, ((stats.like || 0) / 50_000) * 30);
  const replyScore = Math.min(30, ((stats.reply || 0) / 5_000) * 30);
  return Math.max(0, (viewScore + likeScore + replyScore) * decay);
}

export function calculateNgaHeat(post: { replies: number; postdate: number }): number {
  const ageHours = Math.max(0.1, (Date.now() / 1000 - post.postdate) / 3600);
  const decay = Math.pow(0.5, ageHours / 24);
  const replyScore = Math.min(80, ((post.replies || 0) / 50) * 80);
  const recencyBoost = ageHours < 6 ? 20 : ageHours < 24 ? 10 : 0;
  return Math.max(0, (replyScore + recencyBoost) * decay);
}

export function calculateXiaoheiheHeat(modifiedAt: number): number {
  const timestamp = modifiedAt > 0 ? modifiedAt : Date.now() / 1000;
  const ageHours = Math.max(0.1, (Date.now() / 1000 - timestamp) / 3600);
  return 100 * Math.pow(0.5, ageHours / 36);
}

export function normalizeHeatBySource<T extends HeatCandidate>(topics: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const topic of topics) {
    const group = groups.get(topic.source) || [];
    group.push(topic);
    groups.set(topic.source, group);
  }

  for (const group of groups.values()) {
    const sortedScores = group.map(topic => topic.heatScore).sort((a, b) => a - b);
    const rankTotals = new Map<number, { total: number; count: number }>();
    sortedScores.forEach((score, index) => {
      const ranks = rankTotals.get(score) || { total: 0, count: 0 };
      ranks.total += index;
      ranks.count++;
      rankTotals.set(score, ranks);
    });
    for (const topic of group) {
      const ranks = rankTotals.get(topic.heatScore)!;
      const averageRank = ranks.total / ranks.count;
      const percentile = sortedScores.length === 1 ? 0.5 : averageRank / (sortedScores.length - 1);
      const normalized = Math.round(10 + percentile * 90);
      topic.heatScore = normalized;
      topic.trend = [normalized];
    }
  }
  return topics;
}
