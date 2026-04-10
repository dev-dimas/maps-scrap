#!/usr/bin/env node

// src/cli.ts
import { Command } from "commander";

// src/logger.ts
var COLORS = {
  debug: "\x1B[36m",
  info: "\x1B[32m",
  warn: "\x1B[33m",
  error: "\x1B[31m"
};
function createLogger(prefix = "@openrol/maps-scrap") {
  const write = (level, message) => {
    const ts = new Date().toISOString();
    const color = COLORS[level];
    process.stderr.write(`${ts} ${color}[${prefix}:${level.toUpperCase()}]\x1B[0m ${message}
`);
  };
  return {
    debug: (message) => write("debug", message),
    info: (message) => write("info", message),
    warn: (message) => write("warn", message),
    error: (message) => write("error", message)
  };
}

// src/scraper.ts
import { chromium } from "playwright";

// src/selectors.ts
var SELECTORS = {
  name: '//h1[contains(@class,"DUwDvf")]',
  address: '//button[@data-item-id="address"]//div[contains(@class,"fontBodyMedium")]',
  website: '//a[@data-item-id="authority"]//div[contains(@class,"fontBodyMedium")]',
  phone: '//button[contains(@data-item-id,"phone:tel:")]//div[contains(@class,"fontBodyMedium")]',
  reviewsAvg: '//span[contains(@class,"MW4etd")]',
  reviewsCount: '//span[@aria-label[contains(.,"reviews") or contains(.,"ulasan") or contains(.,"Reviews")]]',
  serviceOptions: '//div[contains(@class,"LTs0Rc")]',
  placeType: '//button[contains(@class,"DkEaL")]',
  intro: '//div[contains(@class,"PYvSYb")]',
  listings: '//a[contains(@class,"hfpxzc")]'
};

// src/scraper.ts
var DEFAULT_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var MAPS_BASE_URL = `https://www.google.com/maps`;
var DEFAULT_OPTIONS = {
  limit: 20,
  headless: true,
  language: "en",
  maxScrolls: 50,
  scrollDelayMs: 2000,
  listingDelayMs: 1500,
  navigationTimeoutMs: 60000,
  detailTimeoutMs: 12000,
  dedupe: true
};
function resolveLogger(logger) {
  return logger ?? createLogger();
}
function createPlaceKey(place) {
  return `${place.name.toLowerCase()}|${place.address.toLowerCase()}`;
}
async function extractText(page, selector) {
  try {
    const locator = page.locator(selector);
    if (await locator.count() > 0) {
      return await locator.first().innerText() ?? "";
    }
  } catch {
    return "";
  }
  return "";
}
async function extractServiceFlags(page) {
  const defaults = {
    store_shopping: "No",
    in_store_pickup: "No",
    store_delivery: "No"
  };
  try {
    const serviceLabels = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".LTs0Rc")).map((element) => (element.getAttribute("aria-label") ?? "").toLowerCase()).filter(Boolean);
    });
    return serviceLabels.reduce((flags, label) => {
      if (label.includes("shopping") || label.includes("in-store shop")) {
        flags.store_shopping = "Yes";
      }
      if (label.includes("pickup") || label.includes("in-store pickup")) {
        flags.in_store_pickup = "Yes";
      }
      if (label.includes("delivery") || label.includes("no-contact delivery")) {
        flags.store_delivery = "Yes";
      }
      return flags;
    }, { ...defaults });
  } catch {
    return defaults;
  }
}
function parseReviewCount(value) {
  if (!value) {
    return null;
  }
  const cleaned = value.replace(/[\xa0(),\s]/g, "").trim();
  const parsed = Number.parseInt(cleaned, 10);
  return Number.isNaN(parsed) ? null : parsed;
}
function parseReviewAverage(value) {
  if (!value) {
    return null;
  }
  const cleaned = value.replace(/\s/g, "").replace(",", ".");
  const parsed = Number.parseFloat(cleaned);
  return Number.isNaN(parsed) ? null : parsed;
}
async function extractPlace(page) {
  const [
    name,
    address,
    website,
    phoneNumber,
    placeType,
    introRaw,
    reviewsAvgRaw,
    reviewsCountRaw,
    serviceFlags
  ] = await Promise.all([
    extractText(page, SELECTORS.name),
    extractText(page, SELECTORS.address),
    extractText(page, SELECTORS.website),
    extractText(page, SELECTORS.phone),
    extractText(page, SELECTORS.placeType),
    extractText(page, SELECTORS.intro),
    extractText(page, SELECTORS.reviewsAvg),
    extractText(page, SELECTORS.reviewsCount),
    extractServiceFlags(page)
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
    ...serviceFlags
  };
}
async function dismissConsent(page, logger) {
  const consentSelectors = [
    'form[action*="consent"] button',
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("Agree")',
    'button:has-text("Terima semua")',
    'button:has-text("Setuju")',
    'button:has-text("Acepto todo")',
    'button:has-text("Tout accepter")',
    'button:has-text("Alle akzeptieren")'
  ];
  for (const selector of consentSelectors) {
    try {
      const button = page.locator(selector);
      if (await button.count() > 0) {
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
async function emitProgress(callback, progress) {
  if (callback) {
    await callback(progress);
  }
}
async function scrapeMaps(input) {
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
      "--disable-dev-shm-usage"
    ],
    ...options.launchOptions
  });
  const context = await browser.newContext({
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
    locale: options.language,
    viewport: { width: 1440, height: 960 },
    ...options.contextOptions,
    extraHTTPHeaders: {
      ...options.language ? { "Accept-Language": options.language } : {},
      ...options.contextOptions?.extraHTTPHeaders
    }
  });
  const page = await context.newPage();
  const places = [];
  const seen = new Set;
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
      timeout: options.navigationTimeoutMs
    });
    await page.waitForLoadState("domcontentloaded");
    await dismissConsent(page, logger);
    const searchBoxSelector = 'input[role="combobox"], input#searchboxinput, input[aria-label*="Search"], input[aria-label*="Cari"]';
    await page.waitForSelector(searchBoxSelector, {
      timeout: options.navigationTimeoutMs
    });
    const searchBox = page.locator(searchBoxSelector).first();
    await searchBox.click();
    await searchBox.fill(options.query);
    await page.keyboard.press("Enter");
    await page.waitForSelector(SELECTORS.listings, {
      timeout: options.navigationTimeoutMs
    });
    let previousCount = 0;
    for (let scrollCount = 0;scrollCount < options.maxScrolls; scrollCount += 1) {
      await page.evaluate(() => {
        const feed = document.querySelector('[role="feed"]') ?? document.querySelector(".m6QErb[aria-label]") ?? document.querySelector(".m6QErb");
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
        message: `Discovered ${found} listings`
      });
      if (found >= options.limit || found === previousCount) {
        break;
      }
      previousCount = found;
    }
    found = await page.locator(SELECTORS.listings).count();
    const target = Math.min(found, options.limit);
    for (let index = 0;index < target; index += 1) {
      const listing = page.locator(SELECTORS.listings).nth(index);
      try {
        await listing.scrollIntoViewIfNeeded();
        await listing.click();
        await page.waitForSelector(SELECTORS.name, {
          timeout: options.detailTimeoutMs
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
          message: `Scraped ${place.name}`
        });
      } catch (error) {
        logger.warn?.(`Failed to scrape listing ${index + 1}: ${error.message}`);
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
    places
  };
}

// src/storage.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname } from "node:path";
import { writeToPath } from "@fast-csv/format";
var defaultLogger = createLogger();
function createPlaceKey2(place) {
  return `${place.name.toLowerCase()}|${place.address.toLowerCase()}`;
}
function ensureDirectory(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}
function dedupePlaces(places) {
  const seen = new Set;
  return places.filter((place) => {
    const key = createPlaceKey2(place);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
function detectOutputFormat(filePath) {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".csv") {
    return "csv";
  }
  if (extension === ".jsonl" || extension === ".ndjson") {
    return "jsonl";
  }
  return "json";
}
async function writeJson(places, filePath, append) {
  let final = places;
  if (append && existsSync(filePath)) {
    try {
      const existing = JSON.parse(readFileSync(filePath, "utf8"));
      final = dedupePlaces([...existing, ...places]);
    } catch {
      defaultLogger.warn?.("Existing JSON could not be parsed. Rewriting file.");
    }
  }
  writeFileSync(filePath, JSON.stringify(final, null, 2), "utf8");
  return final.length;
}
async function writeJsonl(places, filePath, append) {
  let final = places;
  if (append && existsSync(filePath)) {
    const existing = readFileSync(filePath, "utf8").split(`
`).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
    final = dedupePlaces([...existing, ...places]);
  }
  writeFileSync(filePath, `${final.map((place) => JSON.stringify(place)).join(`
`)}
`, "utf8");
  return final.length;
}
async function writeCsv(places, filePath) {
  await new Promise((resolve, reject) => {
    writeToPath(filePath, places, { headers: true }).on("finish", resolve).on("error", reject);
  });
  return places.length;
}
async function writePlaces(places, options) {
  const format = options.format ?? detectOutputFormat(options.filePath);
  ensureDirectory(options.filePath);
  if (places.length === 0) {
    return { filePath: options.filePath, format, count: 0 };
  }
  const append = options.append ?? false;
  let count;
  switch (format) {
    case "csv":
      count = await writeCsv(append ? dedupePlaces(places) : places, options.filePath);
      break;
    case "jsonl":
      count = await writeJsonl(places, options.filePath, append);
      break;
    case "json":
    default:
      count = await writeJson(places, options.filePath, append);
      break;
  }
  return { filePath: options.filePath, format, count };
}

// src/cli.ts
var program = new Command;
var logger = createLogger();
program.name("maps-scrap").description("Maps scraping CLI for @openrol/maps-scrap").requiredOption("-q, --query <query>", "Search query").option("-l, --limit <number>", "Number of places to collect", "20").option("-o, --output <file>", "Write results to a file").option("-f, --format <format>", "Output format: json, jsonl, csv").option("--append", "Append to the output file when supported", false).option("--headed", "Run the browser with a visible window", false).option("--language <language>", "Maps UI language", "en").option("--country <country>", "Regional hint for the search").option("--max-scrolls <number>", "Maximum listing panel scroll passes", "50").option("--json", "Print the full result payload to stdout", false).parse(process.argv);
var options = program.opts();
var limit = Number.parseInt(options.limit, 10);
var maxScrolls = Number.parseInt(options.maxScrolls, 10);
if (!Number.isInteger(limit) || limit < 1) {
  throw new Error("`--limit` must be a positive integer.");
}
if (!Number.isInteger(maxScrolls) || maxScrolls < 1) {
  throw new Error("`--max-scrolls` must be a positive integer.");
}
var result = await scrapeMaps({
  query: options.query,
  limit,
  headless: !options.headed,
  language: options.language,
  country: options.country,
  maxScrolls,
  logger,
  onProgress: ({ found, scraped, message }) => {
    logger.info?.(`${message} (${scraped}/${limit}, found=${found})`);
  }
});
if (options.output) {
  const format = options.format ?? detectOutputFormat(options.output);
  const writeResult = await writePlaces(result.places, {
    filePath: options.output,
    format,
    append: options.append
  });
  logger.info?.(`Wrote ${writeResult.count} places to ${writeResult.filePath} as ${writeResult.format}`);
}
if (options.json || !options.output) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
}
