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
- answer `sw.js` with status 200 and a JavaScript MIME type: a browser neither registers nor
  updates a worker from a redirect or a file of another type. The scripts in `assets/` need a
  JavaScript MIME type too: a browser refuses a module script of another type. The stylesheets
  in `assets/` need `text/css`: the page is in standards mode, where a browser ignores a
  stylesheet of another type, and the game runs without its styles and fonts;
- serve every file the install downloads: the page (`index.html`), `assets/` and the public
  files (manifests, icons). One failed download fails the install;
- answer a file that is not there with 404, not with the page. The install would store the page
  under that file's name, and the worker would answer with it in place of the file. A file in
  `assets/` stays replaced through later deploys while its name stays the same;
- keep no old copy of the page, `sw.js` or the public files in a cache in front of it (CDN,
  proxy): send them with `Cache-Control: no-cache`, or purge them on every deploy once `sw.js` is
  in place, as a launch before that puts the old copy back. A cache keeps the page under
  `/flip-a-coin/`, the URL players and the install request, so a purge of `index.html` alone
  leaves it: purge `/flip-a-coin/` itself with its query strings (`?perf`), or the whole path.
  Unless a file has `no-cache`, `no-store` or `private`, such a cache answers without asking the
  server while the file is fresh to it: for its `s-maxage`, which the cache takes before
  `max-age`, else for its `max-age`, else until its `Expires` date, else for the cache's own
  default lifetime. Where the cache reads a field meant for it alone, such as `CDN-Cache-Control`
  or `Surrogate-Control`, that field takes the place of `Cache-Control` and `Expires`. A setting
  of the cache itself can override them all: a CloudFront minimum TTL above zero, or a Cloudflare
  edge TTL that ignores `Cache-Control`, keeps the file despite `no-cache`, `no-store` or
  `private`. Turn such a setting off for these files, or purge them. The
  worker's install bypasses only the browser's own cache. The install checks that the page
  loads its own build's entry script, so a stale `sw.js` with a fresh page, or a stale page with
  a fresh `sw.js`, fails it: a new player gets no offline play. A returning player's browser sees
  no new worker under a stale `sw.js` and fails to install it under a stale page, so their
  offline launches stay on the previous build; a stale page keeps online launches on it too. A
  stale manifest or icon stays in the worker's cache until a later install downloads a fresh
  copy;
- give the page, `sw.js` and each public file a new `Last-Modified` or `ETag` whenever a deploy
  changes that file. A fresh build does this whether it is copied with its own modification
  times (`rsync -a`, `cp -p`) or with new ones. The browser's check for a new worker, the
  worker's page request on a launch and a CDN's check under `no-cache` are conditional; the
  install's requests for the page and the public files are not. nginx builds
  `Last-Modified` from the modification time and `ETag` from it and the size, and these files
  often keep their size from build to build: a deploy that gives every build the same
  modification times (an archive or an image with fixed timestamps) keeps both validators. The
  requests then get 304: players stay on the previous build, a CDN gives its page to new players
  too and an old manifest or icon to the install. `rsync -a` from such a build skips a file of
  the same size, so the server itself keeps the previous page, `sw.js` or public file. Once the
  server drops the previous build's `assets/`, a player who does not have them in the worker's
  cache gets an empty page;
- put a new build in place in this order: `assets/` and the public files, then the page, then
  `sw.js`. With the page first, a launch in between gets an empty page. Keep serving the
  previous build's `assets/` after the switch, for example until the next deploy: a launch that
  got the previous page just before the switch still loads them;
- send no `Content-Security-Policy` with the game, or one that allows at least
  `script-src 'self' 'wasm-unsafe-eval'`, `connect-src 'self'`, `style-src 'self'`,
  `font-src 'self'`, `img-src 'self'`, `manifest-src 'self'` and `worker-src 'self'`. The
  physics engine compiles WebAssembly and fetches its `.wasm`: without `'wasm-unsafe-eval'` or
  `connect-src 'self'` the game shows the engine error. The worker's install fetches every file
  under the policy sent with `sw.js`: with a policy there that does not allow `connect-src 'self'`
  no worker installs or updates, a new player gets no offline play, and a returning player's
  offline launches stay on the previous build. A page's policy without `worker-src` takes the
  worker's rule from `child-src`, then `script-src`: with a `child-src` that leaves out `'self'`
  and no `worker-src 'self'`, the page cannot register the worker, and a new player gets no
  offline play, while an installed worker still updates. Where the policy does not allow `'self'`
  in `style-src`, `font-src`, `img-src` or `manifest-src`, the game runs without its styles,
  fonts, icons or manifest respectively. A policy with `'strict-dynamic'` and a nonce
  blocks the game: its entry script carries no nonce.

Desirable:

- `Cache-Control: no-cache` on the page also with nothing in front of the server. Under the
  worker the browser revalidates the page anyway. Without a worker, on plain HTTP, after a failed
  install or in a browser that runs none, a page sent with `Last-Modified` can stay fresh by
  heuristic, and a deploy shows later. `docs/decisions.md` lists the headers that rule that out
  in Chromium and in Firefox: `must-revalidate` does only in Chromium, an `ETag` or
  `Cache-Control: public` in neither;
- `application/wasm` for `.wasm`: with another type the physics engine loads by a slower path and
  logs a warning;
- a long `max-age` for `assets/`: their names change with their content.

## Models

The game does not load models yet; `src/models/` reads and checks them. A model is one `.glb` per
item, Y up, origin at the center of mass, in any size: the game scales it to the procedural item
(`docs/decisions.md`, "A model takes its size and launch from the procedural item"). It has:

- a node named `visual`: the mesh to draw;
- optionally a node named `collider`: a simplified convex mesh for physics, not drawn. Without it
  the convex hull of `visual` is used, so relief that sticks out of the body needs a collider;
- a custom property `faces` on the scene, on `collider` or on `visual`, read in that order: an
  array, or a JSON string of one, with an entry `{ "value": ..., "normal": [x, y, z] }` per
  outcome. Values are `heads` and `tails` for the coin and `1` to `N` for a die, as numbers or
  strings. A normal is the unit direction that points up when that value shows: the outward face
  normal, for a d4 the direction of the vertex. It is in the frame of the glTF scene, Y up.
  Blender's exporter with +Y Up, its default, turns the meshes but copies custom properties as
  they are, so a script that reads a normal `(x, y, z)` in Blender, Z up, writes `(x, z, -y)`.
  The exporter writes custom properties only with Include > Custom Properties checked, which it
  is not by default.

The body is the convex hull of the collider; points closer together than 1e-5 of the size count as
one. Its corners are the points where three or more flat sides meet; points inside a side or on an
edge, such as the outline of an engraved number, are left out. There may be at most 256 corners, at
least 2e-3 of the size apart. The model's symmetries are the rotations that map the corners onto
each other to 1e-3 of the size; each must also map the normals onto each other to 1e-3, and together
they must carry any face onto any other. The game then moves the corners and the normals to exactly
symmetric places. Each rotation is found from two pairs of corners and carries their error, so
corners pass only up to about 2e-4 of the size off those places: at 1e-4 off every item passes, with
normals computed from such a mesh, and at 1e-3 every item fails. Blender's Ico Sphere, up to 1.4e-5
of the radius off, passes. Normals must be unit length to 1e-6. With any value up the model must
rest on a flat side, the hull points within 1e-3 of the size of the lowest one, with its center of
mass above it, and a tilt of less than 5° about an edge of that side must not tip it over. A model
that breaks these rules is rejected with a `RangeError` that names the fault; a file that does not
parse, with an `Error` whose `cause` is the loader's error.

Bevels on the collider shrink its flat sides, and the two fallback tosses the game records for each
item, with reduced motion and without, stop coming to rest on them. With the sides of a d6, d8, d12
or d20 cut to 80% of their width all record both, at 60% the d12 and d20 fail the one without
reduced motion, at 40% each fails one or both (`docs/decisions.md`, "A model takes its size and
launch from the procedural item"). A collider with the item's full flat sides tosses like the
procedural item; the bevels can stay on `visual`.

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
- `src/models/`: the `.glb` model loader (`loadModel.ts`) and the check of a model's body against
  the procedural item it replaces (`modelBody.ts`); not imported by the game yet.
- `src/physics/`: Rapier world for one toss (`simulate.ts`) and the recorded frame format
  (`frames.ts`).
- `src/toss/`: body definition and validation (`body.ts`), launch profiles, toss planning with rejection and fallback (`planToss.ts`), face
  remapping by shape symmetry (`faces.ts`), playback (`playback.ts`). `engine.ts` is the lazily
  loaded entry for the physics chunk.
- `docs/decisions.md`: design decisions and the alternatives they rule out.
- `e2e/`: Playwright tests on a mobile Chromium profile.
