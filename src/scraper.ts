import { chromium, type Page } from "playwright";
import { SELECTORS } from "./selectors.js";
import { createLogger } from "./logger.js";
import type {
  CreateMapsScraperOptions,
  LoggerLike,
  MapsScrapeOptions,
  MapsScrapeProgress,
  MapsScrapeResult,
  Place,
} from "./types.js";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MAPS_BASE_URL = `https://www.google.com/maps`;

const DEFAULT_OPTIONS = {
  limit: 20,
  headless: true,
  language: "en",
  maxScrolls: 50,
  scrollDelayMs: 2000,
  listingDelayMs: 1500,
  navigationTimeoutMs: 60_000,
  detailTimeoutMs: 12_000,
  dedupe: true,
} satisfies Omit<
  Required<CreateMapsScraperOptions>,
  | "logger"
  | "onProgress"
  | "launchOptions"
  | "contextOptions"
  | "country"
  | "userAgent"
>;

function resolveLogger(logger?: LoggerLike): LoggerLike {
  return logger ?? createLogger();
}

function createPlaceKey(place: Place): string {
  return `${place.name.toLowerCase()}|${place.address.toLowerCase()}`;
}

async function extractText(page: Page, selector: string): Promise<string> {
  try {
    const locator = page.locator(selector);
    if ((await locator.count()) > 0) {
      return (await locator.first().innerText()) ?? "";
    }
  } catch {
    return "";
  }

  return "";
}

async function extractServiceFlags(
  page: Page,
): Promise<
  Pick<Place, "store_shopping" | "in_store_pickup" | "store_delivery">
> {
  const defaults: Pick<
    Place,
    "store_shopping" | "in_store_pickup" | "store_delivery"
  > = {
    store_shopping: "No",
    in_store_pickup: "No",
    store_delivery: "No",
  };

  try {
    const serviceLabels = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".LTs0Rc"))
        .map((element) =>
          (element.getAttribute("aria-label") ?? "").toLowerCase(),
        )
        .filter(Boolean);
    });

    return serviceLabels.reduce(
      (flags, label) => {
        if (label.includes("shopping") || label.includes("in-store shop")) {
          flags.store_shopping = "Yes";
        }
        if (label.includes("pickup") || label.includes("in-store pickup")) {
          flags.in_store_pickup = "Yes";
        }
        if (
          label.includes("delivery") ||
          label.includes("no-contact delivery")
        ) {
          flags.store_delivery = "Yes";
        }
        return flags;
      },
      { ...defaults },
    );
  } catch {
    return defaults;
  }
}

function parseReviewCount(value: string): number | null {
  if (!value) {
    return null;
  }

  const cleaned = value.replace(/[\xa0(),\s]/g, "").trim();
  const parsed = Number.parseInt(cleaned, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseReviewAverage(value: string): number | null {
  if (!value) {
    return null;
  }

  const cleaned = value.replace(/\s/g, "").replace(",", ".");
  const parsed = Number.parseFloat(cleaned);
  return Number.isNaN(parsed) ? null : parsed;
}

async function extractPlace(page: Page): Promise<Place> {
  const [
    name,
    address,
    website,
    phoneNumber,
    placeType,
    introRaw,
    reviewsAvgRaw,
    reviewsCountRaw,
    serviceFlags,
  ] = await Promise.all([
    extractText(page, SELECTORS.name),
    extractText(page, SELECTORS.address),
    extractText(page, SELECTORS.website),
    extractText(page, SELECTORS.phone),
    extractText(page, SELECTORS.placeType),
    extractText(page, SELECTORS.intro),
    extractText(page, SELECTORS.reviewsAvg),
    extractText(page, SELECTORS.reviewsCount),
    extractServiceFlags(page),
  ]);

  return {
    name: name.trim(),
    address: address.trim(),
    website: website.trim(),
    phone_number: phoneNumber.trim(),
    place_type: placeType.trim(),
    introduction: introRaw.trim() || "None Found",
    reviews_count: parseReviewCount(reviewsCountRaw),
    reviews_average: parseReviewAverage(reviewsAvgRaw),
    ...serviceFlags,
  };
}

async function dismissConsent(page: Page, logger: LoggerLike): Promise<void> {
  const consentSelectors = [
    'form[action*="consent"] button',
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("Agree")',
    'button:has-text("Terima semua")',
    'button:has-text("Setuju")',
    'button:has-text("Acepto todo")',
    'button:has-text("Tout accepter")',
    'button:has-text("Alle akzeptieren")',
  ];

  for (const selector of consentSelectors) {
    try {
      const button = page.locator(selector);
      if ((await button.count()) > 0) {
        logger.debug?.(`Dismissing consent with selector: ${selector}`);
        await button.first().click();
        await page.waitForTimeout(1500);
        return;
      }
    } catch {
      continue;
    }
  }
}

async function emitProgress(
  callback: MapsScrapeOptions["onProgress"],
  progress: MapsScrapeProgress,
): Promise<void> {
  if (callback) {
    await callback(progress);
  }
}

export async function scrapeMaps(
  input: MapsScrapeOptions,
): Promise<MapsScrapeResult> {
  const startedAt = Date.now();
  const options = { ...DEFAULT_OPTIONS, ...input };
  const logger = resolveLogger(options.logger);

  if (!options.query?.trim()) {
    throw new Error("`query` is required.");
  }

  if (options.limit < 1) {
    throw new Error("`limit` must be greater than 0.");
  }

  logger.info?.(`Starting maps scrape for "${options.query}"`);

  const browser = await chromium.launch({
    headless: options.headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
    ...options.launchOptions,
  });

  const context = await browser.newContext({
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
    locale: options.language,
    viewport: { width: 1440, height: 960 },
    ...options.contextOptions,
    extraHTTPHeaders: {
      ...(options.language ? { "Accept-Language": options.language } : {}),
      ...options.contextOptions?.extraHTTPHeaders,
    },
  });

  const page = await context.newPage();
  const places: Place[] = [];
  const seen = new Set<string>();
  let found = 0;

  try {
    const mapsUrl = new URL(MAPS_BASE_URL);
    if (options.language) {
      mapsUrl.searchParams.set("hl", options.language);
    }
    if (options.country) {
      mapsUrl.searchParams.set("gl", options.country);
    }

    await page.goto(mapsUrl.toString(), {
      timeout: options.navigationTimeoutMs,
    });
    await page.waitForLoadState("domcontentloaded");
    await dismissConsent(page, logger);

    const searchBoxSelector =
      'input[role="combobox"], input#searchboxinput, input[aria-label*="Search"], input[aria-label*="Cari"]';

    await page.waitForSelector(searchBoxSelector, {
      timeout: options.navigationTimeoutMs,
    });

    const searchBox = page.locator(searchBoxSelector).first();
    await searchBox.click();
    await searchBox.fill(options.query);
    await page.keyboard.press("Enter");

    await page.waitForSelector(SELECTORS.listings, {
      timeout: options.navigationTimeoutMs,
    });

    let previousCount = 0;
    for (
      let scrollCount = 0;
      scrollCount < options.maxScrolls;
      scrollCount += 1
    ) {
      await page.evaluate(() => {
        const feed =
          document.querySelector('[role="feed"]') ??
          document.querySelector(".m6QErb[aria-label]") ??
          document.querySelector(".m6QErb");

        if (feed instanceof HTMLElement) {
          feed.scrollTop = feed.scrollHeight;
        }
      });

      await page.waitForTimeout(options.scrollDelayMs);
      found = await page.locator(SELECTORS.listings).count();

      await emitProgress(options.onProgress, {
        query: options.query,
        requested: options.limit,
        found,
        scraped: places.length,
        message: `Discovered ${found} listings`,
      });

      if (found >= options.limit || found === previousCount) {
        break;
      }

      previousCount = found;
    }

    found = await page.locator(SELECTORS.listings).count();
    const target = Math.min(found, options.limit);

    for (let index = 0; index < target; index += 1) {
      const listing = page.locator(SELECTORS.listings).nth(index);

      try {
        await listing.scrollIntoViewIfNeeded();
        await listing.click();
        await page.waitForSelector(SELECTORS.name, {
          timeout: options.detailTimeoutMs,
        });
        await page.waitForTimeout(options.listingDelayMs);

        const place = await extractPlace(page);
        if (!place.name) {
          logger.warn?.(`Skipping result ${index + 1}; name not found.`);
          continue;
        }

        const key = createPlaceKey(place);
        if (options.dedupe && seen.has(key)) {
          logger.debug?.(`Skipping duplicate ${place.name}`);
          continue;
        }

        seen.add(key);
        places.push(place);

        await emitProgress(options.onProgress, {
          query: options.query,
          requested: options.limit,
          found,
          scraped: places.length,
          currentPlaceName: place.name,
          message: `Scraped ${place.name}`,
        });
      } catch (error) {
        logger.warn?.(
          `Failed to scrape listing ${index + 1}: ${(error as Error).message}`,
        );
      }
    }
  } finally {
    await browser.close();
  }

  return {
    query: options.query,
    requested: options.limit,
    found,
    collected: places.length,
    durationMs: Date.now() - startedAt,
    places,
  };
}

export function createMapsScraper(
  defaultOptions: CreateMapsScraperOptions = {},
) {
  return {
    scrape(options: MapsScrapeOptions) {
      return scrapeMaps({ ...defaultOptions, ...options });
    },
  };
}
