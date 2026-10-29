# Mobile layout fix evidence

Playwright screenshots and `scrollWidth` measurements for the
`fix/mobile-layout-overflow` PR.

- `before-prod-*`: production (`opencoop.be`) at phone widths — reproduces the
  left-edge clipping / period-tab overflow Wouter reported. Prod was still on
  `v2026.43.10`, which does **not** include #206.
- `main-206-*`: local `main` (includes #206) before this PR's remaining fixes
  (changelog / volunteers / mobile top bar / tab wrap).
- `after-*`: local branch after this PR. All measured routes report
  `scrollWidth === innerWidth` at 375×812 and 390×844.

Demo coop data only (Zonnecoöperatie Vlaanderen). The reporter's real iPhone
screenshot is kept out of git.
