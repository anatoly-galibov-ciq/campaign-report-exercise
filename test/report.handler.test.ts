import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCampaignReport } from '../src/report.handler';
import { db } from '../src/db';
import { socialApi } from '../src/social-api';
import { ForbiddenError, NotFoundError, UpstreamError } from '../src/errors';

interface Identity {
  partnerId: number;
  brandIds: number[] | null;
}

const PARTNER_1: Identity = { partnerId: 1, brandIds: null };
const PARTNER_1_BRAND_11_MANAGER: Identity = { partnerId: 1, brandIds: [11] };
const PARTNER_2: Identity = { partnerId: 2, brandIds: null };
const PARTNER_3: Identity = { partnerId: 3, brandIds: null };

const ALL_BRANDS_TOTALS = { posts: 4, reach: 52000, views: 103000, engagements: 3790, engagementRate: '7.29%' };
const BRAND_11_TOTALS = { posts: 2, reach: 32000, views: 80000, engagements: 2800, engagementRate: '8.75%' };

function event(campaignId: number, identity: Identity) {
  return { arguments: { campaignId }, identity };
}

afterEach(() => {
  socialApi.simulateOutage(false);
  socialApi.simulateFlakiness(false);
  vi.restoreAllMocks();
});

describe('getCampaignReport', () => {
  it('builds totals and a per-platform breakdown', async () => {
    const report = await getCampaignReport(event(101, PARTNER_1));

    expect(report).toEqual({
      campaignId: 101,
      campaignName: 'Summer Launch',
      totals: ALL_BRANDS_TOTALS,
      byPlatform: {
        instagram: { posts: 2, reach: 17000, views: 38000, engagements: 1350, engagementRate: '7.94%' },
        tiktok: { posts: 1, reach: 20000, views: 50000, engagements: 1800, engagementRate: '9.00%' },
        youtube: { posts: 1, reach: 15000, views: 15000, engagements: 640, engagementRate: '4.27%' },
      },
    });
  });

  it("shows a brand manager only their brands' posts", async () => {
    const report = await getCampaignReport(event(102, PARTNER_1_BRAND_11_MANAGER));

    expect(report).toEqual({
      campaignId: 102,
      campaignName: 'Campaign 102',
      totals: BRAND_11_TOTALS,
      byPlatform: {
        instagram: { posts: 1, reach: 12000, views: 30000, engagements: 1000, engagementRate: '8.33%' },
        tiktok: { posts: 1, reach: 20000, views: 50000, engagements: 1800, engagementRate: '9.00%' },
      },
    });
  });

  it('throws NotFoundError for an unknown campaign', async () => {
    await expect(getCampaignReport(event(999, PARTNER_1))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ForbiddenError for another partner's campaign", async () => {
    await expect(getCampaignReport(event(103, PARTNER_2))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('does not call the social API again when the same report is reopened', async () => {
    await getCampaignReport(event(104, PARTNER_1));
    const requestsSoFar = socialApi.requestCount();

    await getCampaignReport(event(104, PARTNER_1));

    expect(socialApi.requestCount(), 'social API requests').toBe(requestsSoFar);
  });

  it('requests metrics for every post of the campaign', async () => {
    const getMetrics = vi.spyOn(socialApi, 'getMetrics');

    await getCampaignReport(event(105, PARTNER_1));

    expect(getMetrics).toHaveBeenCalledTimes(4);
    expect(getMetrics).toHaveBeenCalledWith('ig_1001');
  });
});

describe('reported issues', () => {
  it('[security] another partner cannot read a campaign after its owner has opened it', async () => {
    await getCampaignReport(event(106, PARTNER_1));

    await expect(getCampaignReport(event(106, PARTNER_2))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("[security] a brand manager doesn't see other brands' numbers after a partner-wide user has opened the report", async () => {
    await getCampaignReport(event(107, PARTNER_1));

    const report = await getCampaignReport(event(107, PARTNER_1_BRAND_11_MANAGER));

    expect(report.totals).toEqual(BRAND_11_TOTALS);
  });

  it('[freshness] a post attached to the campaign shows up the next time the report is opened', async () => {
    await getCampaignReport(event(108, PARTNER_1));
    await db.attachPost({ campaignId: 108, postId: 'tt_1005', platform: 'tiktok', brandId: 11, manualReach: null });

    const report = await getCampaignReport(event(108, PARTNER_1));

    expect(report.totals.posts).toBe(5);
    expect(report.totals.reach).toBe(60000);
  });

  it('[data quality] fails with UpstreamError instead of reporting zeros when the social API is down', async () => {
    socialApi.simulateOutage(true);

    await expect(getCampaignReport(event(109, PARTNER_1))).rejects.toBeInstanceOf(UpstreamError);
  });

  it('[data quality] builds a correct report while the social API is flaky', async () => {
    socialApi.simulateFlakiness(true);

    const report = await getCampaignReport(event(110, PARTNER_1));

    expect(report.totals).toEqual(ALL_BRANDS_TOTALS);
  });

  it('[performance] builds the report of a 1,000-post campaign in under a second', async () => {
    const rejectedSoFar = socialApi.rejectedRequestCount();
    const startedAt = Date.now();

    const report = await getCampaignReport(event(300, PARTNER_3));

    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(socialApi.rejectedRequestCount() - rejectedSoFar, 'requests rejected with 429').toBe(0);
    expect(report.totals.posts).toBe(1000);
    expect(report.totals.reach).toBe(1_333_000);
  }, 2000);

  it('[performance] serves 6 concurrent reports of 1,000-post campaigns in under 2 seconds', async () => {
    const rejectedSoFar = socialApi.rejectedRequestCount();
    const startedAt = Date.now();

    const reports = await Promise.all(
      [301, 302, 303, 304, 305, 306].map((campaignId) => getCampaignReport(event(campaignId, PARTNER_3))),
    );

    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(socialApi.rejectedRequestCount() - rejectedSoFar, 'requests rejected with 429').toBe(0);
    expect(reports.map((report) => report.totals.reach)).toEqual(Array(6).fill(1_333_000));
  }, 3000);
});
