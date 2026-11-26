# Pronunciation prototype (ENG-V3-02, stage A)

The experimental product has a first Pronunciation screen: the learner picks a phrase, records it, and reads what a speech recognizer heard. The recognizer is a downloaded model that runs in the browser.

This is a prototype for **disposable browser profiles with made-up learning data**. It is not published, no build contains a speech model, and the stable product is unchanged. How products, routes and the released-site gates work is in [Products and routes](PRODUCTS-AND-ROUTES.md).

## What it does, and what it does not

| It does | It does not |
|---|---|
| Record one phrase from the microphone, after a click | Score, grade or judge pronunciation |
| Recognize the recording on this device | Send audio or text to any server |
| Show the recognizer's text, and offer to record again | Compare the text with the phrase |
| Download the model from the local prototype server, after a click | Use a browser's own recognizer or any cloud service |
| Delete the downloaded model on request | Store a recording, a result or a history |
| | Mark anything as learned |

The result reads "The recognizer heard: …". A recognizer can mishear correct speech and can turn a mispronounced word into the expected one, and the screen says so.

## Running it

```text
npm run prototype:build     builds all three products and assembles them locally (.site-test/)
npm run prototype:model     once: downloads the pinned model (31.9 MB) into .local/models/
npm run prototype:serve     http://127.0.0.1:4173/eng-trainer/v3/#pronunciation
```

Open the address in a new, empty browser profile, for example:

```text
chrome --user-data-dir=<a new, empty folder> http://127.0.0.1:4173/eng-trainer/v3/#pronunciation
firefox -profile <a new, empty folder> -no-remote http://127.0.0.1:4173/eng-trainer/v3/#pronunciation
```

- `prototype:model` contacts one outside host, the Hugging Face Hub, from this computer. A browser never does: the prototype server hands out the files from `.local/models/`.
- The server answers this computer only (`127.0.0.1`). It sends static files and no policy header, as GitHub Pages does.
- `npm run dev:v3` also shows the screen, but without the page policy described below. Use the built product for anything that concerns the network boundary.

## Why real profiles are excluded

Browser storage of one origin shares one quota and one eviction exposure. A model cache of 47 MB can put the learning data of v1, v2 and v3 at risk. A backup file can be made since ENG-V3-R1A, and each product can be recovered from it ([Backup and recovery](BACKUP-AND-RECOVERY.md)), but capacity is not checked. Until the Data Safety Gate has passed, a model may be cached only where no real data lives. Three things keep it that way:

1. **The product is not published.** Its route has `"publish": false`, and the gates refuse a site that contains it.
2. **No build contains a model file.** A gate fails on one. Only the local prototype server adds the model, below `/eng-trainer/v3/models/`.
3. **The download is offered on a loopback address only** (`localhost`, `127.0.0.1`, `[::1]`). On any other host the screen says that no download is offered.

The application cannot tell a disposable profile from a personal one. Using a disposable profile is the tester's part, and the screen says so.

## Parts

Everything is in `src/features/pronunciation/`, which only the experimental product is built from.

| Part | Files | Role |
|---|---|---|
| Screen | `PronunciationPage.svelte`, `session.ts`, `practiceItems.ts` | States, the order of things, retry and cancel |
| Spoken targets | `spokenTarget.js` | What an entry asks the learner to say, and the revision of that |
| Recording | `capture/capture.ts`, `capture/levels.ts`, `capture/pcm-collector.worklet.js` | Microphone, 16 kHz mono samples, level checks, release |
| Model files | `models/pinned-files.json`, `models/pinned.ts`, `models/verify.ts`, `models/store.ts`, `models/install.ts` | Pinned list, SHA-256 check, model cache, installer |
| Recognizer | `recognition/types.ts`, `recognition/localMl.ts`, `recognition/bootstrap.ts`, `recognition/recognizer.worker.ts`, `recognition/lockdown.ts`, `recognition/moonshine.ts`, `recognition/tokenDecoder.ts` | Provider interface, Worker start, the Worker, decoding |

### Order of things

```text
open the screen          nothing is downloaded, nothing is asked
click "Download"         pinned files -> size and SHA-256 checked -> model cache -> marker
                         Worker started -> files read from the cache and checked again -> model loaded
                         recorder script loaded
                         (all network use ends here)
click "Record"           microphone permission -> recording, at most 20 seconds
click "Stop"             microphone released -> level checks -> samples to the Worker -> text
click "Record again"     the same, with a new recording
leave the screen         microphone, audio context and Worker are released
```

A recording that is silent, shorter than one second, distorted or cut by the time limit is not recognized; the screen says why. A result that arrives after Cancel, after a new recording started or after the screen was left is dropped.

### Waits that can be ended, and a recognizer that fails

Three steps wait for the browser, and the browser may never answer. Each wait can be ended at once, and ending it releases what was acquired so far. Whatever the browser delivers afterwards is released as it arrives and is never used.

| Wait | Ended by | What is released |
|---|---|---|
| Preparing: the download, the model, the recorder's script | Cancel, deleting the model, leaving the screen | The Worker and the model's memory. The audio context, also one that is still being prepared. The screen does not become ready |
| Starting a recording: the permission, the audio device | Cancel, a hidden page, leaving the screen | A microphone that the browser has handed over is stopped at once. One that arrives later is stopped as it arrives |
| Recognizing | Cancel | The result is dropped |

A retry after an ended wait is not disturbed when the ended step finishes late: the audio context is paused only when no recording uses it.

The recognizer's Worker can fail at any time after loading: it can throw, a message can be lost, or it can stop answering. For as long as a Worker lives, each of these ends it:

- The Worker is terminated, and every recognition that waits is refused with the reason.
- The recognizer tells the screen at once. A recording in progress is ended and the microphone is released.
- The screen shows the reason and offers **Load the speech model**, which starts a new Worker.
- A Worker that does not answer a recording within 120 seconds counts as failed. The time runs for every request, also one whose result was cancelled, so a retry cannot wait for ever behind a Worker that hangs.

### Model and runtime

| | |
|---|---|
| Model | Moonshine tiny, 8-bit quantized: `onnx-community/moonshine-tiny-ONNX` at commit `a6da1241cd305dcd64eab1edbd615f2bb9aabb95` (MIT) |
| Runtime | `onnxruntime-web` 1.31.1 (MIT), WebAssembly, one thread, CPU only |
| Download | 46,792,602 bytes: five model files (31.9 MB) and the runtime binary (14.8 MB) |

- The application uses ONNX Runtime Web directly. The preprocessing, the decoding loop and the token decoder are small files of this repository (`moonshine.ts`, `tokenDecoder.ts`). There is no library that fetches models by itself, so there is no default hub or CDN to switch off.
- The decoding loop gives the same text as the Transformers.js pipeline on 16 of 16 synthetic clips. The token decoder gives the same text as the publisher's tokenizer library on 34,662 comparisons with the pinned vocabulary: 1,882 texts, 12 raw token lists and each of the 32,768 tokens.
- The output is limited to 6.5 tokens per second of audio, as the model's card advises, because the model can repeat itself on short clips.
- A file is pinned by its size and SHA-256 in [`pinned-files.json`](../../src/features/pronunciation/models/pinned-files.json). The model revision must be a full commit identifier. A test fails when the pinned runtime is not the file of the installed package.

### Installation

- Only pinned files are requested, each from one fixed address of the application's own origin. A redirect is refused and not followed.
- A file is held in memory until its size and SHA-256 matched. Only then is it stored.
- The cache is `eng-trainer-v3-models`. A marker, written last, makes an installation usable. Without it, or with one entry missing, the state is "not installed".
- After a failure, a cancellation or an interruption, the files of that unfinished installation are removed. A complete older version stays until a newer one is complete.
- "Delete downloaded model" removes this cache and nothing else.
- Each file is checked again when the Worker reads it.

Not part of stage A: the capacity and persistence checks, and everything else of the Data Safety Gate.

## Network boundary

GitHub Pages cannot send a policy header. A Worker that is loaded from an address has the policy of that address's response, so on Pages it would have none. The boundary therefore has these parts:

| Party | Mechanism | Enforced by |
|---|---|---|
| Page | A Content-Security-Policy in a meta element of the built page ([`scripts/pronunciation-policy.mjs`](../../scripts/pronunciation-policy.mjs)) | The browser |
| Worker | It is started from a `blob:` address, so it inherits the page's policy ([`bootstrap.ts`](../../src/features/pronunciation/recognition/bootstrap.ts)) | The browser, shown for Chromium 159 and Firefox 159 |
| Worker, second layer | Its first statement takes `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `WebTransport` and `importScripts` away, before the runtime library runs ([`lockdown.ts`](../../src/features/pronunciation/recognition/lockdown.ts)) | Application code. It cannot stop a dynamic `import()`. |
| Runtime library | It gets its binary and the model as verified bytes, runs on one thread and starts no helper | Application code |
| Files | Size and SHA-256 against the pinned list, before caching and before use | Application code |

Two details of the policy matter:

- **`worker-src blob:` and nothing else.** A Worker loaded from an address is refused, on the page and inside the Worker. So no code can start a Worker that the policy does not govern.
- **The blob holds one dynamic `import()`** of the real Worker module. A dynamic import is a script request, allowed by `script-src 'self'`. A static import would be a worker request, and allowing that would allow Workers loaded from an address.

The policy is written into the built page only. The development server needs inline scripts and its own WebSocket.

**What is claimed.** In Chromium 159 and Firefox 159, on a server without policy headers, the recognizer's Worker cannot reach another origin by `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` or a dynamic `import()`, and the other origin receives nothing. For any other browser, including Safari, this is not shown and not claimed.

## Checks

| Check | Command | Runs in CI |
|---|---|---|
| Unit and integration tests of the feature, 174 | `npm run test:v3` | yes |
| Source rules: each sensitive interface in one file, the Worker's first import, the pinned runtime | `npm test` | yes |
| Page policy and the prototype tools | `npm test` | yes |
| Gates on both builds | `npm run check:products` | yes |
| Deliberate faults against the gates, 34 | `npm run check:negative` | yes |
| Browser acceptance test, 78 checks | `scripts/acceptance/pronunciation.mjs` | no |

The browser acceptance test needs an installed Playwright, the local model and a synthetic speech clip:

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/acceptance/make-speech.ps1 -Out .local/acceptance/clip.wav
PROBE_PLAYWRIGHT=<folder of a "playwright" package> node scripts/acceptance/pronunciation.mjs chromium --audio .local/acceptance/clip.wav --expect "I would like to clarify the requirements before we start"
```

It checks, in new browser profiles: the boundary on the page and inside the real Worker; the installer under a wrong hash, a redirect, a missing file, an interruption, a cancellation and a restart; a recording with the network cut and no request from the click to the text; retry; release of the microphone on stop, cancel, a hidden page and leaving the screen; that deleting the model leaves made-up v1, v2 and v3 data unchanged; that the other screens and the stable product load no speech code; and the waits and the failure of the section above, with the audio device and the recorder's script held back by the test and a Worker that throws while it recognizes.

## How the stable product stays unchanged

- The Pronunciation screen is reached through one dynamic import behind the compile-time constant `__ENG_PRONUNCIATION__`.
- A stable build also gets an empty module in place of `src/features/pronunciation/` (`vite.config.ts`). Without that, the bundler would read the guarded module before it drops it, and the Worker, the worklet and the runtime binary would be written into the stable build folder although nothing refers to them.
- The released-site lock decides: the stable site must be the 33 released files. `check:negative` shows that the gates fail when the guard, the exclusion or both are taken away.

## Open

| Topic | Needed before |
|---|---|
| Data Safety Gate: backup, recovery, capacity and persistence checks | Any profile with real data |
| Memory and speed on phones and on Safari; the boundary in Safari | Stage B |
| Whether a `blob:` Worker inherits the policy in other browsers | Offering the feature there |
| Reference playback of the phrase, and which speech-synthesis voices stay on the device | The practice screen of stage B |
| A browser's own on-device recognizer as a second provider | A manual check with a real microphone |
| Comparison, feedback wording, uncertainty | V3-03 |
| Spoken hints, attempt history, the overlay's per-target effect | V3-04 |
| Level limits (silence, clipping, 20 seconds) | Real devices |
