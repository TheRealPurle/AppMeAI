# AppMeAI curated catalogue builder

Builds a deduplicated Apple App Store and Google Play seed catalogue from all
categories currently shown on AppMeAI. It does not call Claude or any other AI
API and therefore consumes no Anthropic/OpenAI tokens.

The included manifest contains 414 searches across 12 main categories and 85
subcategories. Apple requests are deliberately kept near 18 per minute; Google
requests use a shared one-request-per-second limiter plus a delay. Do not remove
these limits.

## Recommended first test

Run the GitHub workflow manually with:

- stores: `apple,google`
- query_start: `0`
- query_limit: `5`
- import_after_collect: unchecked

Download the `appmeai-curated-catalogue` artifact and inspect `summary.json` and
`appmeai-catalogue.jsonl`. If the results look relevant, run all 414 queries.

Only select `import_after_collect` after a small test has produced good data.
The existing repository secrets `APPMEAI_API_URL` and
`APPMEAI_IMPORT_TOKEN` are used for the protected import.

## Outputs

- `appmeai-catalogue.jsonl`: one complete app object per line
- `appmeai-catalogue.jsonl.gz`: compressed equivalent
- `summary.json`: counts and failed searches

## Samsung Galaxy Store test

The separate `AppMeAI Galaxy Store collector test` workflow probes Samsung's
public catalogue without changing or importing the production catalogue. Start
with the defaults (4 app categories, 4 game categories and 10 apps per
category), then download the `appmeai-galaxy-test` artifact.

The test writes `appmeai-galaxy-test.jsonl` plus `summary.json`. A successful
test is not permission to run an unlimited scraper: keep the 1.8 second delay,
review Samsung's current terms before scaling, and only add Galaxy Store to the
normal importer after the required database/store mapping exists.

## Important limitations

Apple documents an approximate Search API limit of 20 calls per minute. Google
does not provide an official public catalogue/search API; the Google collector
uses a third-party open-source parser of public store pages. Its use must remain
throttled and should be reviewed against Google's current terms before operating
at larger scale.
