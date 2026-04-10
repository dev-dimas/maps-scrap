import type { BrowserContextOptions, LaunchOptions } from "playwright";

export type Availability = "Yes" | "No";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type OutputFormat = "json" | "jsonl" | "csv";

export interface Place {
  name: string;
  address: string;
  website: string;
  phone_number: string;
  reviews_count: number | null;
  reviews_average: number | null;
  store_shopping: Availability;
  in_store_pickup: Availability;
  store_delivery: Availability;
  place_type: string;
  introduction: string;
}

export interface MapsScrapeProgress {
  query: string;
  requested: number;
  found: number;
  scraped: number;
  currentPlaceName?: string;
  message: string;
}

export interface MapsScrapeResult {
  query: string;
  requested: number;
  found: number;
  collected: number;
  durationMs: number;
  places: Place[];
}

export interface LoggerLike {
  debug?(message: string): void;
  info?(message: string): void;
  warn?(message: string): void;
  error?(message: string): void;
}

export interface MapsScrapeOptions {
  query: string;
  limit?: number;
  headless?: boolean;
  language?: string;
  country?: string;
  userAgent?: string;
  launchOptions?: LaunchOptions;
  contextOptions?: BrowserContextOptions;
  maxScrolls?: number;
  scrollDelayMs?: number;
  listingDelayMs?: number;
  navigationTimeoutMs?: number;
  detailTimeoutMs?: number;
  dedupe?: boolean;
  logger?: LoggerLike;
  onProgress?: (progress: MapsScrapeProgress) => void | Promise<void>;
}

export interface WritePlacesOptions {
  filePath: string;
  format?: OutputFormat;
  append?: boolean;
}

export interface CreateMapsScraperOptions extends Omit<MapsScrapeOptions, "query"> {}
