#!/usr/bin/env bun

import { mkdir, readdir, unlink, writeFile } from "fs/promises";
import { extname, join } from "path";

const MAX_PAGES = 30;

const DEX_CONFIGS = {
  rse: {
    label: "RSE ShinyDex",
    sourcePage: "https://www.projectshinydex.com/ruby-sapphire-and-emerald",
    gridPageParam: "comp-lxyyx8y9_page",
    datasetId: "comp-lxyyx8y9",
    collectionId: "RSE",
    outputDir: "image-libraries/shiny-pokemon-rse-front",
    nameFields: ["pokemon"],
  },
  frlg: {
    label: "FRLG ShinyDex",
    sourcePage: "https://www.projectshinydex.com/fire-red-and-leaf-green",
    gridPageParam: "comp-lxj6qk0z_page",
    datasetId: "comp-lxj6qk0z",
    collectionId: "FRLG",
    outputDir: "image-libraries/shiny-pokemon-frlg-front",
    nameFields: ["title1", "pokemon"],
  },
} as const;

type DexKey = keyof typeof DEX_CONFIGS;
type DexConfig = (typeof DEX_CONFIGS)[DexKey];

type WixImageObject = {
  uri: string;
  width?: number;
  height?: number;
  title?: string;
  name?: string;
};

type ShinyDexRecord = {
  _id: string;
  number: string;
  frontShiny?: string | WixImageObject;
  [key: string]: unknown;
};

type ManifestItem = {
  number: string;
  pokemon: string;
  file: string;
  sourceUrl: string;
};

type DataStore = {
  recordInfosByDatasetId?: Record<
    string,
    {
      datasetSize?: {
        total?: number;
      };
    }
  >;
  recordsByCollectionId?: Record<string, Record<string, ShinyDexRecord>>;
};

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "slack-avatar-archive/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function pageUrl(config: DexConfig, page: number): string {
  const url = new URL(config.sourcePage);
  url.searchParams.set(config.gridPageParam, String(page));
  return url.toString();
}

function parseWarmupData(html: string): unknown {
  const match = html.match(
    /<script type="application\/json" id="wix-warmup-data">([\s\S]*?)<\/script>/,
  );

  if (!match) {
    throw new Error("Could not find Wix warmup data in page HTML");
  }

  return JSON.parse(match[1]);
}

function getDataStore(source: unknown): DataStore | undefined {
  type WarmupData = {
    appsWarmupData?: {
      dataBinding?: {
        dataStore?: DataStore;
      };
    };
    pages?: {
      appsWarmupData?: WarmupData["appsWarmupData"];
    };
  };

  const root = source as WarmupData;

  return (
    root.appsWarmupData?.dataBinding?.dataStore ??
    root.pages?.appsWarmupData?.dataBinding?.dataStore
  );
}

function getNestedRecord(
  source: unknown,
  config: DexConfig,
): {
  records: Record<string, ShinyDexRecord>;
  reportedTotal?: number;
} {
  const dataStore = getDataStore(source);

  return {
    records: dataStore?.recordsByCollectionId?.[config.collectionId] ?? {},
    reportedTotal: dataStore?.recordInfosByDatasetId?.[config.datasetId]?.datasetSize?.total,
  };
}

async function loadRecords(
  config: DexConfig,
): Promise<{ records: ShinyDexRecord[]; reportedTotal?: number }> {
  const byId = new Map<string, ShinyDexRecord>();
  let reportedTotal: number | undefined;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const html = await fetchText(pageUrl(config, page));
    const parsed = getNestedRecord(parseWarmupData(html), config);
    reportedTotal ??= parsed.reportedTotal;

    const pageRecords = Object.values(parsed.records);
    if (pageRecords.length === 0) {
      break;
    }

    for (const record of pageRecords) {
      byId.set(record._id, record);
    }

    console.log(`Loaded page ${page}: ${pageRecords.length} rows`);
  }

  return {
    records: [...byId.values()].sort(
      (a, b) => Number.parseInt(a.number, 10) - Number.parseInt(b.number, 10),
    ),
    reportedTotal,
  };
}

function wixMediaUrl(image: string | WixImageObject): string {
  if (typeof image === "object") {
    return `https://static.wixstatic.com/media/${image.uri}`;
  }

  const match = image.match(/^wix:image:\/\/v1\/([^/]+)\//);
  if (!match) {
    throw new Error(`Unsupported Wix image value: ${image}`);
  }

  return `https://static.wixstatic.com/media/${match[1]}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function recordName(record: ShinyDexRecord, config: DexConfig): string {
  for (const field of config.nameFields) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  throw new Error(`No Pokemon name found for record ${record._id}`);
}

async function cleanOutputDir(outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });

  for (const entry of await readdir(outputDir)) {
    if (/\.(png|jpe?g|gif|webp)$/i.test(entry)) {
      await unlink(join(outputDir, entry));
    }
  }
}

async function downloadImage(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  await writeFile(outputPath, new Uint8Array(await response.arrayBuffer()));
}

export async function downloadShinyDex(configKey: DexKey): Promise<void> {
  const config = DEX_CONFIGS[configKey];
  if (!config) {
    throw new Error(`Unknown dex config "${configKey}". Use one of: ${Object.keys(DEX_CONFIGS)}`);
  }

  const outputDir = join(import.meta.dir, "..", config.outputDir);
  const manifestFile = join(outputDir, "MANIFEST.json");
  const { records, reportedTotal } = await loadRecords(config);

  if (records.length === 0) {
    throw new Error(`No ${config.label} rows found`);
  }

  console.log(
    `Found ${records.length} visible ${config.label} rows` +
      (reportedTotal ? ` (site dataset reports ${reportedTotal})` : ""),
  );

  await cleanOutputDir(outputDir);

  const items: ManifestItem[] = [];
  const skipped = records
    .filter((record) => !record.frontShiny)
    .map((record) => ({
      number: record.number,
      pokemon: recordName(record, config),
      reason: "missing frontShiny asset",
    }));

  if (skipped.length > 0) {
    console.log(
      `Skipping ${skipped.length} rows without front shiny assets: ` +
        skipped.map((record) => `${record.number} ${record.pokemon}`).join(", "),
    );
  }

  for (const record of records) {
    if (!record.frontShiny) continue;

    const pokemon = recordName(record, config);
    const sourceUrl = wixMediaUrl(record.frontShiny);
    const ext = extname(new URL(sourceUrl).pathname) || ".png";
    const file = `${record.number.padStart(3, "0")}-${slugify(pokemon)}${ext}`;

    await downloadImage(sourceUrl, join(outputDir, file));
    items.push({
      number: record.number,
      pokemon,
      file,
      sourceUrl,
    });
  }

  await writeFile(
    manifestFile,
    `${JSON.stringify(
      {
        source: config.sourcePage,
        asset: "frontShiny",
        downloadedAt: new Date().toISOString(),
        reportedTotal,
        count: items.length,
        skipped,
        items,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`Downloaded ${items.length} front shiny sprites to ${outputDir}`);
}

if (import.meta.main) {
  const configKey = (Bun.argv[2] ?? "rse") as DexKey;

  downloadShinyDex(configKey).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
