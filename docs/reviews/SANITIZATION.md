# Sanitization of the ENG-V2-01 review evidence

Date: 2026-11-21. Applies to `docs/reviews/` as committed in `354c3ac`. Approved by the repository owner before PR #2 was merged.

## Summary

The review evidence recorded absolute paths of the computer the reviews ran on, including its user folder and temporary folders. No credentials or other secrets were found. This change removes those paths. Findings, results and reproduction instructions are unchanged.

| Change | Files |
|---|---:|
| Absolute local paths replaced with placeholders: the two review reports and 41 evidence files | 43 |
| Logs removed | 10 |
| Unchanged: scripts, the patch, screenshots and the other evidence files | 67 |

The repository owner keeps a private copy of all 120 original files outside Git, in two forms: exactly as committed in `354c3ac`, and as the working copies whose SHA-256 the review inventories recorded.

## Replacement rules

| Placeholder | Replaces | Replacements |
|---|---|---:|
| `<repo>` | The local checkout of this repository, `<drive>:\Users\<account>\Desktop\Repos\eng-trainer` | 133 |
| `<review-temp>` | The temporary copy used by the first review, a folder `eng-v2-01-astra-<id>` in the temporary folder of the local user | 31 |
| `<home>` | Any other path in the local user folder | 0 |

- Each rule matches the path in every form found in the files: `\`, `\\` (escaped in JSON and in diff headers), `/`, upper- and lower-case drive letters, `file:///` URLs, the Git Bash form of a drive path, and the short 8.3 form of the account name. A path also matches when it directly follows an escape such as `\n` or an ANSI colour code.
- Only the matched prefix is replaced. The rest of each path, its separators and all other text stay as they were.
- Names of the disposable review workspaces inside the repository, such as `.astra-review-…`, are relative and were kept.
- In each of the two review reports only the "Repository" row changed.

## Removed logs

The ten `*.sandbox.log` and `*.temp-parent.log` files in `eng-v2-01-astra/` recorded failed builds of a review copy in a temporary folder. The first review report describes such failures as environment problems, not defects of the application. No report links to these files and no review script reads them. The inventories in `eng-v2-01-rc1-astra/` still list them.

The RC1 review recorded the SHA-256 of the working copy, which used CRLF line endings. Git stores the files with LF.

| File | SHA-256 in `354c3ac` | SHA-256 recorded by the RC1 review |
|---|---|---|
| `eng-v2-01-astra/build-site.sandbox.log` | `ebb91c293841dd7681c36daf222b184afd363e978b97c977c80f022d1d345c67` | `562a7e4ecb65b86c4185d43d3f65524596964b7c9334234e691d8b10d5f39182` |
| `eng-v2-01-astra/build-site.temp-parent.log` | `a982caa00c280c93202a5aa9eabfd19a835dee3f9f64488fb24b896db318f9ba` | `0e558a958f9bf01790c9561bc9051cda17b593bd0c768d252664cf36de13d773` |
| `eng-v2-01-astra/check-v1.sandbox.log` | `7815e0feca3df0f0323c3551eecf9e78086941b2010bd75a0801b9b4a7631b8d` | `77f2acd23adda6725a3ec58998c31640d6e6c6f7fc6a16fa1313ae481661a9e5` |
| `eng-v2-01-astra/check-v1.temp-parent.log` | `6768dd0a43718ffff59ff28c6fe05a00ae8331a2fc80e5c7792feb38bf5f0463` | `3eaaaec3006751c378299b5158bdd6047f879ca84f51ea1a58a0e20242c73405` |
| `eng-v2-01-astra/check-v2.sandbox.log` | `60f04a262d82194bc53b5287a43d01b473f52fd28c6158aaacbdb22b6d7cfe29` | `eccf6c32df596958e742786fd00ea7027d76875a5aaf4e891acb0fc6d449acbb` |
| `eng-v2-01-astra/check-v2.temp-parent.log` | `94f85f07d855b4f6dec3a57b480dce22f7f11e856561ebecacf9160a913be35a` | `dc71f8739338278daeb6791585e4e865fc8b5a4c231af529cd8f464701579586` |
| `eng-v2-01-astra/tests-v1.sandbox.log` | `fdbfff242b5f7637a7effd591314142e38ea6b05dbdc517fcf17e532ebe11abc` | `d6c6cdb32aa8a70368694c9e1078f310550a536e15317cdbb3a52f1b9f9fb981` |
| `eng-v2-01-astra/tests-v1.temp-parent.log` | `6b914476e76c77b07e2bc7e6f6b9a8075f54883490106142ff9d39cf42ba2e66` | `a57168471a0540337aef09fb3981a025a35f3b2c2fc49886ee9eae63bdc665e9` |
| `eng-v2-01-astra/tests-v2.sandbox.log` | `565499aec25485c9d924b45ab97d62d2222d9d0177a99d5a8b44b40183875cee` | `89cc259a25100274bf4953f57774c14e6fef32ac75c37aec98ba5688f2de9f69` |
| `eng-v2-01-astra/tests-v2.temp-parent.log` | `f1bc19a7b3d80b5711ecee9a831de49d3936facf176e74bb17f369cd287cc817` | `5debb6d0ea13b9d56735760864ecf5103219c637d75d24db851d4f6fa7f57cc5` |

## Sanitized files

| File | `<repo>` | `<review-temp>` | SHA-256 in `354c3ac` | SHA-256 now |
|---|---:|---:|---|---|
| `ENG-V2-01-ASTRA.md` | 1 | 0 | `f40d40cccc3eb9292f8df0dcc4a06cf0f73983059557e5583b5603906b29dda2` | `a98a3a85fada640cec5471221f7a65227d03fc4cd0ccf960f0d587fe92d2e601` |
| `eng-v2-01-astra/browser-chromium.json` | 6 | 0 | `47f7ad3b97d7494a974d9dc262c94e59d2ae985e104d32c5191c0f17176bba66` | `a53eb3d1ed41e0096acca601eb72c8c1ce96e89d29559d73af24373f6b7f7688` |
| `eng-v2-01-astra/browser-firefox.json` | 6 | 0 | `639aa75f4634892a64dee0491a41778ab9a98089dea2a89431b0e635db2b8c0f` | `8a8d764187d2e667543e058d01c6363aa4c575845cc70ef2089e2320b37512ee` |
| `eng-v2-01-astra/candidate.json` | 1 | 2 | `f45953bb148bc687aeae08daa0ddf6f0416d4648452040eb6dd36bd6de69c585` | `0fef43f236d91bb77f4ec48c1aa8a0f490b4cd1e588e8773a108302e1004fbe9` |
| `eng-v2-01-astra/check-v1.log` | 1 | 0 | `46c45ff9db5c68b4e7cd8ba19bda9a38155ec74a80f0b929e4ab47956967260b` | `5272d0a0e94071f6d13101916eaa214427e0e1c6ab55c66d52450fbd1cf1783e` |
| `eng-v2-01-astra/check-v2.log` | 1 | 0 | `4de7118689523b784167bcb6a8935d4347103d0d61c0902aecb6db5718e62688` | `6f7a18cb691d8c7a181dd1f9c911639deaa6abe16c9d04dee0ca3f4226feacbd` |
| `eng-v2-01-astra/scope-probe.json` | 4 | 0 | `e51e73c04aee1d37529a4cb5b1cec0db6abb077c849bd2b9484c7d7e66b42c37` | `a73682ab145ccfc7ab6ce9cab745d8098215c46dfe79081b0c272f6c2b05852f` |
| `eng-v2-01-astra/tests-v1.log` | 1 | 0 | `8442ca3ae20ad21f43cfb34521c9fe41ce088522ad1ca315e48ee00af3d78c23` | `a28c8d61b0cda5284edbf6385ab6f246596d0723b687a721ae8c70f8217b48f0` |
| `eng-v2-01-astra/tests-v2.log` | 1 | 0 | `3caa037719e787a8e23613bc9ca22090ebbd7761139347f14e52ce865ad7fc28` | `138f388eacd6419b825277b7a984893a209cb08a893a5b965baa4d730d3f6074` |
| `ENG-V2-01-RC1-ASTRA.md` | 1 | 0 | `29e04b784468ca43fcff55e951b4ad04322e30c1451ecba7a8c4780985cc501b` | `fba8ee24d7c934d5dcf4ae987a811cce0366eddc4b5ab761928d1f62a54cd356` |
| `eng-v2-01-rc1-astra/browser-unchanged.log` | 4 | 0 | `740a52b3d1c1deacc4853373d78839c8531b07c0f6de31a8ec22af9d8db74099` | `c007f4c4f79cc344ca120095172305b700a7eeca2960762ac65755760524ece1` |
| `eng-v2-01-rc1-astra/candidate-delta.diff` | 26 | 26 | `e2cc6f39364b50476db24c563d61b30e391d79afd733a94e3040a780b92a5749` | `4aa69fcc007b05384638e9dea3478e5f4e06735ecaa17474262cac91cad1b958` |
| `eng-v2-01-rc1-astra/candidate.json` | 2 | 1 | `6135db13af3efcd92a7b145b48018b3a19956c22c01807b214b3e226c1d22867` | `50d2b3660539032288c68800b41f1c64c87e9f91f06db8316370c7e983377079` |
| `eng-v2-01-rc1-astra/check-v1.log` | 1 | 0 | `ce2c06c4569d6cf1af0bb3bed29815b401422230c30c80bb546efd6e46b6ea15` | `856053e0fa33da99dc16f3f593d113ea77da5d74be058784438c14a8a8167c94` |
| `eng-v2-01-rc1-astra/check-v2.log` | 1 | 0 | `fbac7e7f800e055f3d7b6f1641c278ab92feceaf21e91ba1ddf54c647708c164` | `cb368fc00148d8c904a73446fe5154b28480783475abc2c601b56131b6963237` |
| `eng-v2-01-rc1-astra/corpus-audit.json` | 1 | 1 | `bb7b53d55b48ae221f0d2bc24defa624c36128e2a37e627c1d3222de9f413e0b` | `ffde618badf1369a18d14fb6f5c0cc15ba388c69d160b2d94a64198feda7a0c4` |
| `eng-v2-01-rc1-astra/corpus-audit.log` | 1 | 1 | `0eb6b4e60d32b8fb7d636a6f969d108ed96b9f94f671dbfdb0786a18a453c9ea` | `31c408c8c0b29b5ae2605c2048fe7d5703a5819f32ed880b9ffff05b1151c656` |
| `eng-v2-01-rc1-astra/corrected-final/browser-chromium.json` | 1 | 0 | `1ec0e225dd3b376e2c51d4faf4190166b308551ce28fb1a8ffbd37ca6485a12f` | `e79a477140d9cae0e66970893d59a1d3f889157e19e9bf168bad09fcd61b2638` |
| `eng-v2-01-rc1-astra/corrected-final/browser-firefox.json` | 1 | 0 | `98840442651f1633cb2e7aeec18824353e5a3e262231e1cf3d2608400d4fedb8` | `f2776b6eb081c783e5d374fd2f9861df3d7fe5a9a607f8e2f21a6f2017492d2d` |
| `eng-v2-01-rc1-astra/corrected/browser-chromium.json` | 3 | 0 | `47145df0a90e14410471f71432659317a5af61339694ee38766fe64266859bda` | `e802526d53c2871b087de397540a1e2a7931fc6b1b80881ef5c81255eee750a6` |
| `eng-v2-01-rc1-astra/corrected/browser-firefox.json` | 3 | 0 | `66398ddef3f5367c6da557de82ea5e8e925240bd7ee6750787274ddf2efe903b` | `ebf181507686aa3840d749b5ef9777b10b31866ad8441157fa4c02fe7bd6352a` |
| `eng-v2-01-rc1-astra/fable-supplement/identity-supplement-chromium.json` | 1 | 0 | `449927c6fad8d02d2f1b824acabc8abbdbbcf95c6d8ba03e3abc412bc4acd971` | `61364b1d2c6b1d503b41c1a984081d87cf2c7d94b80fc3af8fe47d96159aaec5` |
| `eng-v2-01-rc1-astra/fable-supplement/identity-supplement-firefox.json` | 1 | 0 | `1ad9ba47fd971b2913b07b3ed2ac9ad71c50777552ff601ecec4d4ba33153fe0` | `a486a96e04c5034c47050d4a7ca162d8682069072e9f4d160bd17889a45c7cd5` |
| `eng-v2-01-rc1-astra/independent-browser.log` | 8 | 0 | `38dec6d1c7e4eeeedce50883a6d3866f6a73bae2a3c16dc8299c6fae243cca07` | `76c088bb757c51395724e99003295db1f5f6001e5c091a811f35e2e8e8980a07` |
| `eng-v2-01-rc1-astra/independent-final/independent-chromium.json` | 1 | 0 | `3bfacccb26702267c1ba3216e3a32133d31a1fef1b9ef9ac18af3c8e0155f8f1` | `369da525dd91f5a8dfdace5d6be32f7f492292af761e251f11ac707d0e1e56e1` |
| `eng-v2-01-rc1-astra/independent-final/independent-firefox.json` | 1 | 0 | `d431b5309a6a2a872d52886367ad615900fe19177e015eeb341aeeb27d25fa01` | `a96146d8c279f10fb75c085c612a3474c02f5ec021ea654e8109f3955db9eac4` |
| `eng-v2-01-rc1-astra/independent/independent-chromium.json` | 5 | 0 | `a8ef14ae023d0e1971f226a4bbb7d28ffae4fcb77b1891477bbf90f23308b93f` | `4d0c07724937d31d62c48023f9e2ae9fd165da3da9a400b04b759d1519b83562` |
| `eng-v2-01-rc1-astra/independent/independent-firefox.json` | 5 | 0 | `9191331b5db4736864c33683d6b7da84e323d660d701612b754ecd569eae9058` | `f8eef1de9be43721355f0feb80890cc95837eebda28223376828ef9378d928e0` |
| `eng-v2-01-rc1-astra/test-v1.log` | 1 | 0 | `7dd0773c6477c190bad2445e12b2d706c2ace47ac9061d6ec4dd6922ca5538fd` | `0ef88949ef36217e72cfc8738cbffe6cbf472172a54e6dbeeb3658a00acff717` |
| `eng-v2-01-rc1-astra/test-v2.log` | 1 | 0 | `8e5852fc47508141763901e344440479e417e3204a73b4ed4da26d011e46b096` | `ac6fb4a1825c35c079f18e05da368fba0895ecfbaa67c7c35171a9bd0850eb90` |
| `eng-v2-01-rc1-astra/unchanged/browser-chromium.json` | 3 | 0 | `332b5853a6aab0efb236418e3340c1ff909c50050da6856eb458dc1219e7c51b` | `f0e52a4ca1a2754558202df92408dc2dae56cfdc8d2b4434f5f92babacb0a05d` |
| `eng-v2-01-rc1-astra/unchanged/browser-firefox.json` | 3 | 0 | `1779bf4d9f8bf490a0ee21421a62dfb212102aedbaec1fb2114a8060c8a76911` | `330c0613613de4d026bad7b4f4d4e17baa4086094a9ee169559a0c479c4132e3` |
| `eng-v2-01-rc1-astra/verification-summary.json` | 19 | 0 | `9112aa92fd88fcff50fd97b2a25c14390ad8e0a67e1619a986541c79297d2127` | `f0d8ca091cb477e342e29bc25f1f0a78bdd8567b2159537826349e1e7e02edf6` |
| `eng-v2-01-rc1-astra/verification-summary.log` | 1 | 0 | `3ebc62d17103949bbaf690d56a87e9fa8d5e7a0102c5f49d2f655f8c1b5b0e37` | `a0e94f29d0a8138343960aa8177a56e3c0374bf852cfa69871152896a8399bc5` |
| `eng-v2-01-rc1-fable/astra-suite-run.log` | 4 | 0 | `ced307c8644d29701d022d0eeb1744a961e786c716fd9e97d70ae1d3cfb7beac` | `b88c0dc91506a4986ffc2c444027b008e4dfcd68bd4f90eeed08b0f7d89cb7f8` |
| `eng-v2-01-rc1-fable/browser-chromium.json` | 3 | 0 | `361b81967279275106e2df0edf74e9298a2e3c44ce17b693ada144c1bb4b122f` | `fa81327069ef97d20c2c6b106f175984539708da48650b3bca7de6bb82dfcc00` |
| `eng-v2-01-rc1-fable/browser-firefox.json` | 3 | 0 | `ba9dd45e1bdb2ce889ef42e91a899b9a19e64384e07ec9ea4aa895d7ce851366` | `51c7afc6fa2ebc2f3d1e17524fbbee6b9886722598beb5164562f54c8ace0f31` |
| `eng-v2-01-rc1-fable/identity-supplement-chromium.json` | 1 | 0 | `8f49a11f6fdd655f3ee65a23f4b01283a9d50f32c3b8858b0fdfaf48954d97f8` | `617fadc1b16fc05b845eecb70f0d33d6225ffeeeaf4ad336d866404d4d31e720` |
| `eng-v2-01-rc1-fable/identity-supplement-firefox.json` | 1 | 0 | `e1a5e909b72e4cdf990bb23c08f5bcd161379d9988726b29bc335d6e6f92c4de` | `119da2330e6bfcc75ab7b0c3f4fdf69c2cdb1a2e221583f08f794dd80f50cea2` |
| `eng-v2-01-rc1-fable/logs/check-v1.log` | 1 | 0 | `fb7603ce7f4bcbc6918811e2e3f1e3c2ebbec398d644ba26664cb915543a8c6a` | `741fbbfaf721a0fcac74720d63d90c36958f7bb55646ffe48fa3063e80602a30` |
| `eng-v2-01-rc1-fable/logs/check.log` | 1 | 0 | `2a138bc90ac329ebe2b156209ad5d33b0cd6cc20daaccbdbace7db841dad9ecd` | `ba7dc2ab0812ecc44a80dc6ed586181a8f6f043334b587b51435ae21c886ca0c` |
| `eng-v2-01-rc1-fable/logs/test-v1.log` | 1 | 0 | `3907ec342c9714b51e909e8b857ae41e091b40a1b16a2bedd63b51178fe2eabf` | `224da928cabbda8e3066a0bf92c88809c7efbb563d15a92c4f1d6c47aaae1ddd` |
| `eng-v2-01-rc1-fable/logs/test.log` | 1 | 0 | `f6b90218086285d47a59429f9d476b9183cd23c30e9a8026222b4aee8647f04f` | `07b928e93639e716f4a3dac0518200079d027f15b520139317cef8a8dced0a90` |

## Hashes and preservation checks

- The SHA-256 values above are of the file content as stored in Git, with LF line endings. This is also what GitHub serves. A Windows checkout with `core.autocrlf=true` has CRLF line endings and therefore different hashes.
- The inventories in [eng-v2-01-rc1-astra/candidate.json](eng-v2-01-rc1-astra/candidate.json), [source-audit.json](eng-v2-01-rc1-astra/source-audit.json) and [final-preservation.json](eng-v2-01-rc1-astra/final-preservation.json) record the hashes of the working copies at review time. For 22 files in `eng-v2-01-astra/` those working copies used CRLF, so the recorded hashes already differed from the committed files before this change. 5 of those files were sanitized here; their recorded hashes are:

| File | SHA-256 recorded by the RC1 review |
|---|---|
| `eng-v2-01-astra/candidate.json` | `b80e0969cb2cb87d4cc379446a4c58ccd2a39df1d2aee3414e2acb280c32bdd6` |
| `eng-v2-01-astra/check-v1.log` | `2778d3b6670f5e55d96823d9407222999d8d0db26b984706845450e8dc615310` |
| `eng-v2-01-astra/check-v2.log` | `8311fd80cb1d6ff180c37ebcd722c2176fcd24564b28c7b0cc2b6c57613d2e46` |
| `eng-v2-01-astra/tests-v1.log` | `f76578d83001e09916840d9c9a6ac953d6c44f1f5e85ff8eadc97e15de133997` |
| `eng-v2-01-astra/tests-v2.log` | `944780858acf383b5d0780ec538a5206401bd16bf72749fb74eae4fba75baa12` |

- `eng-v2-01-astra/source-audit.mjs` and `eng-v2-01-rc1-astra/verify-preservation.mjs` compare files with those recorded hashes and look up the review workspaces through the absolute paths in `candidate.json`. Against this tree they report the sanitized and removed files as changed, and the workspace paths are now placeholders. The workspaces were disposable and were deleted after each review, so those snapshot comparisons could not be repeated in any case.
- The browser scenario scripts take the candidate folder and the tools folder as command-line arguments. They, the corpus audit and the reproduction commands in the reports are unchanged.

## Verification

Run on the staged change before it was committed:

- The change modifies 43 files, deletes 10 and adds this file, all in `docs/reviews/`. Nothing outside `docs/` changed. No script, patch or screenshot changed: all 41 are byte-identical to `354c3ac`.
- No tracked file contains an absolute local path, the account name, a local temporary folder or the name of the temporary review copy.
- Each sanitized file is exactly its `354c3ac` content with only these rules applied (43 of 43).
- The 23 sanitized JSON files parse. Applying the rules to every string of the original JSON gives exactly the sanitized structure and values (23 of 23).
- The 20 sanitized text files (logs, a diff and the two reports) keep their line count. 72 lines changed, each only by the rules (20 of 20).
- All 32 JSON files under `docs/reviews/` parse, and all relative links in the tracked Markdown files resolve.
- The private copy was checked before the change: all 120 committed files match, and the working copies match all 57 hashes recorded by the RC1 review for files under `docs/reviews/`.
