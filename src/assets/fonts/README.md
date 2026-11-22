# Self-hosted fonts

v2 uses two open-source typefaces, served from this repository. The application makes no request to Google Fonts or any other third party.

| Typeface | Use | Licence and provenance |
|---|---|---|
| Literata | English study text: terms, phrases, examples | SIL Open Font License 1.1, © 2017 The Literata Project Authors ([`public/fonts/OFL-Literata.txt`](../../../public/fonts/OFL-Literata.txt)). Unmodified Google Fonts files. |
| Eng Trainer Sans | Interface, Ukrainian content and IPA transcriptions | SIL Open Font License 1.1. A renamed derivative of the Source Sans 3 web subsets (© 2010-2020 Adobe, with Reserved Font Name “Source”; [`public/fonts/OFL-EngTrainerSans.txt`](../../../public/fonts/OFL-EngTrainerSans.txt)). Only the font names differ; see [`public/fonts/FONTLOG-EngTrainerSans.txt`](../../../public/fonts/FONTLOG-EngTrainerSans.txt). |

Why a new name: a subset is a Modified Version under the OFL, and Source Sans 3 reserves the name “Source”, so the subsets are distributed under their own family name. Glyphs, character mapping, shaping, metrics, the weight axis and all notices are unchanged, so text looks exactly as before.

The licence texts and the FONTLOG are copied to the published site (`/eng-trainer/fonts/`). The `@font-face` rules are in [`src/styles/fonts.css`](../../styles/fonts.css).

## Files

Each subset is declared with its original `unicode-range`, so a browser downloads only the subsets a page needs. The CSS uses weights 400 to 700; the files cover more (Literata `wght` 400–900 with an optical-size axis, Eng Trainer Sans `wght` 200–900).

| File | Subset | Bytes | SHA-256 | Source |
|---|---|---:|---|---|
| `literata-latin.woff2` | Latin, roman | 85,672 | `7478e1920209e51dcc235d151d2056a0a6e3c54b4436f7030d256f231fe09b58` | Literata v40 (font version 3.103), [`…J_HWTA.woff2`](https://fonts.gstatic.com/s/literata/v40/or3PQ6P12-iJxAIgLa78DkTtAoDhk0oVpaK3YLanFLHpPf2TbLi4J_HWTA.woff2), unmodified |
| `literata-latin-italic.woff2` | Latin, italic | 88,756 | `88716d1d508846fb4152ee7f7e05b034b334c84206322efd828402e9a18d9265` | Literata v40 (3.103), [`…VrLmTkiS.woff2`](https://fonts.gstatic.com/s/literata/v40/or3NQ6P12-iJxAIgLYT1PLs1a-t7PU0AbeE9KPxYzNiCp1OUedn8VrLmTkiS.woff2), unmodified |
| `eng-trainer-sans-latin.woff2` | Latin | 28,832 | `1bf77ef0b5446cfb6f13e91e9443ae7e2aff3e5a51133191ed88442aed3124e4` | Source Sans 3 v20 (3.052) Latin subset, renamed |
| `eng-trainer-sans-latin-ext.woff2` | Latin Extended (IPA) | 60,136 | `c9c893dfe10a4b324486c3ab4c506cfb65b468b879e233b7ac33e2fab092c86d` | Source Sans 3 v20 Latin Extended subset, renamed |
| `eng-trainer-sans-cyrillic.woff2` | Cyrillic (Ukrainian) | 18,412 | `1bba4b98f5f89a7226cc9e18b0502d09d80150f3ea80d1a3a16f44e024b52682` | Source Sans 3 v20 Cyrillic subset, renamed |
| `eng-trainer-sans-greek.woff2` | Greek (θ in IPA) | 14,504 | `0f6a78c1908a95f8b1f0faa7498e54249ada201d3b14c093a68e8170ec8f8670` | Source Sans 3 v20 Greek subset, renamed |

The original Source Sans 3 URLs and hashes, the exact name changes and how to reproduce the derivative are in the FONTLOG. The preparation script is [`scripts/fonts/derive_eng_trainer_sans.py`](../../../scripts/fonts/derive_eng_trainer_sans.py); it is not part of the build.

Coverage was checked by rendering in a browser: Eng Trainer Sans (as Source Sans 3 before it) draws every non-ASCII symbol used in the built-in transcriptions (ɪ ə ˈ ː ʊ ð ɑ æ ʃ ɔ ɜ ʌ ɡ ˌ ŋ ʒ θ ’) and the Ukrainian letters і ї є ґ and ʼ. Literata lacks several IPA symbols, so transcriptions always use Eng Trainer Sans. See `docs/design/eng-v2-ux-01a/audit/data/glyph-coverage.txt`.

## Fallbacks

If a font is slow or unavailable, text is shown immediately in a local font (`font-display: swap`): Georgia or another serif for Literata; Segoe UI, the system font, Roboto or Noto Sans for Eng Trainer Sans. These fallbacks also cover Cyrillic and IPA on current desktop and mobile systems.

## Updating

Replace a file only with an OFL-licensed build of the same family, update the table above, and keep the licence files and the FONTLOG in `public/fonts/`. A new Source Sans 3 subset must be renamed in the same way (see the FONTLOG) before it is added.
