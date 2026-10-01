"use client";

import { memo, useEffect, useRef, useState } from "react";
import { languageSettings, type PracticeLanguage } from "@/lib/languages";

export const PronunciationCaption = memo(function PronunciationCaption({ text, language }: { text: string; language: PracticeLanguage }) {
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef(0);
  const [result, setResult] = useState<{ text: string; language: PracticeLanguage; characters: [string, string | null][] } | null>(null);
  useEffect(() => {
    // Keep dictionary initialization and conversion off the audio/UI thread.
    let worker: Worker;
    try { worker = new Worker(new URL("../lib/pronunciation.worker.ts", import.meta.url)); }
    catch { return; } // Raw captions remain available if workers are blocked.
    workerRef.current = worker;
    worker.onmessage = ({ data }) => {
      if (data.id === requestRef.current && Array.isArray(data.characters)) setResult(data);
    };
    worker.onerror = () => { worker.terminate(); workerRef.current = null; };
    return () => { worker.terminate(); workerRef.current = null; };
  }, []);
  useEffect(() => {
    workerRef.current?.postMessage({ id: ++requestRef.current, text, language });
  }, [text, language]);
  // Keep existing annotation nodes while new transcript text streams in.
  const canReuse = result?.language === language && text.startsWith(result.text);
  const characters = canReuse ? result.characters : null;
  const pendingText = canReuse ? text.slice(result.text.length) : text;
  return <p className="jyutping-caption" lang={languageSettings[language].tag} aria-label={text}>
    {characters ? characters.map(([character, pronunciation], index) => pronunciation ? (
      <span className="pronunciation-word" key={index}>
        <span>{character}</span>
        <span className="jyutping" aria-hidden="true">{pronunciation}</span>
      </span>
    ) : <span key={index}>{character}</span>) : null}
    {pendingText}
  </p>;
});
