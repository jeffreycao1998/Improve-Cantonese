import type { PracticeScenario } from "@/lib/types";
import type { PracticeLanguage } from "@/lib/languages";

export const scenarios: PracticeScenario[] = [
  {
    id: "daily",
    title: "Daily catch-up",
    situation: "A quick conversation about your day, plans, and what you need to do next.",
    coachGoal: "Keep the learner answering in short natural Guangzhou Cantonese turns.",
    learnerGoal: "Answer without switching fully back to English.",
    level: "Warm-up",
    accentFocus: ["sentence rhythm", "question endings", "natural fillers"],
    samplePrompts: ["What did you do today?", "What are you doing later?", "Tell me one small problem from your day."]
  },
  {
    id: "food",
    title: "Order food",
    situation: "Ordering noodles, tea, and small dishes while handling follow-up questions.",
    coachGoal: "Play a busy counter worker and make the learner ask for what they want.",
    learnerGoal: "Order, clarify, and respond to choices naturally.",
    level: "Everyday",
    accentFocus: ["measure words", "polite but casual requests", "numbers"],
    samplePrompts: ["Order a bowl of noodles.", "Ask what drinks they have.", "Say you do not want it too spicy."]
  },
  {
    id: "directions",
    title: "Find your way",
    situation: "Asking for directions, checking distance, and confirming where to turn.",
    coachGoal: "Act as a local giving compact directions and ask the learner to repeat key steps.",
    learnerGoal: "Ask, confirm, and recover when you miss a detail.",
    level: "Everyday",
    accentFocus: ["place words", "left/right", "confirmation phrases"],
    samplePrompts: ["Ask how to get to the metro station.", "Confirm whether it is far.", "Ask them to repeat the last step."]
  },
  {
    id: "family",
    title: "Family chat",
    situation: "Casual heritage-speaker conversation about food, work, health, and plans.",
    coachGoal: "Keep the tone warm, familiar, and practical without requiring characters.",
    learnerGoal: "Sound less translated from English in family-style small talk.",
    level: "Stretch",
    accentFocus: ["casual particles", "softening answers", "topic changes"],
    samplePrompts: ["Tell an elder you have eaten already.", "Ask someone how work has been.", "Explain why you are busy this week."]
  },
  {
    id: "small-talk",
    title: "Small talk",
    situation: "Short, friendly exchanges with neighbors, coworkers, or people you just met.",
    coachGoal: "Prompt quick back-and-forth with gentle corrections for natural phrasing.",
    learnerGoal: "Keep a light conversation going for three turns.",
    level: "Warm-up",
    accentFocus: ["openers", "follow-up questions", "smooth pacing"],
    samplePrompts: ["Comment on the weather.", "Ask what someone likes to eat nearby.", "React naturally to good news."]
  },
  {
    id: "repair",
    title: "Repair phrases",
    situation: "Recovering when you do not understand or do not know how to say something.",
    coachGoal: "Make the learner practice asking for repeats, slower speech, and wording help.",
    learnerGoal: "Stay in Cantonese even when stuck.",
    level: "Everyday",
    accentFocus: ["repeat requests", "slower please", "how do I say"],
    samplePrompts: ["Ask the person to say that again.", "Ask how to say a word in Cantonese.", "Say you understand a little but not everything."]
  }
];

export function adaptScenario(scenario: PracticeScenario, language: PracticeLanguage): PracticeScenario {
  if (language === "cantonese") return scenario;
  const adapt = (text: string) => text.replaceAll("Guangzhou Cantonese", "standard Mandarin").replaceAll("Cantonese", "Mandarin");
  return { ...scenario, coachGoal: adapt(scenario.coachGoal), learnerGoal: adapt(scenario.learnerGoal),
    samplePrompts: scenario.samplePrompts.map(adapt) };
}

export function getScenario(id: string | null | undefined, language: PracticeLanguage = "cantonese") {
  return adaptScenario(scenarios.find((scenario) => scenario.id === id)
    ?? scenarios[Math.floor(Math.random() * scenarios.length)], language);
}
