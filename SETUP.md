# AppMeUp corrected deployment

## 1. Update Supabase

Open the Supabase SQL Editor and run `supabase_setup.sql`. The script can be
run again on an existing AppMeUp project. It adds the previously missing
`rating_count` and `downloads` columns, installs the public search function,
and restores the intended read/write policies.

Never put the Supabase service-role key in the HTML. It belongs only in the
scheduled worker environment.

## 2. Configure the public HTML

In `AppMeUp (60).html`, replace:

- `YOUR_SUPABASE_URL` with the project URL.
- `YOUR_SUPABASE_ANON_KEY` with the public anon/publishable key.

The anon key is designed to be used by public clients and is restricted by
Row Level Security. Do not replace it with the service-role key. Upload the
configured HTML to Netlify.

The browser now calls `search_apps` in Supabase. It never calls Anthropic and
never stores an Anthropic key.

## 3. Deploy the refresh job

Put these files in one private Git repository:

- `refresh_worker.js`
- `package.json`
- `package-lock.json`
- `render.yaml`

Create a Render Blueprint from the repository. Set the three secret variables
when prompted:

- `ANTHROPIC_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

`render.yaml` invokes the job hourly in UTC. The script exits without making an
API call except at 08:00, 11:00, 14:00, and 17:00 Copenhagen time. This keeps
the four-refresh schedule correct across daylight-saving changes.

For a manual test, temporarily set `FORCE_REFRESH=true`, trigger one run, then
remove that variable. A successful run prints the number of updated apps and
writes a row to `refresh_log`.

## Cost estimator

Press `Ctrl+Shift+O` on the page to reveal the owner tools and calculator.
Replace every default with actual data from your ad, affiliate, Anthropic, and
hosting dashboards.

The formulas are:

    monthly ad revenue = visitors/day × pageviews/visitor × ad slots/page
                       × fill rate × viewability × CPM / 1000 × 365.25/12

    monthly affiliate revenue = visitors/day × conversion rate
                              × commission/conversion × 365.25/12

    API cost/refresh = input tokens × input rate / 1,000,000
                     + output tokens × output rate / 1,000,000
                     + web searches × web-search price

    monthly net = ads + affiliates + sponsors + newsletter
                - API cost - hosting/tools

Revenue is an estimate, not a guarantee. In particular, ad slots are not the
same as paid impressions: fill rate and viewability reduce monetized inventory.
