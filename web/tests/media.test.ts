import { describe, expect, it } from "vitest";
import { thumbUrl } from "@/lib/media";

describe("thumbUrl", () => {
  it("pede a miniatura das fotos do storage do Vorix, mantendo a assinatura", () => {
    expect(thumbUrl("https://api.vorix.test/uploads/assets/t/w/products/a.webp?exp=1&sig=x", 480)).toBe("https://api.vorix.test/uploads/assets/t/w/products/a.webp?exp=1&sig=x&w=480");
    expect(thumbUrl("https://api.vorix.test/uploads/assets/t/w/products/a.jpg", 160)).toBe("https://api.vorix.test/uploads/assets/t/w/products/a.jpg?w=160");
  });
  it("deixa como estão URLs externas, vídeos e vazias", () => {
    expect(thumbUrl("https://cdn.exemplo.com/a.jpg", 480)).toBe("https://cdn.exemplo.com/a.jpg");
    expect(thumbUrl("https://api.vorix.test/uploads/a/b/video.mp4?exp=1&sig=x", 480)).toBe("https://api.vorix.test/uploads/a/b/video.mp4?exp=1&sig=x");
    expect(thumbUrl(undefined, 160)).toBeUndefined();
  });
});
