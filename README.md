# `@openrol/maps-scrap`

Maps scraping library and CLI built on Playwright.

It is designed to be usable in two ways:

- as a small library with a clean `scrapeMaps()` API
- as a CLI for quick dataset export to `json`, `jsonl`, or `csv`

## Installation

```bash
npm install @openrol/maps-scrap playwright
npx playwright install chromium
```

## Library Usage

```ts
import { scrapeMaps } from "@openrol/maps-scrap";

const result = await scrapeMaps({
  query: "coffee shops in Jakarta",
  limit: 25,
  headless: true,
});

console.log(result.collected);
console.log(result.places[0]);
```

### Reusable scraper instance

```ts
import { createMapsScraper } from "@openrol/maps-scrap";

const scraper = createMapsScraper({
  headless: true,
  language: "en",
  maxScrolls: 80,
});

const restaurants = await scraper.scrape({
  query: "turkish restaurants in toronto",
  limit: 20,
});
```

### Export scraped places

```ts
import { scrapeMaps, writePlaces } from "@openrol/maps-scrap";

const result = await scrapeMaps({
  query: "barber shops in Surabaya",
  limit: 50,
});

await writePlaces(result.places, {
  filePath: "./data/barbers.csv",
});
```

## CLI Usage

```bash
npx maps-scrap --query "coffee shops in Jakarta" --limit 25 --output ./coffee.json
```

### Common examples

```bash
npx maps-scrap --query "gyms in Surabaya" --limit 100 --output ./gyms.csv
npx maps-scrap --query "nail salons in Bali" --limit 50 --output ./nails.jsonl --append
npx maps-scrap --query "restaurants in Bandung" --limit 20 --headed --json
```

## API

### `scrapeMaps(options)`

Main function for scraping map listings.

Important options:

- `query`: search phrase to run in the maps search UI
- `limit`: number of places to collect, default `20`
- `headless`: run with or without a visible browser, default `true`
- `language`: locale hint for Maps UI, default `en`
- `country`: optional country hint
- `maxScrolls`: maximum listing feed scroll passes, default `50`
- `scrollDelayMs`: delay between feed scrolls
- `listingDelayMs`: delay after opening a place detail panel
- `navigationTimeoutMs`: initial page/search timeout
- `detailTimeoutMs`: place detail timeout
- `dedupe`: remove duplicate listings by `name + address`, default `true`
- `logger`: pass your own logger object
- `onProgress`: receive progress callbacks while scraping

Returned shape:

```ts
type MapsScrapeResult = {
  query: string;
  requested: number;
  found: number;
  collected: number;
  durationMs: number;
  places: Place[];
};
```

### `writePlaces(places, options)`

Writes scraped places to disk.

- `filePath`: output location
- `format`: optional `json | jsonl | csv`
- `append`: supported for `json` and `jsonl`

If `format` is omitted, it is inferred from the file extension.

## Extracted fields

Each `Place` contains:

- `name`
- `address`
- `website`
- `phone_number`
- `reviews_count`
- `reviews_average`
- `store_shopping`
- `in_store_pickup`
- `store_delivery`
- `place_type`
- `introduction`

## Publishing

Build the package before publishing:

```bash
bun run build
npm publish --access public
```

## Notes

- Target site markup changes over time. Selector maintenance is part of owning this package.
- Use reasonable scrape volume and pacing to reduce blocking or rate limiting.
- `csv` export currently writes the current run output; append mode is intended for `json` and `jsonl`.

## License

MIT
