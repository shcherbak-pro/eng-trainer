import { writable } from 'svelte/store';

export type SpeechRepeatCount = 10 | 20 | 50;

export type SpeechSegment = {
  text: string;
  lang?: string;
  rate?: number;
};

export type SectionSpeechItem = {
  id: string;
  label: string;
  segments: SpeechSegment[];
};

export type SectionSpeechState = {
  activeControlId: string | null;
  isSpeaking: boolean;
  currentItem: number;
  totalItems: number;
  currentRepeat: number;
  repeats: SpeechRepeatCount;
  currentLabel: string;
};

const initialState: SectionSpeechState = {
  activeControlId: null,
  isSpeaking: false,
  currentItem: 0,
  totalItems: 0,
  currentRepeat: 0,
  repeats: 10,
  currentLabel: ''
};

export const sectionSpeech = writable<SectionSpeechState>(initialState);

let runToken = 0;

function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function speakSegment(segment: SpeechSegment, token: number): Promise<void> {
  const text = cleanText(segment.text);

  if (!text || !canSpeak() || token !== runToken) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = segment.lang ?? 'en-US';
    utterance.rate = segment.rate ?? 0.88;

    const estimatedTimeout = Math.min(Math.max(text.length * 95, 2500), 45000);
    const timeoutId = window.setTimeout(() => resolve(), estimatedTimeout);

    const finish = () => {
      window.clearTimeout(timeoutId);
      resolve();
    };

    utterance.onend = finish;
    utterance.onerror = finish;

    window.speechSynthesis.speak(utterance);
  });
}

export async function speakSection(controlId: string, items: SectionSpeechItem[], repeats: SpeechRepeatCount): Promise<void> {
  const preparedItems = items
    .map((item) => ({
      ...item,
      segments: item.segments.map((segment) => ({ ...segment, text: cleanText(segment.text) })).filter((segment) => Boolean(segment.text))
    }))
    .filter((item) => item.segments.length > 0);

  stopSectionSpeech();

  if (!preparedItems.length || !canSpeak()) {
    return;
  }

  const token = ++runToken;
  window.speechSynthesis.cancel();

  sectionSpeech.set({
    activeControlId: controlId,
    isSpeaking: true,
    currentItem: 0,
    totalItems: preparedItems.length,
    currentRepeat: 1,
    repeats,
    currentLabel: ''
  });

  for (let repeat = 1; repeat <= repeats; repeat += 1) {
    for (let index = 0; index < preparedItems.length; index += 1) {
      if (token !== runToken) {
        return;
      }

      const item = preparedItems[index];
      sectionSpeech.set({
        activeControlId: controlId,
        isSpeaking: true,
        currentItem: index + 1,
        totalItems: preparedItems.length,
        currentRepeat: repeat,
        repeats,
        currentLabel: item.label
      });

      for (const segment of item.segments) {
        if (token !== runToken) {
          return;
        }
        await speakSegment(segment, token);
        await wait(120);
      }

      await wait(260);
    }
  }

  if (token === runToken) {
    sectionSpeech.set(initialState);
  }
}

export function stopSectionSpeech(): void {
  runToken += 1;
  if (canSpeak()) {
    window.speechSynthesis.cancel();
  }
  sectionSpeech.set(initialState);
}
