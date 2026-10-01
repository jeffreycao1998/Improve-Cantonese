export type PracticeLanguage = "cantonese" | "mandarin";

export function isPracticeLanguage(value: unknown): value is PracticeLanguage {
  return value === "cantonese" || value === "mandarin";
}

export const languageSettings = {
  cantonese: { name: "Cantonese", title: "Guangzhou Cantonese", pronunciation: "Jyutping", tag: "yue" },
  mandarin: { name: "Mandarin", title: "Standard Mandarin", pronunciation: "Pinyin", tag: "cmn" }
} as const;
