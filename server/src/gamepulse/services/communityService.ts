/**
 * Community data refresh service.
 * Shared between route handler (lazy) and cron job (scheduled).
 */

import type { Server } from 'socket.io';
import { aggregateCommunityTopicsWithStatus } from '../adapters/community.js';
import { COMMUNITY_REFRESH_INTERVAL_MS, type CommunityTopic, type ExistingCommunityTopic } from '../community/types.js';
import { loadAllTopics, persistCommunityRefresh, cleanupStale } from '../db/communityDb.js';

// Concurrency lock to prevent parallel fetches
let fetchPromise: Promise<CommunityTopic[]> | null = null;
let lastFailedRefreshAt: number | null = null;

/** A failed persistence attempt cannot save checkedAt; keep its lazy-refresh cooldown in memory. */
export function isCommunityRefreshCoolingDown(): boolean {
  return lastFailedRefreshAt !== null && Date.now() - lastFailedRefreshAt < COMMUNITY_REFRESH_INTERVAL_MS;
}

/** Fetch from adapters (incremental) and persist to DB. Thread-safe. */
export async function refreshCommunityData(): Promise<CommunityTopic[]> {
  if (fetchPromise) return fetchPromise;

  fetchPromise = doRefresh()
    .then(topics => {
      lastFailedRefreshAt = null;
      return topics;
    })
    .catch(error => {
      lastFailedRefreshAt = Date.now();
      throw error;
    })
    .finally(() => { fetchPromise = null; });
  return fetchPromise;
}

async function doRefresh(): Promise<CommunityTopic[]> {
  // Get IDs of existing topics for incremental update
  const allTopics = await loadAllTopics();
  const existingTopics = new Map<string, ExistingCommunityTopic>(
    allTopics.map(topic => [topic.id, {
      sentiment: topic.sentiment,
      sentimentScore: topic.sentimentScore,
      sentimentStatus: topic.sentimentStatus,
      sentimentMethod: topic.sentimentMethod,
      sentimentConfidence: topic.sentimentConfidence,
      sentimentVersion: topic.sentimentVersion,
      sentimentAnalyzedAt: topic.sentimentAnalyzedAt
    }])
  );

  // Fetch with incremental optimization (skip AI for existing topics)
  const { topics, sources } = await aggregateCommunityTopicsWithStatus({ existingTopics });

  // Upsert: new topics get inserted, existing ones get trend merged
  await persistCommunityRefresh(topics, sources);
  const usableSources = sources.filter(source => source.status !== 'failed');
  if (!usableSources.length) {
    throw new Error(`All community sources failed: ${sources.map(source => `${source.source}: ${source.error}`).join(' | ')}`);
  }

  // A degraded source may be missing topics because part of it failed; only clean fully successful sources.
  const successfulSources = sources.filter(source => source.status === 'healthy').map(source => source.source);
  const cleaned = successfulSources.length ? await cleanupStale(48, successfulSources) : 0;
  if (cleaned > 0) console.log(`[Community] Cleaned ${cleaned} stale topics`);

  return topics;
}

/** Scheduled refresh with WebSocket notification */
export async function scheduledCommunityRefresh(io: Server): Promise<void> {
  console.log('[Community] Running scheduled refresh...');
  try {
    const topics = await refreshCommunityData();
    io.emit('community:update', {
      totalTopics: topics.length,
      timestamp: new Date().toISOString()
    });
    console.log(`[Community] Scheduled refresh completed: ${topics.length} topics`);
  } catch (error) {
    console.error('[Community] Scheduled refresh failed:', error);
  }
}
