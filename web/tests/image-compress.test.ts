import { describe, expect, it } from "vitest";
import { compressImage, fitWithin, forEachLimited } from "@/lib/image-compress";

describe("redução de fotos antes do envio", () => {
  it("cabe em 1920 px mantendo a proporção e nunca amplia", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1920, height: 1440 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1440, height: 1920 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("sem suporte do navegador, envia o arquivo original", async () => {
    const file = new File(["x"], "foto.jpg", { type: "image/jpeg" });
    expect(await compressImage(file)).toBe(file);
  });

  it("envia em paralelo respeitando o limite e processa todos", async () => {
    let running = 0, peak = 0;
    const done: number[] = [];
    await forEachLimited([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      running++; peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5 * (8 - item)));
      running--; done.push(item);
    });
    expect(peak).toBe(3);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
