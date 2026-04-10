import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname } from "node:path";
import { writeToPath } from "@fast-csv/format";
import { createLogger } from "./logger.js";
import type { OutputFormat, Place, WritePlacesOptions } from "./types.js";

const defaultLogger = createLogger();

function createPlaceKey(place: Place): string {
  return `${place.name.toLowerCase()}|${place.address.toLowerCase()}`;
}

function ensureDirectory(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function dedupePlaces(places: Place[]): Place[] {
  const seen = new Set<string>();
  return places.filter((place) => {
    const key = createPlaceKey(place);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function detectOutputFormat(filePath: string): OutputFormat {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".csv") {
    return "csv";
  }
  if (extension === ".jsonl" || extension === ".ndjson") {
    return "jsonl";
  }
  return "json";
}

async function writeJson(places: Place[], filePath: string, append: boolean): Promise<number> {
  let final = places;

  if (append && existsSync(filePath)) {
    try {
      const existing = JSON.parse(readFileSync(filePath, "utf8")) as Place[];
      final = dedupePlaces([...existing, ...places]);
    } catch {
      defaultLogger.warn?.("Existing JSON could not be parsed. Rewriting file.");
    }
  }

  writeFileSync(filePath, JSON.stringify(final, null, 2), "utf8");
  return final.length;
}

async function writeJsonl(places: Place[], filePath: string, append: boolean): Promise<number> {
  let final = places;

  if (append && existsSync(filePath)) {
    const existing = readFileSync(filePath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Place];
        } catch {
          return [];
        }
      });
    final = dedupePlaces([...existing, ...places]);
  }

  writeFileSync(
    filePath,
    `${final.map((place) => JSON.stringify(place)).join("\n")}\n`,
    "utf8",
  );
  return final.length;
}

async function writeCsv(places: Place[], filePath: string): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    writeToPath(filePath, places, { headers: true })
      .on("finish", resolve)
      .on("error", reject);
  });
  return places.length;
}

export async function writePlaces(
  places: Place[],
  options: WritePlacesOptions,
): Promise<{ filePath: string; format: OutputFormat; count: number }> {
  const format = options.format ?? detectOutputFormat(options.filePath);
  ensureDirectory(options.filePath);

  if (places.length === 0) {
    return { filePath: options.filePath, format, count: 0 };
  }

  const append = options.append ?? false;
  let count: number;

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
