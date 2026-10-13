// Local GraphQL API for trying the resolver by hand: `npm run dev`, then open
// http://localhost:4000/graphql. A dev tool: you don't need to change it.
import { createServer } from 'node:http';
import { GraphQLError } from 'graphql';
import { createSchema, createYoga } from 'graphql-yoga';
import { getCampaignReport } from './report.handler';
import { db, type Platform } from './db';
import { socialApi } from './social-api';
import { AppError } from './errors';

const PORT = 4000;

const typeDefs = /* GraphQL */ `
  type Query {
    campaignReport(campaignId: Int!): CampaignReport!
  }

  type CampaignReport {
    campaignId: Int!
    campaignName: String!
    totals: MetricTotals!
    byPlatform: PlatformBreakdown!
  }

  type PlatformBreakdown {
    instagram: MetricTotals
    tiktok: MetricTotals
    youtube: MetricTotals
  }

  type MetricTotals {
    posts: Int!
    reach: Int!
    views: Int!
    engagements: Int!
    engagementRate: String!
  }

  enum Platform {
    instagram
    tiktok
    youtube
  }

  "Dev-only helpers for reproducing the reported issues by hand."
  type Mutation {
    "Attaches a post to a campaign, the way another service would. The social API knows tt_1005."
    attachPost(campaignId: Int!, postId: String!, platform: Platform!, brandId: Int!, manualReach: Int): Boolean!
    "Makes every social API request fail with 503 until switched off. Returns the new state."
    simulateSocialApiOutage(enabled: Boolean!): Boolean!
    "Makes every second social API request fail with 503 until switched off. Returns the new state."
    simulateSocialApiFlakiness(enabled: Boolean!): Boolean!
  }
`;

const DEFAULT_QUERY = /* GraphQL */ `# Who is asking comes from the request headers (Headers tab below):
#   x-partner-id  required. Partner 1 owns campaigns 101–110, partner 3 owns 300–306.
#   x-brand-ids   optional, e.g. "11". Brand managers only see their brands' posts.
query Report {
  campaignReport(campaignId: 101) {
    campaignId
    campaignName
    totals { posts reach views engagements engagementRate }
    byPlatform {
      instagram { posts reach views engagements engagementRate }
      tiktok { posts reach views engagements engagementRate }
      youtube { posts reach views engagements engagementRate }
    }
  }
}
`;

interface Identity {
  partnerId: number;
  brandIds: number[] | null;
}

function identityFrom(request: Request): Identity {
  const partnerId = Number(request.headers.get('x-partner-id'));
  if (!Number.isInteger(partnerId) || partnerId <= 0) {
    throw new GraphQLError('Set the x-partner-id header', { extensions: { code: 'UNAUTHENTICATED' } });
  }
  const brandIds = request.headers.get('x-brand-ids');
  return {
    partnerId,
    brandIds: brandIds ? brandIds.split(',').map((id) => Number(id.trim())) : null,
  };
}

const resolvers = {
  Query: {
    async campaignReport(_: unknown, args: { campaignId: number }, { request }: { request: Request }) {
      try {
        return await getCampaignReport({ arguments: args, identity: identityFrom(request) });
      } catch (error) {
        if (error instanceof AppError) {
          throw new GraphQLError(error.message, { extensions: { code: error.code } });
        }
        // Anything else reaches the client as "Unexpected error." and is logged here.
        throw error;
      }
    },
  },
  Mutation: {
    async attachPost(
      _: unknown,
      post: { campaignId: number; postId: string; platform: Platform; brandId: number; manualReach?: number | null },
    ) {
      await db.attachPost({ ...post, manualReach: post.manualReach ?? null });
      return true;
    },
    simulateSocialApiOutage(_: unknown, { enabled }: { enabled: boolean }) {
      socialApi.simulateOutage(enabled);
      return enabled;
    },
    simulateSocialApiFlakiness(_: unknown, { enabled }: { enabled: boolean }) {
      socialApi.simulateFlakiness(enabled);
      return enabled;
    },
  },
};

const yoga = createYoga({
  schema: createSchema({ typeDefs, resolvers }),
  graphiql: {
    title: 'Campaign report API',
    defaultQuery: DEFAULT_QUERY,
    headers: JSON.stringify({ 'x-partner-id': '1' }, null, 2),
  },
});

createServer((request, response) => {
  if (new URL(request.url ?? '/', 'http://localhost').pathname === '/') {
    response.writeHead(302, { location: '/graphql' }).end();
    return;
  }
  yoga(request, response);
}).listen(PORT, () => {
  console.log(`Campaign report API: http://localhost:${PORT}/graphql`);
});
