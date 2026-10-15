# Verification and accessibility

## Browser matrix

CI builds the demo and test consumers from the actual npm archive installed in
independent directories. It runs the same interaction suite on Playwright's
Chromium, Firefox and WebKit builds. Each job installs the browser version
required by the repository's pinned Playwright release.

Each engine exercises a desktop viewport and a narrow viewport. Chromium and
WebKit additionally enable mobile/touch emulation for the narrow run. Firefox
uses a narrow desktop context because Playwright does not support its `isMobile`
option. These are not tests on physical phones or proof of identical behavior in
shipping Safari, Chrome or Firefox versions outside the pinned browser builds.

```sh
npm run build
npm run site:build:packed
npx playwright install chromium firefox webkit
BVM_BROWSER=chromium npm run test:browser
BVM_BROWSER=firefox npm run test:browser
BVM_BROWSER=webkit npm run test:browser
```

The shared development host uses its heavy-work gate; do not launch concurrent
browser/build jobs beside live services. GitHub-hosted jobs have isolated workspaces.
On Linux, browser system libraries can be installed with Playwright's
`install --with-deps` option, as the CI workflow does.

## Accessibility checks

The browser suite runs `@axe-core/playwright` scans tagged for WCAG 2 A/AA,
2.1 AA and 2.2 AA. It scans diagram, network, matrix and data-reader states,
then the complete demo with timeline and Gantt content. Detected violations fail
the job; the full reports retain both failures and checks needing human review.
No rule is globally disabled to make an engine pass. Decorative matrix grid
rules are excluded from the accessibility tree at the source; identified cells
and labels keep their descriptions. Demo text uses a higher-contrast muted
palette rather than suppressing contrast findings.

Keyboard checks exercise native buttons, model-data filtering/selection and Gantt
progress edits. The data reader supplies a semantic table as an alternative to
spatial diagrams; it does not claim to make every third-party graphical gesture
usable by every assistive technology. Focus-visible styles and reduced-motion
CSS apply to the package's own controls.

Automated scans and scripted keyboard checks do **not** certify WCAG conformance.
Manual screen-reader review, high zoom, operating-system contrast modes, real
mobile input and broader interaction coverage remain release-review tasks.

## Evidence and failure recovery

Browser reports and screenshots live under `.tmp/browser/<engine>/`. CI retains
one artifact per engine, including accessibility scan reports and the bundle
report. Core jobs cover Node 22 and 24, packed headless installation and model
round trips. A Node 24 job records the reproducible store benchmark without
turning wall-clock timing into a flaky performance gate.

The demo publishes only after all core and browser matrix jobs succeed. Package
releases and Spatial upgrades are separate, explicitly qualified operations.
Stored model version 2 and store snapshot version 1 are unchanged.

Regression coverage includes fixed-seed mixed edit/undo/replacement/restart
sequences, byte-exact capacity, preview/replay, subscriber timing, synchronous
and delayed write refusals, and the complete model envelope after generated
metadata is added. A write that cannot be read back is refused before commit.

References: [Playwright browsers](https://playwright.dev/docs/browsers),
[accessibility testing](https://playwright.dev/docs/accessibility-testing) and
[React external-store subscriptions](https://react.dev/reference/react/useSyncExternalStore).
