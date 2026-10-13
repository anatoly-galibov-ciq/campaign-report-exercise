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

// The provider's limits. They come with the API: nothing on our side can raise them.
/** Round trip of one request, single or batch. */
const LATENCY_MS = 20;
/** A request that would exceed this many in flight for our API key is rejected with 429. */
const MAX_CONCURRENT_REQUESTS = 4;
/** Max ids per getMetricsBatch call. More posts take several batches. */
const MAX_BATCH_SIZE = 100;

const METRICS = new Map<string, Omit<PostMetrics, 'postId'>>([
  // Not in any campaign yet; tests and the dev server attach it.
  ['tt_1005', { reach: 8000, views: 16000, likes: 400, comments: 30, shares: 70, saves: 10 }],
]);

// Small campaigns 101–110: the four posts of every campaign have the same metrics.
for (let campaignId = 101; campaignId <= 110; campaignId++) {
  METRICS.set(`ig_${campaignId}_1`, { reach: 12000, views: 30000, likes: 900, comments: 60, shares: 15, saves: 40 });
  METRICS.set(`ig_${campaignId}_2`, { reach: 4000, views: 8000, likes: 300, comments: 20, shares: 5, saves: 30 });
  METRICS.set(`tt_${campaignId}_1`, { reach: 20000, views: 50000, likes: 1500, comments: 100, shares: 200, saves: 50 });
  METRICS.set(`yt_${campaignId}_1`, { reach: null, views: 15000, likes: 600, comments: 40, shares: 0, saves: 0 });
}

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

/**
 * Creates a fresh fake client. Application code uses the exported `socialApi` instance below;
 * tests can create their own to start from a clean state.
 */
export function createSocialApi() {
  let inFlight = 0;
  let received = 0;
  let rejected = 0;
  let outage = false;
  let flaky = false;
  let flakyCounter = 0;

  async function request<T>(handle: () => T): Promise<T> {
    received++;
    if (inFlight >= MAX_CONCURRENT_REQUESTS) {
      rejected++;
      // A rejection costs a round trip too.
      await sleep(LATENCY_MS);
      throw new SocialApiError(
        `429 Too Many Requests: at most ${MAX_CONCURRENT_REQUESTS} concurrent requests`,
        429,
      );
    }
    inFlight++;
    try {
      await sleep(LATENCY_MS);
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

    /**
     * Metrics of up to 100 posts in one request, in the order of `postIds`.
     * For more posts, send several batches.
     */
    async getMetricsBatch(postIds: string[]): Promise<PostMetrics[]> {
      if (postIds.length > MAX_BATCH_SIZE) {
        throw new SocialApiError(`400 Bad Request: at most ${MAX_BATCH_SIZE} ids per batch`, 400);
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
