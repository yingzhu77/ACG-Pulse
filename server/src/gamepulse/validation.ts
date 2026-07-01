import { z } from 'zod';

// --- Enums ---

export const SourceTypeEnum = z.enum([
  'rss',
  'rsshub',
  'bilibili_video',
  'official_site',
  'trend'
]);

export const FeedItemKindEnum = z.enum([
  'official_post',
  'creator_video',
  'trend',
  'forum_thread'
]);

export const AnalysisCategoryEnum = z.enum([
  'announcement',
  'event',
  'version',
  'character',
  'pv',
  'game_music',
  'music',
  'community',
  'enforcement',
  'creator_video',
  'trailer',
  'movie_trailer',
  'other'
]);

export const ImportanceEnum = z.enum(['low', 'medium', 'high']);
export const VisibilityEnum = z.enum(['public', 'muted', 'hidden']);

// --- Helper ---

const optionalTrimmedString = z.preprocess(
  (v) => {
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim();
    return s || undefined;
  },
  z.string().optional()
);

const optionalNullableTrimmedString = z.preprocess(
  (v) => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s || null;
  },
  z.string().nullable()
);

const booleanLike = z.preprocess(
  (v) => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (s === 'true') return true;
      if (s === 'false') return false;
    }
    return v;
  },
  z.boolean()
);

const sourceConfigString = z.preprocess(
  (v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'string') {
      const s = v.trim();
      return s || null;
    }
    return JSON.stringify(v);
  },
  z.string().nullable()
);

// --- Admin: Source CRUD ---

export const CreateSourceSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  type: z.string().trim().min(1, 'type is required'),
  game: z.string().trim().min(1, 'game is required'),
  url: optionalNullableTrimmedString,
  uid: optionalNullableTrimmedString,
  route: optionalNullableTrimmedString,
  isOfficial: booleanLike.default(false),
  followed: booleanLike.default(false),
  enabled: booleanLike.default(true),
  priority: z.number().int().min(0).max(100).default(50),
  config: sourceConfigString
});

export const SourcePreviewSchema = CreateSourceSchema.extend({
  limit: z.preprocess(
    (v) => {
      if (v === undefined || v === null || v === '') return 5;
      const n = Number(v);
      return Number.isFinite(n) ? n : 5;
    },
    z.number().int().min(1).max(10).default(5)
  )
});

export const UpdateSourceSchema = z.object({
  name: z.string().trim().min(1, 'name is required').optional(),
  type: z.string().trim().min(1, 'type is required').optional(),
  game: z.string().trim().min(1, 'game is required').optional(),
  url: optionalNullableTrimmedString.optional(),
  uid: optionalNullableTrimmedString.optional(),
  route: optionalNullableTrimmedString.optional(),
  isOfficial: booleanLike.optional(),
  followed: booleanLike.optional(),
  enabled: booleanLike.optional(),
  priority: z.number().int().min(0).max(100).optional(),
  config: sourceConfigString.optional()
});

export type CreateSourceInput = z.infer<typeof CreateSourceSchema>;
export type SourcePreviewInput = z.infer<typeof SourcePreviewSchema>;
export type UpdateSourceInput = z.infer<typeof UpdateSourceSchema>;

// --- Admin: Follow URL ---

export const FollowUrlSchema = z.object({
  url: z.string().trim().min(1, 'url is required'),
  name: optionalTrimmedString
});

export type FollowUrlInput = z.infer<typeof FollowUrlSchema>;

// --- Admin: Reanalyze ---

export const ReanalyzeSchema = z.object({
  limit: z.preprocess(
    (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 100;
    },
    z.number().int().min(1).max(500).default(100)
  )
});

export type ReanalyzeInput = z.infer<typeof ReanalyzeSchema>;

// --- Admin: Hide Item ---

export const HideItemSchema = z.object({
  hidden: z.boolean()
});

export type HideItemInput = z.infer<typeof HideItemSchema>;

// --- Admin: Login ---

export const LoginSchema = z.object({
  password: z.string().min(1, 'password is required')
});

export type LoginInput = z.infer<typeof LoginSchema>;

// --- Admin: Settings ---

export const UpdateSettingsSchema = z.record(z.string(), z.unknown());

export type UpdateSettingsInput = z.infer<typeof UpdateSettingsSchema>;

// --- Public: Query filters ---

export const PublicItemsQuerySchema = z.object({
  page: z.preprocess(
    (v) => Math.max(1, parseInt(String(v ?? '1'), 10) || 1),
    z.number().int().min(1)
  ),
  limit: z.preprocess(
    (v) => Math.min(60, Math.max(1, parseInt(String(v ?? '24'), 10) || 24)),
    z.number().int().min(1).max(60)
  ),
  game: z.string().optional(),
  sourceId: z.string().optional(),
  itemKind: z.string().optional(),
  category: z.string().optional(),
  importance: z.string().optional(),
  visibility: z.string().optional(),
  official: z.string().optional(),
  q: z.string().optional()
});

export type PublicItemsQuery = z.infer<typeof PublicItemsQuerySchema>;

export const PublicStoriesQuerySchema = z.object({
  page: z.preprocess(
    (v) => Math.max(1, parseInt(String(v ?? '1'), 10) || 1),
    z.number().int().min(1)
  ),
  limit: z.preprocess(
    (v) => Math.min(60, Math.max(1, parseInt(String(v ?? '24'), 10) || 24)),
    z.number().int().min(1).max(60)
  ),
  game: z.union([z.string(), z.array(z.string())]).optional(),
  sourceId: z.string().optional(),
  itemKind: z.string().optional(),
  category: z.union([z.string(), z.array(z.string())]).optional(),
  importance: z.union([z.string(), z.array(z.string())]).optional(),
  visibility: z.string().optional(),
  official: z.string().optional(),
  q: z.string().optional(),
  followGroup: z.string().optional(),
  sourceUid: z.union([z.string(), z.array(z.string())]).optional(),
  includeFacets: z.preprocess(
    (v) => String(v ?? 'true') !== 'false',
    z.boolean()
  )
});

export type PublicStoriesQuery = z.infer<typeof PublicStoriesQuerySchema>;

// --- Admin: Items query ---

export const AdminItemsQuerySchema = z.object({
  page: z.preprocess(
    (v) => Math.max(1, parseInt(String(v ?? '1'), 10) || 1),
    z.number().int().min(1)
  ),
  limit: z.preprocess(
    (v) => Math.min(80, Math.max(1, parseInt(String(v ?? '30'), 10) || 30)),
    z.number().int().min(1).max(80)
  ),
  hidden: z.string().optional()
});

export type AdminItemsQuery = z.infer<typeof AdminItemsQuerySchema>;

// --- Notification query ---

export const NotificationQuerySchema = z.object({
  page: z.preprocess(
    (v) => Math.max(1, parseInt(String(v ?? '1'), 10) || 1),
    z.number().int().min(1)
  ),
  limit: z.preprocess(
    (v) => Math.min(100, Math.max(1, parseInt(String(v ?? '50'), 10) || 50)),
    z.number().int().min(1).max(100)
  ),
  unreadOnly: z.string().optional()
});

export type NotificationQuery = z.infer<typeof NotificationQuerySchema>;

// --- Type guard utility ---

/**
 * Parse and validate request data. Returns parsed data or throws with 400-friendly message.
 */
export function validateOrThrow<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  label = 'input'
): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Validation failed for ${label}: ${issues}`);
  }
  return result.data;
}
