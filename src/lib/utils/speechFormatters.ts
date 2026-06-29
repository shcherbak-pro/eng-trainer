import type { IrregularVerb, Phrase, TrainingBlock, WordIndexItem } from '../types/materials';
import type { SectionSpeechItem, SpeechSegment } from './sectionSpeech';

const en = (text: string): SpeechSegment => ({ text, lang: 'en-US', rate: 0.88 });
const ua = (text: string): SpeechSegment => ({ text, lang: 'uk-UA', rate: 0.95 });

function joinForms(verb: IrregularVerb): string {
  return `${verb.base}, ${verb.pastSimple}, ${verb.pastParticiple}`;
}

function normalizeAlternatives(value?: string[] | string): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : value.split(';').map((item) => item.trim()).filter(Boolean);
}

function commonAlternativeSegments(value?: string[] | string): SpeechSegment[] {
  const alternatives = normalizeAlternatives(value);
  if (!alternatives.length) return [];
  return [en(`Common alternatives: ${alternatives.join('; ')}`)];
}

export function phraseToSpeechItem(phrase: Phrase): SectionSpeechItem {
  const examples = phrase.examples?.length ? phrase.examples.slice(0, 2) : phrase.example ? [{ en: phrase.example }] : [];

  return {
    id: phrase.id,
    label: phrase.phrase,
    segments: [
      en(phrase.phrase),
      ua(phrase.translation),
      ...commonAlternativeSegments(phrase.commonAlternatives),
      ...examples.flatMap((example) => [en(example.en), ...(example.ua ? [ua(example.ua)] : [])])
    ]
  };
}

export function wordToSpeechItem(item: WordIndexItem): SectionSpeechItem {
  return {
    id: item.id,
    label: item.term,
    segments: [
      en(item.term),
      ua(item.meaning),
      ...commonAlternativeSegments(item.commonAlternatives),
      ...item.examples.slice(0, 2).flatMap((example) => [en(example.en), ...(example.ua ? [ua(example.ua)] : [])])
    ]
  };
}

export function irregularVerbToSpeechItem(verb: IrregularVerb): SectionSpeechItem {
  return {
    id: verb.id,
    label: joinForms(verb),
    segments: [
      en(joinForms(verb)),
      ua(verb.translation),
      ...commonAlternativeSegments(verb.commonAlternatives),
      ...verb.examples.slice(0, 2).flatMap((example) => [en(example.en), ...(example.ua ? [ua(example.ua)] : [])])
    ]
  };
}

export function blockToSpeechItem(block: TrainingBlock): SectionSpeechItem {
  return {
    id: block.id,
    label: block.title,
    segments: [
      en(block.title),
      en(block.description)
    ]
  };
}
