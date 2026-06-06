import type { Source } from '@prisma/client';
import type { RawFeedItem, SourceType } from '../types.js';

export interface SourceAdapter {
  type: SourceType;
  fetch(source: Source): Promise<RawFeedItem[]>;
}

export class AdapterError extends Error {
  constructor(message: string, public readonly sourceType: string) {
    super(message);
    this.name = 'AdapterError';
  }
}
