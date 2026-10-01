import ToJyutping from "to-jyutping";
import { pinyin } from "pinyin-pro";
import type { PracticeLanguage } from "@/lib/languages";

export function pronunciationCharacters(text: string, language: PracticeLanguage): [string, string | null][] {
  if (language === "cantonese") return ToJyutping.getJyutpingList(text);
  return pinyin(text, { type: "all" }).map(item => [item.origin, item.isZh ? item.pinyin : null]);
}
