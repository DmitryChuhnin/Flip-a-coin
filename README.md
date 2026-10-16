# Flip a Coin

A casual mobile-first browser game: a 3D coin lies on a table, and a tap tosses it. Built with
three.js, TypeScript and Vite. The production build is served from `/flip-a-coin/`.

The tabs at the top switch between the coin and the dice; the tray picks d4 to d20. The choice
and the sound switch are kept in `localStorage`. The text is in Russian for browsers that prefer
Russian and in English otherwise. After the first visit the game works offline and can be added
to the home screen.

## Requirements

Node.js 24 (see `.nvmrc`).

## Commands

```sh
npm ci                          # install dependencies
npm run dev                     # dev server with hot reload
npx playwright install chromium # once, before the first `npm run check`
npm run check                   # typecheck, lint, format check, unit tests, build + e2e tests
```

Separate steps: `npm run typecheck`, `npm run lint`, `npm run format`, `npm test`,
`npm run build`, `npm run preview`, `npm run test:e2e` (builds, then runs Playwright against the
preview server).

## Deploy

`npm run build` writes the game to `dist/`, which the server serves at `/flip-a-coin/` (`base` in
`vite.config.ts`). The reasons are in `docs/decisions.md`, "The game works offline through its
own service worker".

The server must:

- serve the game over HTTPS: a browser runs a service worker only in a secure context, and on
  plain HTTP the game works online only;
- answer `/flip-a-coin/` with the page and status 200, not a redirect. A redirect fails the
  service worker's install: a new player gets no offline play, a returning player stays on the
  previous build;
- answer `sw.js` with status 200 and a JavaScript MIME type. A browser neither registers nor
  updates a worker from a redirect or a file of another type;
- serve every file the install downloads: the page (`index.html`), `assets/` and the public
  files (manifests, icons). One failed download fails the install;
- answer a file that is not there with 404, not with the page. The install would store the page
  under that file's name, and the worker would answer with it in place of the file. A file in
  `assets/` stays replaced through later deploys while its name stays the same;
- keep no old copy of the page or `sw.js` in a cache in front of it (CDN, proxy): send both with
  `Cache-Control: no-cache`, or purge both on every deploy. Such a cache keeps a file without
  that header for its own default lifetime. The worker checks that the page comes from its own
  build: with a stale page or a stale `sw.js` a new player gets no offline play, and a returning
  player stays on the previous build;
- put a new build in place in this order: `assets/` and the public files, then the page, then
  `sw.js`. With the page first, a launch in between gets an empty page. Keep serving the
  previous build's `assets/` after the switch, for example until the next deploy: a launch that
  got the previous page just before the switch still loads them;
- send no `Content-Security-Policy` with the game, or one that allows scripts and workers from
  `'self'` and `'wasm-unsafe-eval'` for the physics engine. A policy with `'strict-dynamic'` and a
  nonce blocks the game: its entry script carries no nonce.

Desirable:

- `Cache-Control: no-cache` on the page also with nothing in front of the server. Under the
  worker the browser revalidates the page anyway. Without the worker, on a first visit or on
  plain HTTP, a page with only `Last-Modified` stays fresh by heuristic, and a deploy shows later;
- `application/wasm` for `.wasm`: with another type the physics engine loads by a slower path and
  logs a warning;
- a long `max-age` for `assets/`: their names change with their content.

## Layout

- `src/main.ts`: entry point; WebGL2 check, render loop, pause while the tab is hidden.
- `src/game.ts`: toss states (`loading`, `idle`, `flying`, `result`, `error`), tap and Space/Enter
  input, result announcement and the rolled number caption, camera moves, the swap between
  items. Exposes `data-toss-state`, `data-toss-count` and `data-item` on `<body>`.
- `src/items.ts`: the tossable items (coin and dice) and their announcements.
- `src/settings.ts`: saved settings (item tab, die, sound, first toss done), read field by field.
- `src/ui/controls.ts`: item tabs, dice tray, sound button and the first-toss hint.
- `src/audio/sound.ts`: synthesized launch, hit and rest sounds, audio unlock, vibration. The
  audio state is `data-audio` on `<body>`. `src/audio/gestures.ts`: the events that unlock audio.
- `src/strings.ts`: interface text in English and Russian, and the language choice.
- `src/perf/`: the panel that `?perf` on the page URL adds, for checking a phone without DevTools:
  frame rate, the longest frame and the slow frames over a sliding window and over the last
  flight (`meter.ts`), the wait for the tap handler, how long the last toss plan took, and how long
  the engine took to record the fallbacks of the last item it had not seen.
- `src/pwa/serviceWorker.ts`: source of `sw.js`, which the build emits with the list of files to
  precache. `public/`: the web app manifests (English and Russian) and icons.
- `src/scene/createScene.ts`: renderer, camera, resize handling.
- `src/scene/studio.ts`: the lilac studio backdrop, lights and the environment map.
- `src/scene/contactShadow.ts`: the soft spot under the body that stands in for a shadow map.
- `src/scene/camera.ts`: camera views: the close-up on a resting body, a view that fits a set of
  points for any aspect ratio, and the wide view of the whole table;
  `src/scene/shots.ts` moves the camera between them on launch and landing.
- `src/coin/`: coin dimensions, convex hull, faces and symmetries (`coinSpec.ts`) and the
  procedural three.js mesh (`coinMesh.ts`).
- `src/dice/`: d4 to d20 shapes, numbering, faces and rest poses (`dieSpec.ts`) and the mesh with
  a number texture atlas (`dieMesh.ts`).
- `src/math/`: quaternions (`quat.ts`), convex faces and chamfering (`polyhedron.ts`), rotation
  groups of point sets (`symmetry.ts`).
- `src/random.ts`: uniform integers from `crypto.getRandomValues`.
- `src/physics/`: Rapier world for one toss (`simulate.ts`) and the recorded frame format
  (`frames.ts`).
- `src/toss/`: body definition and validation (`body.ts`), launch profiles, toss planning with rejection and fallback (`planToss.ts`), face
  remapping by shape symmetry (`faces.ts`), playback (`playback.ts`). `engine.ts` is the lazily
  loaded entry for the physics chunk.
- `docs/decisions.md`: design decisions and the alternatives they rule out.
- `e2e/`: Playwright tests on a mobile Chromium profile.
