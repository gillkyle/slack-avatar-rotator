#!/usr/bin/env bun

import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "fs/promises";
import { join, relative } from "path";
import { tmpdir } from "os";
import { spawn } from "child_process";

const SOURCE_REPO = "https://github.com/PMDCollab/SpriteCollab.git";
const SOURCE_WEB = "https://sprites.pmdcollab.org/";
const RAW_BASE = "https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master";
const OUTPUT_DIR = join(import.meta.dir, "..", "image-libraries", "pmdcollab-pokemon-profile-avatars");

type ManifestItem = {
  file: string;
  sourcePath: string;
  sourceUrl: string;
};

function run(command: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
  });
}

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walkFiles(path) : [path];
    }),
  );

  return files.flat();
}

function avatarFileName(sourcePath: string): string {
  return `${sourcePath
    .replace(/^portrait\//, "")
    .replace(/\/Normal\.png$/, "")
    .replace(/\//g, "-")}.png`;
}

async function cleanOutputDir(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });

  for (const entry of await readdir(OUTPUT_DIR)) {
    await rm(join(OUTPUT_DIR, entry), { force: true, recursive: true });
  }
}

async function clonePortraits(tempDir: string): Promise<string> {
  const repoDir = join(tempDir, "SpriteCollab");

  await run("git", [
    "clone",
    "--depth",
    "1",
    "--filter=blob:none",
    "--sparse",
    SOURCE_REPO,
    repoDir,
  ]);
  await run("git", ["sparse-checkout", "set", "portrait"], repoDir);

  return repoDir;
}

export async function downloadPmdCollabProfileAvatars(): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), "pmdcollab-sprites-"));

  try {
    const repoDir = await clonePortraits(tempDir);
    const portraitDir = join(repoDir, "portrait");
    const allFiles = await walkFiles(portraitDir);
    const normalPortraits = allFiles
      .map((file) => relative(repoDir, file))
      .filter((file) => /(^|\/)Normal\.png$/.test(file))
      .sort();

    if (normalPortraits.length === 0) {
      throw new Error("No PMD Collab Normal.png portrait avatars found");
    }

    await cleanOutputDir();

    const items: ManifestItem[] = [];

    for (const sourcePath of normalPortraits) {
      const file = avatarFileName(sourcePath);

      await cp(join(repoDir, sourcePath), join(OUTPUT_DIR, file));
      items.push({
        file,
        sourcePath,
        sourceUrl: `${RAW_BASE}/${sourcePath}`,
      });
    }

    await writeFile(
      join(OUTPUT_DIR, "MANIFEST.json"),
      `${JSON.stringify(
        {
          source: SOURCE_WEB,
          sourceRepository: SOURCE_REPO,
          asset: "portrait Normal.png",
          downloadedAt: new Date().toISOString(),
          count: items.length,
          items,
        },
        null,
        2,
      )}\n`,
    );

    console.log(`Downloaded ${items.length} PMD Collab profile avatars to ${OUTPUT_DIR}`);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

if (import.meta.main) {
  downloadPmdCollabProfileAvatars().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
