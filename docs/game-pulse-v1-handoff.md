# Game Pulse v1 Handoff

Last updated: 2026-06-03 02:35 Asia/Shanghai

## Current Status

- Project path: `D:\111222333\personal-hot-monitor`
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`
- Local RSSHub: `http://127.0.0.1:1200`
- Admin password in local `server/.env`: （见 .env 文件）

## Design Assets

Frontend design references and backgrounds are saved under:

```text
D:\111222333\personal-hot-monitor\client\public\game-pulse\reference
```

- `dashboard-light-reference.png`
- `dashboard-dark-reference.png`
- `background-light.png`
- `background-dark.png`

Chinese frontend and launch plan:

```text
D:\111222333\personal-hot-monitor\docs\game-pulse-frontend-and-launch-plan.zh.md
```

## Verified

- Docker Desktop is running.
- RSSHub container is running via:
  ```powershell
  docker compose -f D:\111222333\personal-hot-monitor\docker-compose.rsshub.yml up -d
  ```
- RSSHub now uses the project custom image `game-pulse-rsshub:latest`.
- RSSHub Playwright system dependencies are baked into `docker/Dockerfile.rsshub`.
- RSSHub browser cache is persisted in the Docker volume `rsshub-playwright-cache`.
- Backend build passes:
  ```powershell
  npm.cmd run build
  ```
- Manual backend sync now succeeds for enabled sources:
  ```json
  {
    "checkedSources": 12,
    "newItems": 0,
  "failedSources": 0
  }
  ```

## Important Fixes Already Made

- Existing sources in SQLite were previously all `enabled: false`; they were updated.
- Bilibili sources are currently disabled because anonymous RSSHub/API requests are blocked.
- RSSHub fallback now respects configured `RSSHUB_BASE_URLS`; it no longer appends `https://rsshub.app` when local config exists.
- RSSHub "this route is empty" responses are treated as `[]` instead of source failure.
- Ingestion no longer waits for AI analysis/email notification; new items are inserted first, analysis runs asynchronously.
- RSSHub compose was changed to build a custom image:
  - `docker/Dockerfile.rsshub`
  - `docker/rsshub-entrypoint.sh`
  - `docker-compose.rsshub.yml`
- Local `server/.env` now uses:
  ```env
  RSSHUB_BASE_URL=http://127.0.0.1:1200
  RSSHUB_BASE_URLS=http://127.0.0.1:1200
  RSS_FETCH_TIMEOUT_MS=30000
  SOURCE_CHECK_TIMEOUT_MS=35000
  SOURCE_CHECK_CONCURRENCY=5
  BILIBILI_DIRECT_API_FALLBACK=false
  ```

## Current Data Source State

Enabled:

- 12 Mihoyo/Miyoushe official RSSHub sources.

Disabled:

- 7 Bilibili official/UP sources.
- Reason: anonymous Bilibili routes fail with anti-crawl:
  - dynamic route: `SyntaxError: Unexpected end of JSON input`
  - video route: `-352 风控校验失败`, status `412`, or no video-list response within 45s

Current RSSHub route tests after custom image:

- `http://127.0.0.1:1200/bilibili/user/video/401742377`: blocked without Cookie.
- `http://127.0.0.1:1200/bilibili/user/dynamic/401742377`: blocked without Cookie.
- Mihoyo routes may return RSS or "this route is empty"; the backend now treats empty routes as healthy zero-item sources.

## Bilibili Cookie Setup

Only do this for local/self-hosted RSSHub. Do not commit cookies.

1. Open Chrome or Edge and log in to Bilibili.
2. Open an official account page, for example:
   `https://space.bilibili.com/401742377/video`
3. Press `F12` and open the `Network` tab.
4. Refresh the page.
5. Click a request to `api.bilibili.com`, ideally:
   `x/space/wbi/arc/search`
6. In `Request Headers`, copy the entire `Cookie` header value.
7. Create or update project-root `.env` at:
   `D:\111222333\personal-hot-monitor\.env`
8. Add the same cookie to the Bilibili UID env vars, for example:
   ```env
   BILIBILI_COOKIE_401742377=your_cookie_here
   BILIBILI_COOKIE_1340190821=your_cookie_here
   BILIBILI_COOKIE_27534330=your_cookie_here
   BILIBILI_COOKIE_1636034895=your_cookie_here
   BILIBILI_COOKIE_1955897084=your_cookie_here
   BILIBILI_COOKIE_161775300=your_cookie_here
   BILIBILI_COOKIE_1265652806=your_cookie_here
   ```
9. Restart/build RSSHub:
   ```powershell
   docker compose -f D:\111222333\personal-hot-monitor\docker-compose.rsshub.yml up -d --build --force-recreate
   ```
10. Test:
   ```powershell
   Invoke-WebRequest -Uri 'http://127.0.0.1:1200/bilibili/user/video/401742377' -UseBasicParsing -TimeoutSec 90
   Invoke-WebRequest -Uri 'http://127.0.0.1:1200/bilibili/user/dynamic/401742377' -UseBasicParsing -TimeoutSec 90
   ```

If the routes return RSS XML, re-enable Bilibili sources:

```powershell
cd D:\111222333\personal-hot-monitor\server
@'
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
await prisma.source.updateMany({
  where: { type: 'bilibili_video' },
  data: { enabled: true, healthStatus: 'unknown', lastError: null }
});
await prisma.$disconnect();
'@ | node --input-type=module
```

## Next Recommended Work

1. Confirm Bilibili Cookie route works in local RSSHub.
2. Re-enable Bilibili sources and run `/api/admin/check`.
3. Only after Bilibili data is stable, rebuild the frontend around the approved design:
   - background images already exist under `client/public/game-pulse/`
   - feed cards should show `coverUrl`
   - source icon should come from source type or favicon/avatar
   - show both `publishedAt` and `createdAt/fetchedAt`
4. Add a small "source blocked / needs cookie" status in admin UI.

## Useful Commands

Backend:

```powershell
cd D:\111222333\personal-hot-monitor\server
npm.cmd run build
npm.cmd run dev
```

Frontend:

```powershell
cd D:\111222333\personal-hot-monitor\client
npm.cmd run build
npm.cmd run dev
```

RSSHub:

```powershell
docker compose -f D:\111222333\personal-hot-monitor\docker-compose.rsshub.yml ps
docker compose -f D:\111222333\personal-hot-monitor\docker-compose.rsshub.yml logs rsshub --tail 120
```

## Latest Status Override - 2026-06-03

The Bilibili state above may be stale in older sections. The latest verified local state is:

- 19 enabled sources are healthy.
- `/api/admin/check` returned:
  ```json
  {
    "checkedSources": 19,
    "newItems": 0,
    "failedSources": 0
  }
  ```
- Current database snapshot:
  - `FeedItem`: 495 items.
  - Items with `coverUrl`: 402.
- Bilibili video sources are enabled.
- RSSHub Bilibili video routes are tried first.
- Backend direct Bilibili WBI API fallback is enabled because RSSHub/Bilibili access can be intermittent.
- Bilibili dynamic routes are still not part of v1 by default.

Before frontend polish, read:

```text
D:\111222333\personal-hot-monitor\docs\game-pulse-dedup-ranking-plan.zh.md
```

This follow-up plan covers same-story deduplication, multi-source jump buttons, low-value notice filtering, and recalibrated importance levels.

## Latest Development Notes - 2026-06-03 12:10 Asia/Shanghai

The latest user review found several product correctness issues. Treat these as the next-window starting point and do not continue broad visual polish until they are addressed.

### Known Blockers

1. Story aggregation is currently over-merging unrelated items.
   - Symptom: different announcements/videos can appear as one story.
   - Likely cause: temporary API aggregation uses loose normalized-title similarity and keyword overlap without enough category/source/time safeguards.
   - Required fix: make merge rules conservative first. Prefer no merge over wrong merge.

2. Multiple jump links are not consistently shown.
   - Symptom: same information sometimes shows only one source button.
   - Likely causes:
     - related items are not merged into the same story;
     - story `sources` may collapse too aggressively or only contain sources present in the temporary merge result;
     - frontend only renders available `story.sources`, so backend aggregation quality controls the buttons.
   - Required fix: after merge rules are corrected, verify `story.sources` contains one entry per source/channel and frontend renders all expected source buttons.

3. Feed page and source-status page are still placeholders.
   - Current nav tabs (`今日摘要`, `情报流`, `源状态`, `后台`) do not represent separate implemented views yet.
   - Required fix: either implement real views/tabs or make the nav visually passive until views exist.

4. Right admin rail duplicates backend/login actions and is unclear.
   - Current right rail buttons mostly open the same admin drawer or do the same action.
   - Product direction to decide next:
     - hide/delete the right login/admin rail for public v1 because it duplicates the drawer; or
     - convert it into a compact source/status rail with clear actions: login, run sync, source list, health details.
   - Do not leave multiple buttons that all navigate to the same unclear place.

5. Importance filter/facet behavior is incorrect.
   - Symptom: after selecting one importance level, other importance categories remain visible and counts can look abnormal.
   - Likely causes:
     - frontend facet counts are computed from the current page of `stories`, not from filtered global totals;
     - `/api/public/stories` does temporary aggregation after fetching a candidate window, so pagination and totals can drift;
     - `/api/public/stats` is global and does not currently expose filtered facets.
   - Required fix: define expected UX first. Recommended v1 behavior: when an importance filter is active, the story list and facet counts should clearly reflect that filter, and inactive facets should either disappear or show true remaining counts.

### Recommended Next Fix Order

1. Add tests or a small fixture script for story aggregation before changing rules.
2. Make temporary merge conservative:
   - only auto-merge if same game;
   - same normalized title, same external source identity, or strong shared AI `dedupKeywords`;
   - require compatible category/kind;
   - require stricter time windows;
   - do not merge on generic words like `公告`, `资讯`, `工具`, `生日`, `角色`.
3. Verify multi-source buttons by checking `/api/public/stories` response shape before touching frontend.
4. Fix importance filtering and counts/facets.
5. Decide whether to hide the right admin rail or convert it into real source-status shortcuts.
6. Implement real `情报流` and `源状态` tabs/pages, then resume visual polish.

### Suggested Acceptance Checks

- No unrelated posts are grouped into one story in the top 50 stories.
- Same story across B站/米游社/官网 shows multiple source buttons when source data exists.
- Selecting `high`, `medium`, or `low` changes the story list and displays coherent counts.
- Right-side admin/login actions are not duplicated or ambiguous.
- `情报流` and `源状态` tabs either work as real views or are removed/disabled until implemented.
- Run:
  ```powershell
  cd D:\111222333\personal-hot-monitor\server
  npm.cmd run build
  cd D:\111222333\personal-hot-monitor\client
  npm.cmd run build
  ```

`npm.cmd test` in `server` currently exits with "No test files found" unless tests are added.
