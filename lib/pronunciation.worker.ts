import { pronunciationCharacters } from "@/lib/pronunciation";
import type { PracticeLanguage } from "@/lib/languages";

type CaptionRequest = { id: number; text: string; language: PracticeLanguage };
const port = self as unknown as {
  onmessage: ((event: MessageEvent<CaptionRequest>) => void) | null;
  postMessage: (message: unknown) => void;
};

port.onmessage = ({ data }) => {
  try {
    port.postMessage({ ...data, characters: pronunciationCharacters(data.text, data.language) });
  } catch {
    port.postMessage({ ...data, characters: null });
  }
};
