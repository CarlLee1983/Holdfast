/**
 * 商家設定：潮間 Tidal Table（虛構餐廳）。依 ADR 0002 只有單一商家，
 * 所以寫死在 Web 端，不進 D1、不做後台編輯。頁面只從這裡取店家資訊。
 */

export interface ImageSource {
  src: string;
  width: number;
  height: number;
}

/** 由寬度描述子組成 img 的 srcset，依寬度由小到大排列。不改動輸入。 */
export function srcsetOf(sources: readonly ImageSource[]): string {
  return [...sources]
    .sort((a, b) => a.width - b.width)
    .map((s) => `${s.src} ${s.width}w`)
    .join(", ");
}

const NAME = { zh: "潮間", latin: "Tidal Table" } as const;

export const MERCHANT = {
  name: NAME,
  intro: "海味餐酒館。每天依漁獲調整菜單，搭配自然酒，座位面向開放廚房；另有一間可坐十位的包廂。",
  address: "台北市中山區（示意地址）",
  /** 營業時間，每段為台北時間 HH:mm */
  hours: { days: "週二至週日", periods: ["11:30–14:30", "17:30–22:00"] },
  closedDays: "每週一",
  /** 公休的星期（0 = 週日），與 closedDays 一致 */
  closedWeekdays: [1],
  phone: "02-0000-0000",
  /** 在台北時間此刻之前開始的時段歸為午餐，其餘為晚餐 */
  lunchEndsAt: "16:00",
  /** 首頁可選的日期數，從今天（台北日期）起算 */
  bookableDays: 14,
  disclaimer: `${NAME.zh} ${NAME.latin} 為虛構餐廳，本站為 Holdfast 訂位系統示意。`,
  cover: {
    sources: [
      { src: "/images/cover-800.webp", width: 533, height: 800 },
      { src: "/images/cover-1600.webp", width: 1067, height: 1600 },
    ],
    alt: "米灰色桌面上擺著幾枚貝殼",
    credit: {
      photographer: "Content Pixie",
      source: "Unsplash",
      url: "https://unsplash.com/photos/a-close-up-of-a-fruit-IKShSb2P6Oo",
    },
  },
} as const;
