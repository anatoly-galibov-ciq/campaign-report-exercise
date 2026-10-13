import { db } from './db';
import { socialApi } from './social-api';
import { ForbiddenError, NotFoundError } from './errors';

// reports are expensive to build, keep them for 10 minutes
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<number, { report: any; cachedAt: number }>();

/**
 * Resolver for the GraphQL query `campaignReport(campaignId: Int!)`.
 * `event` is what the GraphQL gateway passes in: { arguments, identity }.
 */
export async function getCampaignReport(event: any) {
  const campaignId = Number(event.arguments.campaignId);
  const { partnerId, brandIds } = event.identity;

  const cached = cache.get(campaignId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.report;
  }

  const campaign = await db.getCampaign(campaignId);
  if (!campaign) {
    throw new NotFoundError(`Campaign ${campaignId} not found`);
  }
  if (campaign.partnerId !== partnerId) {
    throw new ForbiddenError(`No access to campaign ${campaignId}`);
  }

  const posts = await db.getCampaignPosts(campaignId);

  let totalPosts = 0;
  let totalReach = 0;
  let totalViews = 0;
  let totalEngagements = 0;
  const byPlatform: any = {};

  for (const post of posts) {
    // brand managers only see the posts of their own brands
    if (brandIds && !brandIds.includes(post.brandId)) {
      continue;
    }

    let m: any;
    try {
      m = await socialApi.getMetrics(post.postId);
    } catch (e) {
      // one broken post should not break the whole report
      m = { reach: 0, views: 0, likes: 0, comments: 0, shares: 0, saves: 0 };
    }

    totalPosts++;
    if (post.platform === 'instagram') {
      const reach = post.manualReach || m.reach || 0;
      const engagements = m.likes + m.comments + m.saves;
      totalReach += reach;
      totalViews += m.views;
      totalEngagements += engagements;
      if (!byPlatform.instagram) byPlatform.instagram = { posts: 0, reach: 0, views: 0, engagements: 0 };
      byPlatform.instagram.posts++;
      byPlatform.instagram.reach += reach;
      byPlatform.instagram.views += m.views;
      byPlatform.instagram.engagements += engagements;
    } else if (post.platform === 'tiktok') {
      const reach = post.manualReach || m.reach || 0;
      const engagements = m.likes + m.comments + m.shares;
      totalReach += reach;
      totalViews += m.views;
      totalEngagements += engagements;
      if (!byPlatform.tiktok) byPlatform.tiktok = { posts: 0, reach: 0, views: 0, engagements: 0 };
      byPlatform.tiktok.posts++;
      byPlatform.tiktok.reach += reach;
      byPlatform.tiktok.views += m.views;
      byPlatform.tiktok.engagements += engagements;
    } else if (post.platform === 'youtube') {
      // YouTube doesn't report reach, views are the closest thing
      const reach = post.manualReach || m.views || 0;
      const engagements = m.likes + m.comments;
      totalReach += reach;
      totalViews += m.views;
      totalEngagements += engagements;
      if (!byPlatform.youtube) byPlatform.youtube = { posts: 0, reach: 0, views: 0, engagements: 0 };
      byPlatform.youtube.posts++;
      byPlatform.youtube.reach += reach;
      byPlatform.youtube.views += m.views;
      byPlatform.youtube.engagements += engagements;
    }
  }

  for (const platform in byPlatform) {
    const p = byPlatform[platform];
    p.engagementRate = p.reach > 0 ? ((p.engagements / p.reach) * 100).toFixed(2) + '%' : 'n/a';
  }

  const report = {
    campaignId: campaign.id,
    campaignName: campaign.name,
    totals: {
      posts: totalPosts,
      reach: totalReach,
      views: totalViews,
      engagements: totalEngagements,
      engagementRate: totalReach > 0 ? ((totalEngagements / totalReach) * 100).toFixed(2) + '%' : 'n/a',
    },
    byPlatform,
  };

  cache.set(campaignId, { report, cachedAt: Date.now() });
  return report;
}
