# Model storage safety (ENG-V3-R1B)

The speech model of the [pronunciation prototype](PRONUNCIATION-PROTOTYPE.md) is 47 MB. It is kept in the same browser storage as the learning data of every version of the trainer. This document describes how the experimental product manages that storage: what it checks before a model is stored, what it never touches, and what it cannot protect against.

This is the second part of the Data Safety Gate. The first part is [Backup and recovery](BACKUP-AND-RECOVERY.md).

**Status.** The download is still offered on a loopback address only, for disposable browser profiles with made-up data. The experimental product is not published, and no build contains a model file. This milestone does not open a way to install a model in an ordinary profile. What that would need is an owner decision: see [Backup, installation and eviction](#backup-installation-and-eviction).

**Corrected after review (ENG-V3-R1B-RC1).** An independent review of the first candidate found four defects. This document describes the corrected design:

| Finding | What was wrong | Where the correction is described |
|---|---|---|
| F1 | "Load" could download a model that another tab had removed, without the question before a download | [Rule 2](#2-loading-and-installing-are-two-operations) |
| F2 | In a browser without Web Locks, changes of the model cache ran without coordination | [Rule 6](#6-one-change-at-a-time-or-none) |
| F3 | The 64 MB were described as room that stays free | [What the headroom is, and what it is not](#what-the-headroom-is-and-what-it-is-not) |
| F4 | "Looking never creates the cache" was not true in one schedule | [A look is not a snapshot](#a-look-is-not-a-snapshot) |

## The problem

- A browser gives one storage area to one site. The first version, the stable version, the experimental version and the model cache all live in it.
- That area has one limit. A model of 47 MB sits next to learning data of a few hundred kilobytes.
- When a browser removes the data of a site by itself, it removes all of it: the learning data of every version together with the model.
- When the area is full, a browser refuses new writes. In Firefox, with the site's storage full, a new database could not be created.

So a model is not stored when the browser's estimate shows too little room, it must never be half installed and usable, and it must be removable without touching anything else.

## What the browser's interfaces give, and what they do not

| Interface | What it gives | What it does not give |
|---|---|---|
| `navigator.storage.estimate()` | Two rough numbers for the whole site: usage and limit | A reservation. A write can fail a moment later. The numbers can lag, and they need not follow a limit that the browser enforces |
| `navigator.storage.persisted()` | Whether the browser says that it will not remove the site's data by itself | A statement about a backup, or about data that the learner or the system clears |
| `navigator.storage.persist()` | A request for that. Chromium decides by itself. Firefox asks the learner | A guarantee. The browser may refuse, and an agreement covers only what the browser would remove by itself |
| Cache Storage | The model cache | Transactions over several entries. An installation is several writes. A way to open a cache only if it exists |
| Web Locks | One change of the model cache at a time, across tabs | Anything in a browser that has no such locks. There, the model cache is not changed at all |

No browser interface lets an application reserve storage, prevent "clear site data", survive the loss of a profile or a device, or find out whether a backup file exists outside the browser.

## Rules

### 1. Room before a download

```text
free  = limit - usage                      (the browser's estimate for the whole site)
need  = every file still to be stored      46.8 MB for a complete download
      + the largest of them once more      20.2 MB: a browser may hold a file twice while it stores it
      + headroom for learning data         64.0 MB
      = 131.0 MB for a complete download
```

- A download starts only when `free >= need`.
- **Unknown counts as insufficient.** No storage manager, no estimate, an estimate that fails, one that does not come within five seconds, or numbers that make no sense: no download.
- The estimate is read again **before each file**, for what is still to be stored. A storage that filled up meanwhile ends the download before the next request.
- What the site uses already is never counted as room: not the learning data, and not an older model that is kept until a new one is complete.
- **A write can fail all the same.** That ends the installation like any other failure, and the installer removes the files of its attempt.
- The application never makes room. It removes no database, no record and no other cache, and it never advises the learner to clear the site's data.

The headroom is 64 MB. A backup file of all three products is 32 MiB at most ([Backup and recovery](BACKUP-AND-RECOVERY.md)), so the headroom is about twice the largest amount of learning data that the application can handle. It is defined in one place, [`capacity.ts`](../../src/features/pronunciation/models/capacity.ts).

#### What the headroom is, and what it is not

The headroom is a policy for **when a download is refused**. It is applied to the browser's estimate. It is not room that the application keeps.

- **The numbers are approximate.** The estimate is the browser's rough statement about the whole site. It can lag behind a write or a deletion, and it need not follow a limit that the browser enforces.
- **Nothing is reserved.** The application has no way to set storage aside. Another tab, another version of the trainer or the browser itself can use the room a moment after it was estimated.
- **A successful installation does not mean that 64 MB are left.** The review showed this in Chromium: with the site's limit set to 60,000,000 bytes, the estimate still reported about 10 GiB. The installation succeeded with 46,869,088 bytes used, so 13,130,912 bytes were left. The acceptance test repeats this measurement (checks Q4 to Q7).
- **Later writes can still be refused.** A save of learning data, or a recovery from a backup file, can fail for lack of room after a model was installed. The model can be the reason.
- **Persistence does not replace a backup.** A browser that agreed to keep the site's data has not copied it anywhere.

What the rule does: it refuses a download whenever the browser itself reports too little room, or reports nothing. What it cannot do: make the report right. The screen says this next to the numbers, and the question before a download says it again.

### 2. Loading and installing are two operations

| | Load | Install |
|---|---|---|
| What it does | Brings a model that is in the cache into memory | Downloads the files, checks them, stores them. Then loads |
| Screen | **Load the speech model**, offered only while the cache holds a complete installation | **Download and install**, then the question, then the learner's statement |
| Session | `prepare()` | `install({ confirmed })` |
| Recognizer | `prepare({ signal })` | `install({ confirmed, signal, onProgress })` |
| Can request a model file | **Never** | Only with `confirmed: true`, with room by the estimate, and with the lock |

**Loading never installs.** The recognizer looks at the cache itself when it is asked to load. Files that are not there are a refusal, not a reason to download. So it does not matter what the screen believed: a model that another tab removed a moment ago is not fetched again.

When "Load" finds no files, the screen says that the model is not in this browser any more, that nothing was downloaded, and offers the download again. The way back is the whole installation: the question, the statement, the confirmation.

**The confirmation is enforced where a download starts.** `installModel` in [`install.ts`](../../src/features/pronunciation/models/install.ts) is the entry point of every download. It refuses unless it is told `confirmed: true`, before it asks for the lock and before anything is requested. The session and the screen check too, but a caller that skips them still gets no download. One place in the application passes `true`: the handler of the confirmation button in the question.

```text
open the screen       the estimate and the browser's state are read. Nothing is asked, nothing is written
click "Download"      the estimate is read again. With room, a question opens. Nothing is requested
the question          the numbers, what a browser may do with a site's data, the link to the Backup screen,
                      and a statement that the learner makes: a backup file exists, or the profile holds
                      nothing to keep
click "Download and install" in the question
                      the session checks coordination, room and the confirmation once more.
                      Then the installer checks the confirmation, takes the lock, and runs
```

- Without room there is no download control. The screen shows the numbers and what is missing.
- Without the learner's own statement the confirmation is disabled. The statement is unset each time the question opens.
- The session refuses a download without room or without the confirmation, whatever the screen does.
- Two requests at once start one download. A screen that is left while the estimate is read starts nothing.
- **A complete installation is left alone.** Under the lock, the installer first looks whether the cache already holds a complete installation, for example one that another tab finished. If so, it requests and removes nothing.
- There is no fallback: no other host, no browser recognizer, no cloud service.

**What the screen offers follows the cache.** Each time the session reads the storage (when the screen opens, on **Read again**, after every change), "can be loaded" is set from what the cache holds at that moment. A cache that another tab changed therefore changes the controls of this screen, in both directions, without reopening it.

**A model in memory is a separate fact.** A model that was loaded stays usable in this tab until the screen is left, also when another tab removes its files. Removing files does not take a model out of another tab's memory. The screen then shows both facts: the model is loaded, and its files are not in this browser. It cannot be loaded again without a new download.

### 3. What the model cache holds

The cache is `eng-trainer-v3-models`. An installation is the pinned files and a marker that is written last.

| State | Meaning | Offered |
|---|---|---|
| absent | No entry of this version | Download |
| installed | The marker, and every pinned file, stored with its pinned length | Load, Check the installed files, Delete |
| incomplete | Files without the marker: a download that did not finish | Download, Remove these files |
| damaged | The marker, but a file is missing or was stored with another length | Download, Remove these files |

- Only "installed" can be loaded. Nothing else is ever offered for loading.
- The quick look reads the entries and the length that was stored with each file. It reads no file, so opening the screen does not read 47 MB.
- Sizes and contents are compared with the pinned list each time a file is read: by the recognizer's Worker when it loads the model, and by **Check the installed files** on request.
- A file that was damaged after it was stored is therefore found when it is read. The Worker refuses it, nothing becomes ready, and the screen names the file and offers to remove the files.
- Entries of another version are counted apart. A completed installation removes them. A failed one does not touch them.

#### A look is not a snapshot

Reading takes no lock. A look at the cache, a full check and the Worker's reading can run while another tab installs or removes.

- **A look describes a moment.** It can be out of date when it is shown. During another tab's installation it reports "incomplete". During another tab's removal it can report "incomplete" or "damaged".
- **A look can leave an empty cache behind.** A look first asks whether the cache exists, and opens it only then. The browser has no way to open a cache only if it exists. When another tab deletes the cache between the two calls, the opening creates it again, empty. That cache holds nothing and is reported as "absent". The next installation fills it, and the next removal deletes it. Nothing is fetched or removed because of it.
- **Nothing depends on a look being right.** "Load" looks again by itself, and the Worker checks the size and the SHA-256 of every file it reads. A file that changed or disappeared meanwhile is refused.

This limitation is accepted and tested, not removed. Readers that take the lock would delay every opening of the screen behind a download in another tab, and would add a second lifecycle to coordinate.

### 4. Interruption and retry

- After a failure or a cancellation the installer removes the files of its own attempt.
- When the browser is closed in the middle, files without a marker may stay. They are "incomplete", and a new session says so.
- A retry removes them first and requests every file again. A leftover is never reused.
- **The marker is written last and deleted first.** An interrupted installation and an interrupted deletion both leave files without a marker. Neither leaves a marker that promises files.
- A cleanup that fails does not hide the failure that caused it. What it leaves is "incomplete".
- Each failure names what happened and says that the learning data was not changed.

### 5. Removal

- **Delete downloaded model** and **Remove these files** delete the model cache and nothing else.
- Every call on the cache storage names this one cache. The application never lists the caches of the site.
- No code of the feature can reach a database or a key-value record: the source rules forbid those interfaces in the folder.

### 6. One change at a time, or none

An installation, a retry, the cleanup of an attempt and a removal run only while they hold the browser lock `eng-trainer-v3-models`.

| Situation | What happens |
|---|---|
| The lock is free | The change runs and holds the lock until it has finished, including its cleanup |
| The lock is held, in this tab or another one | The request is refused at once and changes nothing |
| The browser has no Web Locks | The request is refused and changes nothing |
| The browser has Web Locks but does not give a lock when asked | The request is refused and changes nothing |

**No lock, no change.** There is no unprotected path. Without coordination, a failed attempt in one tab could remove the files that another tab had just completed, so the cache is not changed where that cannot be ruled out. The lock is the browser's own, asked for with `ifAvailable`. The application adds no locking of its own.

In a browser without Web Locks the screen offers no download and no removal, and says why. A model that is already in the cache can still be loaded there: reading needs no lock. The application offers no removal there, and it does not advise clearing the site's data, because that removes the learning data too.

A removal that is asked for while the same screen installs ends that installation first, waits until its installer has let go of the cache, and then removes.

### 7. The browser's promise to keep data

- The state is read when the screen opens.
- The browser is asked only when the learner chooses **Ask the browser to keep this site's data**.
- The answer is shown as the browser's statement: agreed, did not agree, cannot be asked, could not be asked.
- Next to it the screen always says that none of this is a backup.
- A question that the browser leaves open blocks nothing else on the screen.
- A grant is not required for a download in the prototype, and a refusal blocks nothing.

## Backup, installation and eviction

The backup file of ENG-V3-R1A is the only independent copy of the learning data. A persistence grant, a model cache and a copy inside the browser are not.

**What the application does.** Before a download it shows what a browser may do with a site's data, links to the Backup screen, and requires the learner's own statement.

**What it cannot do.**

- It cannot see whether a backup file exists. ENG-V3-R1A decided not to record that a backup was made, because a record inside the browser proves nothing about a file outside it. The learner's statement is an assertion. It proves nothing about a current, complete file on another device.
- It cannot stop a browser from removing the site's data, and it cannot make the browser promise to keep it.
- It cannot reserve storage for learning data.
- It cannot know how a browser that was not tested here behaves.

**The risk that remains.** A model makes the site use about 47 MB more.

- A browser under storage pressure may remove everything the site keeps.
- A storage that is nearly full may refuse a later save or a later recovery.

The capacity rule refuses a download when the browser's estimate shows too little room. It does not keep room free, and it does not protect against eviction. Only a backup file protects the learning data, and the application cannot verify one.

**Therefore** no way to install a model in an ordinary profile is introduced here. The three controls of stage A stay: the product is not published, no build contains a model, and the download is offered on a loopback address only. The loopback restriction is a restriction of the host. It does not detect whether a profile is disposable: that stays a rule for the person who tests.

**Owner decision before an ordinary profile may install a model.** At least these questions are open:

| Question | Options |
|---|---|
| How strong must the backup step be? | The learner's statement, as now. Or a backup made in the same session, which needs a signal from the Backup screen that ENG-V3-R1A deliberately did not add |
| Must the browser have agreed to keep the data? | Not required, as now. Or required, which excludes browsers that refuse or cannot be asked |
| Is a headroom of 64 MB, judged by an estimate, enough? | It is the proposal of this milestone for decision 13 of the ENG-V3-00 plan. A larger number does not turn an estimate into a reservation |
| Which browsers? | Chromium and Firefox on a desktop were tested. Safari and mobile browsers were not. A browser without Web Locks gets no download |
| Should missing learning data be detected? | Not built. A complete model next to an empty learning database could be shown as a sign of lost data |
| Is the open observation about recognition acceptable? | See [Open observation](#open-observation-a-recording-after-a-reload) |

## What is proven, what depends on the browser, what cannot be guaranteed

**Proven here**, by automated tests and by the browser acceptance test in Chromium 159 and Firefox 159:

- Opening the screen asks the browser for nothing and writes nothing.
- Without room, or without a usable estimate, nothing is requested.
- Without the confirmation, nothing is requested. This holds at the installer itself, not only on the screen.
- "Load" requests no model file. After another tab removed the model, "Load" in a tab that still offered it downloads nothing, says so, and offers the download with its question.
- After another tab installed or removed the model, **Read again** changes what this screen offers, without reopening it.
- A write that the browser refuses leaves no usable installation and no file of the attempt. The learning data of all three products is unchanged, and no other cache is touched.
- A storage that fills up during a download ends it before the next file is requested.
- An interrupted installation is never usable. A retry installs.
- Incomplete and damaged caches are named and never loaded. The Worker refuses a file with one changed byte.
- Removal deletes the model cache only. Every database, every key-value record and every other cache entry is the same before and after, byte by byte.
- With Web Locks, two tabs cannot change the model cache at the same time. Without Web Locks, or when the browser gives no lock, no tab changes it. In the browser this state was injected: both tested browsers have Web Locks.
- Backup and recovery work with a model in the same storage. A backup file holds no model data.
- The stable product and the first version are byte-identical to the release.

**Depends on the browser**, as observed:

| Topic | Chromium 159 | Firefox 159 |
|---|---|---|
| Estimate for a new profile | About 10 GiB limit | 10 GiB limit |
| A limit set for the site | Enforced on writes. The estimate did not show it | Shown by the estimate and enforced |
| An installation under a limit of 60 MB that the estimate does not show | Succeeds. 13.1 MB are left, not 64 MB | Not produced: the estimate shows the limit, so the download is refused |
| Usage reported for 46.8 MB of files | 46.8 MB | 34.3 MB, less than the files |
| Usage reported after a deletion | Still 47 MB right after each deletion. Fallen three seconds after the last one | Still about 35 MB right after most deletions. Fallen some seconds later |
| A refused cache write | `QuotaExceededError` | `NS_ERROR_FILE_NO_DEVICE_SPACE` |
| Request to keep the data | Decided at once, refused for a new profile | The learner is asked. Unanswered, the request stays open |
| A small new database when a cache had filled the site's storage | Created and written. About 1 MB was still free | Refused with `QuotaExceededError` |

In Chromium a real low estimate could not be produced, so that state was injected into the page. The acceptance test marks every injected state.

**Cannot be guaranteed by browser storage interfaces:**

- That an estimate is right, or still right when the write happens.
- That any amount of storage is free after an installation, or stays free.
- That a later save of learning data, or a later recovery, finds room.
- That stored data stays. A browser may remove it, with or without a grant.
- That a browser's usage figure falls when something was deleted.
- That another browser behaves like the two that were tested.

**Not shown, not claimed:**

- Safari, and every browser on a phone or a tablet. Their limits, their eviction rules and their answers to these interfaces differ. WebKit documents a rule that removes script-writable storage of a site after seven days of browser use without interaction with that site. Whether and how it applies has to be checked before the feature is offered there.
- Private windows. Browsers limit or refuse storage there, each in its own way.
- A browser's own eviction. No test here made a browser remove a site's data by itself. What the application does afterwards is the subject of [Backup and recovery](BACKUP-AND-RECOVERY.md).
- A real browser without Web Locks. The refusal was tested with the lock manager taken away or made to fail.
- Loss of learning data caused by a full storage. The measurement with a limit of 60 MB shows that the headroom can be absent. It did not make a save fail.

## Open observation: a recording after a reload

**Unresolved.** During the verification of this milestone, the acceptance test of the pronunciation prototype in Chromium a few times gave no words for a recording made after a reload of the page (its check C15). The same clip gives the expected sentence in almost every run.

What is known:

- The sources of the Worker, of the decoding, of the protocol and of the recorder are unchanged since ENG-V3-R1A.
- The built Worker file did change in ENG-V3-R1B, because it contains [`models/store.ts`](../../src/features/pronunciation/models/store.ts). The correction ENG-V3-R1B-RC1 did not change it again.
- In the one failure that was measured, the length and the loudness of what the Worker was handed were those of a complete recording. The samples themselves were not kept, so the input is not ruled out.
- The reviewer loaded the Worker of ENG-V3-R1A and the Worker of this milestone with the same samples in turn. All answers were the expected sentence.

What is not known: the cause. It is **not** established as a regression of this milestone, and it is **not** shown to be fixed, harmless or unrelated to the changed Worker file. The runs that exist come from different builds, and one failing result was not kept, so their counts must not be added up into a rate.

What is kept for the next failure: the acceptance test [`scripts/acceptance/pronunciation.mjs`](../../scripts/acceptance/pronunciation.mjs) records the SHA-256 of the experimental build and of the Worker file that ran. For every recording that gives other words than expected, it saves the samples that were handed to the Worker, with their SHA-256, next to its result file. Those samples can then be given again to the same Worker file and to the Worker of ENG-V3-R1A.

The inference code was not changed for this observation, and no large repeat campaign was run.

## Parts

Everything is in `src/features/pronunciation/`, which only the experimental product is built from. No shared file changed.

| Part | File | Role |
|---|---|---|
| Capacity and persistence | [`models/capacity.ts`](../../src/features/pronunciation/models/capacity.ts) | The only module that asks the storage manager. Estimate, need, verdict, the request to keep data |
| Lock | [`models/exclusive.ts`](../../src/features/pronunciation/models/exclusive.ts) | One change of the model cache at a time, or a refusal |
| Model cache | [`models/store.ts`](../../src/features/pronunciation/models/store.ts) | States of the cache, the full check, removal. The only module that uses Cache Storage |
| Installer | [`models/install.ts`](../../src/features/pronunciation/models/install.ts) | The entry point of every download: confirmation, lock, room before each file, full-storage failures, cleanup of its own attempt |
| Storage facts | [`models/management.ts`](../../src/features/pronunciation/models/management.ts) | What the screen is told, including whether changes can be coordinated |
| Recognizer | [`recognition/localMl.ts`](../../src/features/pronunciation/recognition/localMl.ts) | `install` and `prepare` as two operations. Passes the confirmation, the estimate and the lock on. Tells refused files apart from other failures |
| Session | [`session.ts`](../../src/features/pronunciation/session.ts) | The order of a download, what can be loaded, messages, what to do with refused files |
| Screen | [`PronunciationPage.svelte`](../../src/features/pronunciation/PronunciationPage.svelte) | The storage panel and the question before a download |

**One change of the recognizer's interface.** [`recognition/types.ts`](../../src/features/pronunciation/recognition/types.ts) described one operation, `prepare`, that installed when it found no files. That one operation was the cause of F1: a request to load could not be told apart from a permission to download at the place where a download starts. The interface now has `install({ confirmed, signal, onProgress })` and `prepare({ signal })`. Nothing else in the interface changed: recording, recognition, cancellation, release and the result are as they were.

The Worker, its protocol, the decoding, the recorder, the pinned list, the page policy and the place where a download is offered are unchanged. The Worker's built file differs from the one of ENG-V3-R1A because it contains `models/store.ts`. ENG-V3-R1B-RC1 left the built Worker file as it was in the first candidate, byte for byte.

## Checks

| Check | Command | Runs in CI |
|---|---|---|
| Unit and integration tests of the feature | `npm run test:v3` | yes |
| Source rules: one module asks the storage manager, one takes the lock and runs no change without it, every cache call names the model cache, loading never reaches the installer, one place confirms a download | `npm test` | yes |
| Gate 9 on the experimental build: the same boundaries in built files | `npm run check:products` | yes |
| Deliberate faults against gate 9, 14 of the 83 negative cases | `npm run check:negative` | yes |
| Browser acceptance test | `scripts/acceptance/model-storage.mjs` | no |

The source rules and gate 9 look at the structure of the code. They do not prove that two tabs behave correctly. That is what the tests of behaviour are for: the real session, recognizer, installer and store against a shared fake cache, and the browser acceptance test with two tabs.

The browser acceptance test needs an installed Playwright and the local model:

```text
npm run prototype:build
npm run prototype:model
PROBE_PLAYWRIGHT=<folder of a "playwright" package> node scripts/acceptance/model-storage.mjs chromium
PROBE_PLAYWRIGHT=<folder of a "playwright" package> node scripts/acceptance/model-storage.mjs firefox
```

It uses new browser profiles and made-up learning data of all three products. It compares the whole storage of the site before and after each step. Where a browser cannot be put into a state for real, the state is injected and the check says "(injected)".

| Part | What it covers |
|---|---|
| O | Two tabs without reopening the screen: removal in one tab, then "Load" and **Read again** in the other. Installation in one tab, then **Read again** in the other |
| P | No coordination (injected): no Web Locks, and a lock request that fails. No download, no removal, an explanation |
| Q | The wording about the estimate. In Chromium also an installation under a limit of 60 MB that the estimate does not show |
