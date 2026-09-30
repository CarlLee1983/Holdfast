import { describe, expect, it } from "vitest";
import {
  filterSlotsBySeats,
  hiddenResources,
  hiddenResourcesNote,
  maxSeatsPerHold,
  onlineLimitNote,
} from "./seat-filter";

const hall = { name: "大廳用餐", seatsPerHold: 4 };
const room = { name: "包廂", seatsPerHold: 10 };
const bar = { name: "吧檯", seatsPerHold: 2 };

describe("maxSeatsPerHold", () => {
  it("取所有資源單筆名額上限的最大值", () => {
    expect(maxSeatsPerHold([hall, room, bar])).toBe(10);
  });

  it("沒有資源時為 0", () => {
    expect(maxSeatsPerHold([])).toBe(0);
  });
});

describe("filterSlotsBySeats", () => {
  const slots = [
    { id: 1, seatsPerHold: 4 },
    { id: 2, seatsPerHold: 10 },
    { id: 3, seatsPerHold: 2 },
  ];

  it("上限剛好等於人數的資源保留（邊界）", () => {
    expect(filterSlotsBySeats(slots, 4).map((s) => s.id)).toEqual([1, 2]);
  });

  it("上限小於人數的資源，其時段不列出", () => {
    expect(filterSlotsBySeats(slots, 5).map((s) => s.id)).toEqual([2]);
  });

  it("人數 1 時全部保留", () => {
    expect(filterSlotsBySeats(slots, 1).map((s) => s.id)).toEqual([1, 2, 3]);
  });

  it("沒有任何資源容得下時回傳空陣列", () => {
    expect(filterSlotsBySeats(slots, 11)).toEqual([]);
  });
});

describe("hiddenResources", () => {
  it("回傳上限小於人數的資源，保持原順序", () => {
    expect(hiddenResources([hall, room, bar], 5)).toEqual([hall, bar]);
  });

  it("人數等於上限時不隱藏", () => {
    expect(hiddenResources([hall, room], 4)).toEqual([]);
  });
});

describe("hiddenResourcesNote", () => {
  it("沒有被隱藏的資源時沒有提示", () => {
    expect(hiddenResourcesNote([])).toBeNull();
  });

  it("單一資源", () => {
    expect(hiddenResourcesNote([hall])).toBe("大廳用餐最多 4 位，這個人數不列出它的時段。");
  });

  it("多個資源用「、」串接", () => {
    expect(hiddenResourcesNote([hall, bar])).toBe("大廳用餐最多 4 位、吧檯最多 2 位，這個人數不列出它們的時段。");
  });
});

describe("onlineLimitNote", () => {
  it("說明線上上限與來電電話", () => {
    expect(onlineLimitNote(10, "02-0000-0000")).toBe("線上可訂 1–10 位；超過 10 位請來電 02-0000-0000。");
  });
});
