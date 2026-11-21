import { stopSectionSpeech } from './sectionSpeech';

export function speak(text: string): void {
  if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  stopSectionSpeech();
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.88;
  window.speechSynthesis.speak(utterance);
}
