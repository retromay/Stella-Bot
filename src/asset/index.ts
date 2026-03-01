import path from "node:path";

const ASSET_DIR = path.join(__dirname);

export const assets = {
  bonkExplosion: path.join(ASSET_DIR, "bonk-explosion.gif"),
  spongebobJail: path.join(ASSET_DIR, "Pilakujail.png"),
} as const;
