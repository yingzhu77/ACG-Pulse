const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

export function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/** Drain an in-flight batch before reporting its errors, so a failed refresh leaves no requests behind. */
export async function settleCommunityRequests<T>(requests: Promise<T>[], label: string): Promise<T[]> {
  const results = await Promise.allSettled(requests);
  const failed = results.filter(result => result.status === 'rejected');
  if (failed.length) {
    const errors = failed.map(result => result.reason);
    throw new AggregateError(errors, `${label}: ${errors.map(error => error instanceof Error ? error.message : String(error)).join(' | ')}`);
  }
  return results.map(result => (result as PromiseFulfilledResult<T>).value);
}

/** Keep structurally valid items from an otherwise successful response; fail only when nothing usable remains. */
export function filterValidItems<T>(items: T[], isValid: (item: T) => boolean, label: string): T[] {
  const valid = items.filter(isValid);
  const dropped = items.length - valid.length;
  if (dropped > 0) {
    console.warn(`[Community] ${label}: ignored ${dropped} invalid item(s)`);
  }
  if (items.length > 0 && valid.length === 0) {
    throw new Error(`${label} contains no valid items`);
  }
  return valid;
}
