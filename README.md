# Campaign report

`getCampaignReport` (`src/report.handler.ts`) is the resolver behind the GraphQL query
`campaignReport(campaignId: Int!)` in our reporting API. Brands and agencies use it to see how their
influencer campaigns perform. The service is a long-lived Node.js process that serves many requests
at once. The resolver grew over time, and support has filed a few issues against it.

## How the 40 minutes go

1. **Review (about 5 minutes).** Read `src/report.handler.ts` and tell us what worries you, most
   important first. Don't change anything yet.
2. **Fix the reported issues below.** Each one has failing tests in `test/report.handler.test.ts`.
   You probably won't finish everything, and that's expected: choose an order and tell us what you'd
   do next.
3. **Wrap-up (last 5 minutes).** What you'd do with more time.

Think out loud, and ask us anything along the way. No AI assistants; documentation and web search
are fine. You may change `src/report.handler.ts` and the tests, and add files. `src/db.ts` and
`src/social-api.ts` stand in for our database and a third-party API: read them, but don't change
them.

## Running the tests

- `npm test` runs the tests once. StackBlitz runs it for you when the project opens.
- `npm run test:watch` re-runs them on every change. `npm run typecheck` checks types.
- In StackBlitz, don't reload the page: as a guest, your changes live only in this browser tab.
- Locally you need Node 22+ and `npm install`.

## Reported issues

- **[security]** A brand manager saw other brands' numbers in a campaign report, and another
  partner saw a campaign that isn't theirs.
- **[freshness]** A post attached to a campaign didn't show up in the report for ten minutes.
- **[data quality]** During a social API outage, reports showed 0 reach instead of an error.
- **[performance]** Reports for big campaigns (1,000+ posts) time out.

The other tests pass today and must keep passing.

**Stretch, only if you have time left:** the skipped tests at the end of the test file cover two
more issues. Reports also time out when many people open them at once, and numbers jump around
when the social API is flaky. Remove `.skip` to run them.

## Product rules

- A campaign belongs to one partner (an agency or a brand). Only that partner's users may open its
  report.
- Each post in a campaign was made for one brand (`brandId`). Users with `brandIds: null` see every
  post. Brand managers (`brandIds: [11, …]`) only see their brands' posts, and the whole report is
  computed from those posts.
- Post metrics change slowly, so numbers up to 5 minutes old are fine. Campaign changes (posts
  attached or removed) must show up the next time the report is opened.
- We pay for every social API request, so reopening a report within those 5 minutes must not
  request the same metrics again.

The GraphQL gateway calls the resolver with
`{ arguments: { campaignId }, identity: { partnerId, brandIds } }`.

## How the report is computed

- **Reach** of a post: `manualReach` (typed in by the creator) if it's set, otherwise the reach from
  the social API. YouTube doesn't report reach, so views count as reach.
- **Engagements:** Instagram likes + comments + saves; TikTok likes + comments + shares; YouTube
  likes + comments.
- **Engagement rate** = engagements / reach, as a percentage with two decimals (`"7.29%"`), or
  `"n/a"` when reach is 0. For totals, sum first and then divide.

## Social API (`src/social-api.ts`)

| | |
| --- | --- |
| `getMetrics(postId)` | One post per request. |
| `getMetricsBatch(postIds)` | Up to 100 posts per request, returned in the same order. |
| Latency | About 20 ms per request, single or batch. |
| Concurrency | At most 4 requests in flight for our API key, and the whole service shares that key. Extra requests are rejected with 429, and every rejection counts against the key, so stay under the limit rather than retrying into it. |
| Errors | `SocialApiError` with an HTTP-like `status`. 429 and 503 are transient: a request may be tried up to 3 times. 400 and 404 are permanent. |

## Errors (`src/errors.ts`)

Throw `NotFoundError`, `ForbiddenError` or `UpstreamError` (a service we depend on is failing). The
GraphQL layer turns them into client-facing error codes. Any other error reaches the client as a
generic internal error.

## Optional: try the API by hand

`npm run dev` starts the GraphQL API with GraphiQL on port 4000 and restarts it when the code
changes. In StackBlitz, run it in a second terminal (the `+` in the terminal panel), then click the
plug icon ("Ports in use") on the left and choose **Port 4000**. Locally, open
http://localhost:4000/graphql.

Set the user with the `x-partner-id` header (partner 1 owns campaigns 101–110, partner 3 owns
300–306) and, optionally, `x-brand-ids` (for example `11`). Dev-only mutations reproduce the issues:
`attachPost` (the social API knows `tt_1005`), `simulateSocialApiOutage` and
`simulateSocialApiFlakiness`. The server calls `getCampaignReport`, so keep that export working.
