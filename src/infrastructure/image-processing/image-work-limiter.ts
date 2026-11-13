import sharp from "sharp";

/**
 * Photo work (opening and resizing a product photo, building a thumbnail) is the heaviest thing
 * the API does: a 5 MB PNG opens to hundreds of MB of pixels. With several photos sent at once
 * and libvips using every CPU per photo, the container ran past its memory limit and was killed
 * mid-upload ("Não foi possível conectar à API"). So: one libvips thread per photo, a small
 * cache, and at most `MAX_PARALLEL` photos being processed at a time — the rest wait their turn.
 */
const MAX_PARALLEL = 2;
sharp.concurrency(1);
sharp.cache({ memory: 32, files: 0, items: 50 });

let running = 0;
const waiting: Array<() => void> = [];

export async function withImageSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  else running += 1;
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

/** For tests: how many photos are being processed right now. */
export function imageSlotsInUse(): number {
  return running;
}
