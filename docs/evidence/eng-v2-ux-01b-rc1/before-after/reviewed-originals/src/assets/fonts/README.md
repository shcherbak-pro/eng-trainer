# Self-hosted fonts

v2 uses two open-source typefaces, served from this repository. The application makes no request to Google Fonts or any other third party.

| Typeface | Use | Licence |
|---|---|---|
| Literata | English study text: terms, phrases, examples | SIL Open Font License 1.1, © 2017 The Literata Project Authors ([`public/fonts/OFL-Literata.txt`](../../../public/fonts/OFL-Literata.txt)) |
| Source Sans 3 | Interface, Ukrainian content and IPA transcriptions | SIL Open Font License 1.1, © 2010-2020 Adobe, Reserved Font Name “Source” ([`public/fonts/OFL-SourceSans3.txt`](../../../public/fonts/OFL-SourceSans3.txt)) |

The licence files are copied to the published site (`/eng-trainer/fonts/`). The `@font-face` rules are in [`src/styles/fonts.css`](../../styles/fonts.css).

## Files

The WOFF2 files are the unmodified subsets of the Google Fonts distribution (variable weight 400–700; Literata also has its optical-size axis), downloaded on 22 November 2026. Each subset is declared with its original `unicode-range`, so a browser downloads only the subsets a page needs.

| File | Subset | Bytes | SHA-256 |
|---|---|---:|---|
| `literata-latin.woff2` | Latin, roman | 85,672 | `7478e1920209e51dcc235d151d2056a0a6e3c54b4436f7030d256f231fe09b58` |
| `literata-latin-italic.woff2` | Latin, italic | 88,756 | `88716d1d508846fb4152ee7f7e05b034b334c84206322efd828402e9a18d9265` |
| `source-sans-3-latin.woff2` | Latin | 28,872 | `19143dca075972bc84e3fd9eab7416dd40cc565dccb2435a044bdfabe060c7d5` |
| `source-sans-3-latin-ext.woff2` | Latin Extended (IPA) | 60,088 | `a85a7459bdb3cdc1136751e151a506bae653fc29ada3ca86237477df6f1b59e6` |
| `source-sans-3-cyrillic.woff2` | Cyrillic (Ukrainian) | 18,496 | `b6b721e08d0324b9e743858e8260463085d4c5e1e684f036f9d4a8ca6c62996f` |
| `source-sans-3-greek.woff2` | Greek (θ in IPA) | 14,528 | `dd6ec3878cf37dc8b864562acf1a37bd8c9e0ca638d7f75a7cd6b6f7ae16cf3d` |

Coverage was checked by rendering in a browser: Source Sans 3 draws every non-ASCII symbol used in the built-in transcriptions (ɪ ə ˈ ː ʊ ð ɑ æ ʃ ɔ ɜ ʌ ɡ ˌ ŋ ʒ θ ’) and the Ukrainian letters і ї є ґ and ʼ. Literata lacks several IPA symbols, so transcriptions always use Source Sans 3. See `docs/design/eng-v2-ux-01a/audit/data/glyph-coverage.txt`.

## Fallbacks

If a font is slow or unavailable, text is shown immediately in a local font (`font-display: swap`): Georgia or another serif for Literata; Segoe UI, the system font, Roboto or Noto Sans for Source Sans 3. These fallbacks also cover Cyrillic and IPA on current desktop and mobile systems.

## Updating

Replace a file only with an OFL-licensed build of the same family, update the table above, and keep the licence files in `public/fonts/`.
