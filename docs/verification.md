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

## Beta.3 routed charts

The full catalog additionally builds independent routed-diagram and inline-chart
consumers from the archive. The routing fixture checks group coordinate systems,
parallel edges/self-loops, measured label boxes, full text access and invalidation
on obstacle moves, active drags and replacements. The chart fixture checks raw
row pagination, controlled updates, advice, errors with no source-data disclosure,
and expression interpretation under a script policy without unsafe-eval.
These fixtures run on the same Chromium/Firefox/WebKit matrix as the other views;
passing them is not a claim of arbitrary-graph optimality or a CPU sandbox.

## Local browser runtime prerequisites

The repository's pinned Playwright browsers also require OS shared libraries.
CI uses Playwright's documented `install --with-deps` command; missing libraries
are a test-environment failure, never evidence that the UI passed or failed.
A developer using an isolated runtime may set `BVM_BROWSER_EXECUTABLE` to a local
launcher for the same pinned browser binary. This changes only the launch path;
all assertions, resource policies and evidence remain enabled. Record the
browser version, launcher and library provenance with that local result.

A custom launcher is a local development convenience, not a substitute for the
hosted default-browser release gate. See [Playwright browser dependencies](https://playwright.dev/docs/browsers#install-system-dependencies).

## Controlled asynchronous renderer lifecycle

A separate packed consumer drives the real Vega hook through explicit promise
barriers rather than arbitrary delays. It checks withdrawn readiness, hidden and
unmounted in-flight updates, a hidden first frame, and a superseded failing
request. A timeline case also checks withdrawn readiness, hidden native redraws,
inactive navigation and a retained toolbar callback after disposal. Acquired
engines must be finalized and released once; hidden work may
settle internally but cannot call the inactive host's draw/error callbacks.
Activation observes retained current rows before acknowledging them.

The test fixture is not part of the public demo. It uses synthetic local rows and
the expression interpreter, and performs no data-resource requests. The same
scenarios run in the hosted Chromium, Firefox and WebKit release matrix.

References: [Vega asynchronous rendering and finalization](https://vega.github.io/vega/docs/api/view/)
and [React effect cleanup](https://react.dev/reference/react/useEffect).
