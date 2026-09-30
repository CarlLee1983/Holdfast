import { describe, expect, it } from "vitest";
import { MERCHANT, srcsetOf } from "./merchant";

describe("srcsetOf", () => {
  it("依寬度由小到大組成 srcset", () => {
    expect(
      srcsetOf([
        { src: "/b.webp", width: 1067, height: 1600 },
        { src: "/a.webp", width: 533, height: 800 },
      ]),
    ).toBe("/a.webp 533w, /b.webp 1067w");
  });
});

describe("MERCHANT", () => {
  it("封面有 800 與 1600 兩種尺寸（長邊），比例一致", () => {
    const longEdges = MERCHANT.cover.sources.map((s) => Math.max(s.width, s.height)).sort((a, b) => a - b);
    expect(longEdges).toEqual([800, 1600]);
    const [a, b] = MERCHANT.cover.sources;
    expect(a.width / a.height).toBeCloseTo(b.width / b.height, 2);
  });

  it("虛構聲明提到店名", () => {
    expect(MERCHANT.disclaimer).toContain(`${MERCHANT.name.zh} ${MERCHANT.name.latin}`);
  });
});
