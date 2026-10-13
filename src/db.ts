// In-memory stand-in for the reporting database.
// Treat it as an external dependency: read it, don't change it.

export type Platform = 'instagram' | 'tiktok' | 'youtube';

export interface CampaignRow {
  id: number;
  partnerId: number;
  name: string;
}

export interface CampaignPostRow {
  campaignId: number;
  postId: string;
  platform: Platform;
  /** The brand the post was made for. */
  brandId: number;
  /** Reach typed in by the creator. When set, it wins over what the social API reports. */
  manualReach: number | null;
}

const LATENCY_MS = 5;
const PLATFORMS: Platform[] = ['instagram', 'tiktok', 'youtube'];
const SMALL_CAMPAIGN_IDS = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
const LARGE_CAMPAIGN_IDS = [300, 301, 302, 303, 304, 305, 306];

function seedCampaigns(): CampaignRow[] {
  return [
    ...SMALL_CAMPAIGN_IDS.map((id) => ({
      id,
      partnerId: 1,
      name: id === 101 ? 'Summer Launch' : `Campaign ${id}`,
    })),
    ...LARGE_CAMPAIGN_IDS.map((id) => ({ id, partnerId: 3, name: `Always On ${id}` })),
  ];
}

function seedCampaignPosts(): CampaignPostRow[] {
  return [
    // Every small campaign has four posts of its own, made for two brands, 11 and 12.
    ...SMALL_CAMPAIGN_IDS.flatMap((campaignId): CampaignPostRow[] => [
      { campaignId, postId: `ig_${campaignId}_1`, platform: 'instagram', brandId: 11, manualReach: null },
      { campaignId, postId: `ig_${campaignId}_2`, platform: 'instagram', brandId: 12, manualReach: 5000 },
      { campaignId, postId: `tt_${campaignId}_1`, platform: 'tiktok', brandId: 11, manualReach: null },
      { campaignId, postId: `yt_${campaignId}_1`, platform: 'youtube', brandId: 12, manualReach: null },
    ]),

    // Large campaigns have 1,000 posts each: post_<campaignId>_0 … post_<campaignId>_999,
    // platforms rotate instagram → tiktok → youtube.
    ...LARGE_CAMPAIGN_IDS.flatMap((campaignId) =>
      Array.from({ length: 1000 }, (_, i): CampaignPostRow => ({
        campaignId,
        postId: `post_${campaignId}_${i}`,
        platform: PLATFORMS[i % 3],
        brandId: 31,
        manualReach: null,
      })),
    ),
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createDb() {
  const campaigns = seedCampaigns();
  const campaignPosts = seedCampaignPosts();

  return {
    async getCampaign(id: number): Promise<CampaignRow | undefined> {
      await sleep(LATENCY_MS);
      const row = campaigns.find((c) => c.id === id);
      return row && { ...row };
    },

    async getCampaignPosts(campaignId: number): Promise<CampaignPostRow[]> {
      await sleep(LATENCY_MS);
      return campaignPosts.filter((p) => p.campaignId === campaignId).map((p) => ({ ...p }));
    },

    /** Other services attach posts to campaigns at any time; tests use this to simulate that. */
    async attachPost(post: CampaignPostRow): Promise<void> {
      await sleep(LATENCY_MS);
      campaignPosts.push({ ...post });
    },
  };
}

export type Db = ReturnType<typeof createDb>;

export const db = createDb();
