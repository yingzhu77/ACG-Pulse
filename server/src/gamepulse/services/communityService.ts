/**
 * Community data refresh service.
 * Shared between route handler (lazy) and cron job (scheduled).
 */

import type { Server } from 'socket.io';
import { aggregateCommunityTopics } from '../adapters/community.js';
import type { CommunityTopic, ExistingCommunityTopic } from '../community/types.js';
import { loadAllTopics, upsertTopics, cleanupStale } from '../db/communityDb.js';

// Concurrency lock to prevent parallel fetches
let fetchPromise: Promise<CommunityTopic[]> | null = null;

/** Fetch from adapters (incremental) and persist to DB. Thread-safe. */
export async function refreshCommunityData(): Promise<CommunityTopic[]> {
  if (fetchPromise) return fetchPromise;

  fetchPromise = doRefresh().finally(() => { fetchPromise = null; });
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
  const topics = await aggregateCommunityTopics({ existingTopics });

  // Upsert: new topics get inserted, existing ones get trend merged
  await upsertTopics(topics);

  // Cleanup stale topics not seen in 48h
  const cleaned = await cleanupStale(48);
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
