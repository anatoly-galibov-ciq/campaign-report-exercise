// Fake client for the external social-network metrics API.
// Treat it as an external dependency: read it, don't change it.

export interface PostMetrics {
  postId: string;
  /** null when the network doesn't report reach (YouTube). */
  reach: number | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
}

export class SocialApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'SocialApiError';
    this.status = status;
  }
}

export interface SocialApiOptions {
  /** Round trip of one request, single or batch. */
  latencyMs?: number;
  /** A request that would exceed this many in flight is rejected with 429. */
  maxConcurrentRequests?: number;
  /** Max ids per getMetricsBatch call. */
  maxBatchSize?: number;
}

const METRICS = new Map<string, Omit<PostMetrics, 'postId'>>([
  ['ig_1001', { reach: 12000, views: 30000, likes: 900, comments: 60, shares: 15, saves: 40 }],
  ['ig_1002', { reach: 4000, views: 8000, likes: 300, comments: 20, shares: 5, saves: 30 }],
  ['tt_1003', { reach: 20000, views: 50000, likes: 1500, comments: 100, shares: 200, saves: 50 }],
  ['yt_1004', { reach: null, views: 15000, likes: 600, comments: 40, shares: 0, saves: 0 }],
  ['tt_1005', { reach: 8000, views: 16000, likes: 400, comments: 30, shares: 70, saves: 10 }],
]);

// Large campaigns 300–306: every third post (i % 3 === 2) is a YouTube video.
for (const campaignId of [300, 301, 302, 303, 304, 305, 306]) {
  for (let i = 0; i < 1000; i++) {
    METRICS.set(`post_${campaignId}_${i}`, {
      reach: i % 3 === 2 ? null : 1000,
      views: 2000,
      likes: 100,
      comments: 10,
      shares: 5,
      saves: 5,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createSocialApi(options: SocialApiOptions = {}) {
  const { latencyMs = 20, maxConcurrentRequests = 4, maxBatchSize = 100 } = options;
  let inFlight = 0;
  let received = 0;
  let rejected = 0;
  let outage = false;
  let flaky = false;
  let flakyCounter = 0;

  async function request<T>(handle: () => T): Promise<T> {
    received++;
    if (inFlight >= maxConcurrentRequests) {
      rejected++;
      // A rejection costs a round trip too.
      await sleep(latencyMs);
      throw new SocialApiError(
        `429 Too Many Requests: at most ${maxConcurrentRequests} concurrent requests`,
        429,
      );
    }
    inFlight++;
    try {
      await sleep(latencyMs);
      if (outage || (flaky && flakyCounter++ % 2 === 0)) {
        throw new SocialApiError('503 Service Unavailable', 503);
      }
      return handle();
    } finally {
      inFlight--;
    }
  }

  function lookup(postId: string): PostMetrics {
    const metrics = METRICS.get(postId);
    if (!metrics) {
      throw new SocialApiError(`404 Post ${postId} not found`, 404);
    }
    return { postId, ...metrics };
  }

  return {
    /** Metrics of one post, one request. */
    getMetrics(postId: string): Promise<PostMetrics> {
      return request(() => lookup(postId));
    },

    /** Metrics of up to `maxBatchSize` posts in one request, in the order of `postIds`. */
    async getMetricsBatch(postIds: string[]): Promise<PostMetrics[]> {
      if (postIds.length > maxBatchSize) {
        throw new SocialApiError(`400 Bad Request: at most ${maxBatchSize} ids per batch`, 400);
      }
      return request(() => postIds.map(lookup));
    },

    /** Test helper: requests received so far, rejected ones included. */
    requestCount(): number {
      return received;
    },

    /** Test helper: requests rejected with 429 so far. */
    rejectedRequestCount(): number {
      return rejected;
    },

    /** Test helper: every request fails with 503 until switched off. */
    simulateOutage(enabled: boolean): void {
      outage = enabled;
    },

    /** Test helper: every second request fails with 503, starting with the next one. */
    simulateFlakiness(enabled: boolean): void {
      flaky = enabled;
      flakyCounter = 0;
    },
  };
}

export type SocialApi = ReturnType<typeof createSocialApi>;

export const socialApi = createSocialApi();
