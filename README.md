# Campaign report

You've just joined the team that owns the reporting API. Brands and agencies use it to see how
their influencer campaigns perform. `getCampaignReport` (`src/report.handler.ts`) is the resolver
behind the GraphQL query `campaignReport(campaignId: Int!)`. The service is a long-lived Node.js
process that serves many requests at the same time. The resolver grew over time, and support has
filed several issues against it.

## Rules

- You have 40 minutes. Think out loud: how you reason matters more to us than finishing everything.
  You probably won't fix everything, so choose what to do first and tell us what you'd do next.
- No AI assistants (Copilot, ChatGPT, Claude, …). Documentation and web search are fine.
- You may change anything in `src/report.handler.ts` and `test/`, and add files.
- `src/db.ts` and `src/social-api.ts` stand in for our database and a third-party API. Read them,
  but don't change them. `src/server.ts` is a dev tool, and you don't need to change it.

## Running

- **StackBlitz:** the tests start on their own in watch mode and re-run as you edit. Don't reload
  the page: as a guest, your changes live only in this browser tab.
- **Locally (Node 22+):** `npm install`, then `npm test`.
- Type check: `npm run typecheck`.

### Trying the API by hand

Tests don't check everything. `npm run dev` starts the GraphQL API on port 4000 with GraphiQL, and
it restarts whenever the code changes. In StackBlitz, open a second terminal with the `+` button and run
the command there; GraphiQL opens in the preview panel. Locally, open http://localhost:4000/graphql.

- Who is asking comes from request headers: `x-partner-id` (required) and `x-brand-ids` (optional,
  comma-separated). Partner 1 owns campaigns 101–110, and partner 3 owns 300–306.
- Dev-only mutations reproduce the reported issues: `attachPost` (the social API knows `tt_1005`),
  `simulateSocialApiOutage` and `simulateSocialApiFlakiness`.
- The server calls `getCampaignReport` from `src/report.handler.ts`, so keep that export working.

## Step 1: review (about 5 minutes)

Read `src/report.handler.ts` and tell us what worries you in it, most important first. Don't change
anything yet.

## Step 2: the reported issues

Each issue has failing tests under `describe('reported issues')` in `test/report.handler.test.ts`.
The other tests pass today and must keep passing.

- **[security]** "A brand manager on our account saw other brands' numbers in a campaign report."
  Another partner reported seeing a campaign that isn't theirs.
- **[freshness]** "We attached a post to the campaign, and the report didn't show it for ten
  minutes."
- **[data quality]** "During yesterday's social API outage, our campaigns showed 0 reach instead of
  an error. Even on normal days the numbers jump around between reloads."
- **[performance]** "Reports for big campaigns (1,000+ posts) time out, and it gets worse on
  Monday mornings, when everyone opens their reports at once."

## Product rules

- A campaign belongs to a partner (an agency or a brand). Only users of that partner may open its
  report.
- Each post in a campaign was made for one brand (`brandId`). Users with `brandIds: null` see every
  post of the campaign. Brand managers (`brandIds: [11, …]`) only see the posts of their brands, and
  the whole report is computed from those posts only.
- Post metrics change slowly, so showing numbers up to 5 minutes old is fine. Campaign changes
  (posts attached or removed) must show up the next time the report is opened.

The GraphQL gateway calls the resolver with
`{ arguments: { campaignId }, identity: { partnerId, brandIds } }`.

## How the report is computed

- **Reach** of a post: the reach the creator typed in (`manualReach`) if there is one, otherwise the
  reach from the social API. YouTube doesn't report reach, so views count as reach.
- **Engagements** of a post:
  - Instagram: likes + comments + saves
  - TikTok: likes + comments + shares
  - YouTube: likes + comments
- **Engagement rate** = engagements / reach, as a percentage with two decimals (`"7.29%"`), or `"n/a"`
  when reach is 0. For totals, sum first and then divide; don't average the per-post rates.

## Social API (`src/social-api.ts`)

- `getMetrics(postId)`: one post per request.
- `getMetricsBatch(postIds)`: up to 100 posts per request.
- Every request takes about 20 ms, whether it's a single post or a batch.
- We pay for every request, so don't request the same metrics again while they're still fresh
  enough to show.
- Our API key allows at most 4 requests in flight at once, and the whole service shares that one
  key. The provider rejects any request beyond that with 429 and counts every rejection against our
  key. Stay under the limit; don't rely on retrying into it.
- Failures are thrown as `SocialApiError` with an HTTP-like `status`. 429 and 503 are transient,
  and a request may be tried at most 3 times. 400 and 404 are permanent.

## Errors (`src/errors.ts`)

The GraphQL layer turns `NotFoundError`, `ForbiddenError` and `UpstreamError` (meaning a service we
depend on is failing) into client-facing error codes. Any other error reaches the client as a
generic "internal error".

## Step 3: wrap-up (last 5 minutes)

We'll talk about what you'd do next if you had more time.
