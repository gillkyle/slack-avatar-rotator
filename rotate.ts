#!/usr/bin/env bun
/**
 * Slack avatar rotator
 * Picks the next image from ./images/ (cycles in sorted order) and sets it as your Slack profile photo.
 * Run daily at 9:30am via launchd — see README or the .plist file.
 */

import { readdir, readFile } from "fs/promises";
import { join } from "path";

const SLACK_TOKEN = process.env.SLACK_TOKEN;
if (!SLACK_TOKEN) {
  console.error("SLACK_TOKEN env var is required");
  process.exit(1);
}

const IMAGES_DIR = join(import.meta.dir, "images");
const STATE_FILE = join(import.meta.dir, ".last-index");

async function getSortedImages(): Promise<string[]> {
  const entries = await readdir(IMAGES_DIR);
  return entries
    .filter((f) => /\.(png|jpe?g|gif|webp)$/i.test(f))
    .sort();
}

async function getLastIndex(): Promise<number> {
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    return parseInt(raw.trim(), 10) || 0;
  } catch {
    return -1;
  }
}

async function setSlackPhoto(imagePath: string): Promise<void> {
  const data = await readFile(imagePath);
  const filename = imagePath.split("/").pop()!;
  const ext = filename.split(".").pop()!.toLowerCase();
  const mime = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : "image/jpeg";

  const form = new FormData();
  form.append("image", new Blob([data], { type: mime }), filename);

  const res = await fetch("https://slack.com/api/users.setPhoto", {
    method: "POST",
    headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
    body: form,
  });

  const json = (await res.json()) as { ok: boolean; error?: string };
  if (!json.ok) throw new Error(`Slack API error: ${json.error}`);
}

async function main() {
  const images = await getSortedImages();
  if (images.length === 0) {
    console.error(`No images found in ${IMAGES_DIR}`);
    process.exit(1);
  }

  const lastIndex = await getLastIndex();
  const nextIndex = (lastIndex + 1) % images.length;
  const chosen = join(IMAGES_DIR, images[nextIndex]);

  console.log(`Setting avatar to: ${images[nextIndex]} (${nextIndex + 1}/${images.length})`);
  await setSlackPhoto(chosen);

  await Bun.write(STATE_FILE, String(nextIndex));
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
