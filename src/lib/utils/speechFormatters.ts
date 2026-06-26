import type { IrregularVerb, Phrase, TrainingBlock, WordIndexItem } from '../types/materials';
import type { SectionSpeechItem } from './sectionSpeech';

const en = (text: string) => ({ text, lang: 'en-US', rate: 0.88 });
const ua = (text: string) => ({ text, lang: 'uk-UA', rate: 0.95 });

function joinForms(verb: IrregularVerb): string {
  return `${verb.base}, ${verb.pastSimple}, ${verb.pastParticiple}`;
}

export function phraseToSpeechItem(phrase: Phrase): SectionSpeechItem {
  return {
    id: phrase.id,
    label: phrase.phrase,
    segments: [
      en(phrase.phrase),
      ua(phrase.translation),
      en(phrase.example)
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
      ...item.examples.slice(0, 2).flatMap((example) => [en(example.en), ua(example.ua)])
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
      ...verb.examples.slice(0, 2).flatMap((example) => [en(example.en), ua(example.ua)])
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
