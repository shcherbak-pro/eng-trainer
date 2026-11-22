import { describe, expect, it } from 'vitest';
import { exportFileName } from './fileName';

const day = new Date(2026, 10, 22);

describe('export file names (F6)', () => {
  it('keeps Cyrillic letters and digits', () => {
    expect(exportFileName('Мої слова', day)).toBe('Мої-слова-2026-11-22.json');
    expect(exportFileName('Слова 2026', day)).toBe('Слова-2026-2026-11-22.json');
    expect(exportFileName('Пам’ять і ґрунт', day)).toBe('Пам’ять-і-ґрунт-2026-11-22.json');
  });

  it('gives different Ukrainian names different files', () => {
    expect(exportFileName('Мої слова', day)).not.toBe(exportFileName('Робочі фрази', day));
  });

  it('replaces path separators and reserved characters', () => {
    expect(exportFileName('../../etc/passwd', day)).toBe('etc-passwd-2026-11-22.json');
    expect(exportFileName('a<b>c:d"e|f?g*h\\i', day)).toBe('a-b-c-d-e-f-g-h-i-2026-11-22.json');
    expect(exportFileName('  Work: meetings & calls  ', day)).toBe('Work-meetings-calls-2026-11-22.json');
  });

  it('removes control characters and falls back when nothing usable remains', () => {
    expect(exportFileName('\u0000\u0007', day)).toBe('vocabulary-2026-11-22.json');
    expect(exportFileName('🙂🙂', day)).toBe('vocabulary-2026-11-22.json');
    expect(exportFileName('', day)).toBe('vocabulary-2026-11-22.json');
  });

  it('limits the name to 80 characters without splitting a character', () => {
    const name = exportFileName('Ї'.repeat(120), day);
    expect(Array.from(name.replace('-2026-11-22.json', ''))).toHaveLength(80);
  });

  it('protects Windows device names', () => {
    expect(exportFileName('CON', day)).toBe('_CON-2026-11-22.json');
    expect(exportFileName('lpt1', day)).toBe('_lpt1-2026-11-22.json');
  });
});
