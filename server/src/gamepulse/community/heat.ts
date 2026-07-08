interface HeatCandidate {
  source: string;
  heatScore: number;
  rawHeatScore: number;
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

export function calculateXiaoheiheHeat(item: {
  modify_at?: number;
  comment_num?: number;
  link_award_num?: number;
  forward_num?: number;
  down?: number;
  topics?: Array<{ hot_value_v2?: number }>;
}): number {
  const timestamp = (item.modify_at || 0) > 0 ? item.modify_at! : Date.now() / 1000;
  const ageHours = Math.max(0.1, (Date.now() / 1000 - timestamp) / 3600);
  const decay = Math.pow(0.5, ageHours / 36);
  const capLogScore = (value: number | undefined, maxScore: number, softCap: number) => (
    Math.min(maxScore, (Math.log1p(Math.max(0, value || 0)) / Math.log1p(softCap)) * maxScore)
  );
  const topicHot = Math.max(0, ...(item.topics || []).map(topic => topic.hot_value_v2 || 0));

  const commentScore = capLogScore(item.comment_num, 38, 300);
  const awardScore = capLogScore(item.link_award_num, 32, 120);
  const forwardScore = capLogScore(item.forward_num, 10, 80);
  const topicScore = capLogScore(topicHot, 12, 100_000);
  const freshBoost = Math.min(8, 8 * Math.pow(0.5, ageHours / 12));
  const downPenalty = capLogScore(item.down, 12, 500);
  const score = commentScore + awardScore + forwardScore + topicScore + freshBoost - downPenalty;

  return Math.max(0, score * decay);
}

export function normalizeHeatBySource<T extends HeatCandidate>(topics: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const topic of topics) {
    const group = groups.get(topic.source) || [];
    group.push(topic);
    groups.set(topic.source, group);
  }

  for (const group of groups.values()) {
    const sortedScores = group.map(topic => topic.rawHeatScore).sort((a, b) => a - b);
    const rankTotals = new Map<number, { total: number; count: number }>();
    sortedScores.forEach((score, index) => {
      const ranks = rankTotals.get(score) || { total: 0, count: 0 };
      ranks.total += index;
      ranks.count++;
      rankTotals.set(score, ranks);
    });
    for (const topic of group) {
      const ranks = rankTotals.get(topic.rawHeatScore)!;
      const averageRank = ranks.total / ranks.count;
      const percentile = sortedScores.length === 1 ? 0.5 : averageRank / (sortedScores.length - 1);
      const normalized = Math.round(10 + percentile * 90);
      topic.heatScore = normalized;
    }
  }
  return topics;
}
