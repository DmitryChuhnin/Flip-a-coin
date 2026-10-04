# Decisions

Choices with a non-obvious alternative. Each entry says what was chosen and why the alternative
does not work.

## Outcome comes from a crypto RNG, not from the physics

`planToss` picks the side with `randomInt` over `crypto.getRandomValues` (rejection sampling, no
modulo bias) before anything is simulated. Physics only draws the flight. Letting the simulated
landing decide would make the odds depend on the model: hull shape, mass distribution, solver
tolerances and launch ranges. Close to fair for a symmetric coin, measurably uneven for shapes such as imperfect dice.
`Math.random` is not used for outcomes.

## The drawn coin is turned by a symmetry of its shape

After the simulation, `remapRotation` picks a rotation R from the coin's symmetry group (rotations
that map the convex hull onto itself) that brings the chosen face to where the landed face is. The
coin is drawn at `body · R`, so the silhouette, the contact with the table and the shadow at rest
match the simulated body exactly.

R is eased in during the part of the flight where the coin center is higher than its own radius,
around the axis closest to the current spin. Applying R from the first frame would visibly flip the
resting coin before it leaves the table; easing it in while airborne reads as a slightly faster
spin and cannot intersect the table.

## Symmetry groups are derived from the vertices

`rotationGroup` (`src/math/symmetry.ts`) finds every rotation that maps a point set onto itself: a
rotation of a finite set is fixed by where two non-collinear points go, so it tries every image
pair with matching lengths and angle and keeps the rotations that permute the set. Hand-written
lists of 60 quaternions for the d12 and d20 cannot be reviewed by reading. `defineBody` still
checks every symmetry against the final hull and the face directions, and builds the remap table
(candidates for every landed and desired outcome) once per body instead of on every toss.

## A d4 outcome is the vertex that points up

A d4 rests on a face and is read at the top vertex, so its outcome directions (`faces[i].normal`)
are unit vertex directions: the negated normal of the face it rests on. `upFace` and the remap then
work unchanged, and a d4 lying flat has tilt 0. Using face normals would read the face on the table.
Each face prints the three values of its corners, each pointing at its own corner.

## The fallback is re-anchored by a symmetry and a yaw

`anchorTrajectory` relabels the recorded body frame by a symmetry S that takes the start's up
outcome to the recorded one, then turns the whole flight about the vertical so that its first frame
is the start pose. Turning the recorded flight by the full rotation from its first frame to the
start would tip a die whose start rests on another face, and it would land tilted. With S the rest
stays on a face of the hull.

The replay is not re-simulated, so two gaps are closed by hand between the first frame and the
first landing. The start's own tilt (a die leaning on a wall rests up to 10° off flat) is eased
out, so the body lands flat. The body drifts sideways just enough to keep its roll after landing
inside the walls: the recorded fallback rolls up to about 2 units after it lands, and turned toward
a nearby wall it would pass through it. While airborne a corner can still cross a wall by up to
about 0.2 units for a moment, as the spinning body grows wider than at rest.

## Dice launch lower and keep further from the side walls

Dice use one `tumble` profile: lift 7.5 to 8.5 instead of the coin's higher toss, and a spin about
a random axis. A d12 or d20 thrown from the back of the table at the coin's lift leaves the top of
a portrait frame. Dice also see the side walls 0.15 units closer (`wallInset`): a tall die leaning
on a wall near the camera crosses the frame edge otherwise. The in-frame test projects the hull at
every shown pose for each body.

## Die numbers are a canvas atlas on a mesh equal to the hull

The die mesh is built from the same chamfered hull that Rapier collides with, so the rest pose and
shadow match the simulation. Numbers are drawn into one canvas texture with a cell per face, sized
to keep about 220 texels per world unit, which stays sharp after the dolly on a phone. Glyph
geometry or per-face textures would add a font file or dozens of textures to the bundle.

Each label carries `maxWidth`, the widest text that stays on the cut face over the label's height
and underline. The canvas squeezes wider text to it, so a font with wider digits than expected
narrows the number instead of printing it onto the untextured bevel.

## The item is chosen by a temporary URL parameter

`?item=d4` to `?item=d20` selects a die; a missing or unknown value gives the coin. This is a stand-in
until the game has an in-game selector, and it reads only exact lower-case names so a typo cannot
pick an unexpected body.

## Prerecorded animations are not used

A fixed set of baked flights repeats visibly after a few tosses, and every flight would have to
start from one fixed rest pose. Each toss is simulated from where the coin lies.

## A coin resting on its edge is rejected and re-simulated

A coin has two outcomes, so a rest pose tilted more than 10° (leaning on its edge or against a
wall) is not a result. The same limit applies to a die on an edge or against a wall. `planToss`
rejects it, as well as a flight that has not settled after 6 s simulated, and simulates again with
a new launch. After three rejections it plays a fallback trajectory, moved to where the body lies
and remapped to the chosen outcome.

The fallback is recorded once per body on first use (`engine.ts`), right after the physics engine
loads for the body on screen. Recording all seven bodies up front would cost every page load for
bodies that are never tossed.

A flight is also rejected when the remap needs a turn but the coin spends less than 0.2 s above its
own radius: the turn would have no airborne stretch to hide in.

## Physics world scale

Gravity is 20 units/s² rather than 9.81 with the coin about 1.2 units across. At a realistic scale
a toss would leave the frame; the tuned value gives an apex of about 3 units and a flight of about
one second.

## Rapier wasm is a separate file in production

`@dimforge/rapier3d-compat` ships its wasm inlined as base64, which runs unchanged in Node for unit
tests but gzips poorly. A build-only plugin in `vite.config.ts` moves the blob into a `.wasm` asset
that the same `init()` fetches. The build fails if a Rapier update moves the entry file or changes the inlined call.
The physics chunk is loaded with a dynamic import, so the scene renders before it arrives.
