import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { imageSlotsInUse, withImageSlot } from "../dist/infrastructure/image-processing/image-work-limiter.js";

test("photos are processed at most two at a time; the rest wait and all finish", async () => {
  let peak = 0;
  let active = 0;
  const jobs = Array.from({ length: 7 }, (_, index) => withImageSlot(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return index;
  }));
  assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(peak, 2);
  assert.equal(imageSlotsInUse(), 0);
});

test("a failed photo frees its slot for the next one", async () => {
  await assert.rejects(withImageSlot(async () => { throw new Error("foto ruim"); }), /foto ruim/);
  await assert.rejects(withImageSlot(async () => { throw new Error("foto ruim"); }), /foto ruim/);
  assert.equal(await withImageSlot(async () => "ok"), "ok");
  assert.equal(imageSlotsInUse(), 0);
});

test("libvips runs one thread per photo with a small cache", () => {
  assert.equal(sharp.concurrency(), 1);
  assert.equal(sharp.cache().memory.max, 32);
});
