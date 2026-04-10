#!/usr/bin/env node

import { Command } from "commander";
import { createLogger } from "./logger.js";
import { scrapeMaps } from "./scraper.js";
import { detectOutputFormat, writePlaces } from "./storage.js";
import type { OutputFormat } from "./types.js";

const program = new Command();
const logger = createLogger();

program
  .name("maps-scrap")
  .description("Maps scraping CLI for @openrol/maps-scrap")
  .requiredOption("-q, --query <query>", "Search query")
  .option("-l, --limit <number>", "Number of places to collect", "20")
  .option("-o, --output <file>", "Write results to a file")
  .option("-f, --format <format>", "Output format: json, jsonl, csv")
  .option("--append", "Append to the output file when supported", false)
  .option("--headed", "Run the browser with a visible window", false)
  .option("--language <language>", "Maps UI language", "en")
  .option("--country <country>", "Regional hint for the search")
  .option("--max-scrolls <number>", "Maximum listing panel scroll passes", "50")
  .option("--json", "Print the full result payload to stdout", false)
  .parse(process.argv);

const options = program.opts<{
  query: string;
  limit: string;
  output?: string;
  format?: OutputFormat;
  append: boolean;
  headed: boolean;
  language: string;
  country?: string;
  maxScrolls: string;
  json: boolean;
}>();

const limit = Number.parseInt(options.limit, 10);
const maxScrolls = Number.parseInt(options.maxScrolls, 10);

if (!Number.isInteger(limit) || limit < 1) {
  throw new Error("`--limit` must be a positive integer.");
}

if (!Number.isInteger(maxScrolls) || maxScrolls < 1) {
  throw new Error("`--max-scrolls` must be a positive integer.");
}

const result = await scrapeMaps({
  query: options.query,
  limit,
  headless: !options.headed,
  language: options.language,
  country: options.country,
  maxScrolls,
  logger,
  onProgress: ({ found, scraped, message }) => {
    logger.info?.(`${message} (${scraped}/${limit}, found=${found})`);
  },
});

if (options.output) {
  const format = options.format ?? detectOutputFormat(options.output);
  const writeResult = await writePlaces(result.places, {
    filePath: options.output,
    format,
    append: options.append,
  });
  logger.info?.(
    `Wrote ${writeResult.count} places to ${writeResult.filePath} as ${writeResult.format}`,
  );
}

if (options.json || !options.output) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
