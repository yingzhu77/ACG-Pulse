import { publishDailyEdition, shanghaiDate, shiftEditionDate } from '../reports/editorial.js';

export const timeZone = 'Asia/Shanghai';
let running = false;

// Keep automatic catch-up bounded. Dates outside this window can be published explicitly.
export async function retryRecentEditions(now = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const offset of [-3, -2, -1]) {
      const date = shiftEditionDate(shanghaiDate(now), offset);
      try {
        await publishDailyEdition(date, now);
      } catch (error) {
        console.error(`[GamePulse] Daily edition ${date} failed:`, error);
      }
    }
  } finally {
    running = false;
  }
}
