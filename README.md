# Beleza HQ

A live 3D office in the browser. Fifteen staff, one per agent, work through a scripted day in an open-plan, ocean-view
office: they walk to their desks, type, carry drafts to the checker, wait for approval, and send. The sun moves across
the sky, the LED steps pulse on approvals, and a light streak leaves over the sea when something is sent.

Stage 1 is the office and the demo day only. It needs no accounts and no backend.

## Run it

Needs Node 22 or newer and `curl`.

```sh
npm install
npm run assets   # downloads and converts the avatars, textures and sky (about 28 MB, one-off)
npm run dev      # http://localhost:5174
```

Other scripts:

| Command | What it does |
|---|---|
| `npm run build` | Type-checks, then builds to `dist/` |
| `npm run preview` | Serves the build on port 5174 |
| `npm test` | Runs the unit tests |
| `npm run typecheck` | Type-checks only |

`npm run assets` is safe to run again: anything already downloaded and valid is skipped. The generated files in
`public/assets/` (`*.glb`, `*.webp`, `*.jpg`, `*.hdr`) are not committed; `manifest.json` and `LICENSES.md` are.

## Using it

- Drag to look around, scroll to zoom. Right-drag (or two fingers) pans.
- Click a person, or a name in the team bar along the bottom, to fly to them and open their card.
  Esc closes the card and returns to the overview.
- The chip at the top left shows the time of day and its phase: morning, day, golden hour, night.

## Demo mode

The page plays one scripted working day on a 10-minute clock (one demo hour is 25 seconds), then starts again.
Each scripted step is an `AgentEvent` (`src/events.ts`); the same events will later come from a live feed.
`src/reactions.ts` turns an event into office actions, and `src/executor.ts` carries them out in order for each person.

## URL options

| Option | Effect |
|---|---|
| `?live=1` | Light the office by the real Johannesburg time instead of the demo clock. The staff still play the demo day. |
| `?h=14.5` | Freeze the time of day at an hour (0 to 24). Handy for screenshots. |
| `?fps=1` | Show a frame-rate meter with the current quality level. |
| `?lite=1` / `?lite=0` | Force the light or the full profile. Without it the page chooses. |
| `?debug=1` | Expose `window.__hq` for the console (always on in `npm run dev`). |

## Quality

The page picks the **lite** profile (still water, no clouds, smaller shadow map, pixel ratio 1) on phones, with
reduced motion switched on, or when the browser reports 2 GB of memory or less. Otherwise it runs **full**.

Either way a frame-rate governor watches the last two seconds and steps the picture down when the page drops under
45 fps, and back up when it holds over 58: the water reflection is redrawn less often first, then the pixel ratio
comes down, then the shadow map shrinks, then shadows go. If WebGL is missing or the graphics context is lost, the
page shows a short message instead of the picture; if the browser restores the context, the picture comes back.

## Licences

Third-party assets are used under permissive licences, listed with their sources in
[`public/assets/LICENSES.md`](public/assets/LICENSES.md):

- Avatars and animation clips: Microsoft Rocketbox, MIT. Converted from FBX to GLB.
- Textures and sky: Poly Haven, CC0.
- Three.js is MIT. Space Grotesk and Fraunces (loaded from Google Fonts) are under the SIL Open Font Licence.

## Layout

```
src/
  main.ts          wiring: load order, frame loop, camera and card, quality
  executor.ts      per-agent action queues
  reactions.ts     event -> actions
  quality.ts       quality profile and the frame-rate governor
  demo/            the scripted day and its player
  office/          shell, loft, steps, furniture, Core, ocean, streak, lighting, camera, layout
  staff/           people: avatars, animation, walking, name tags
  ui/              agent card and the clock, team bar and meter
scripts/           asset pipeline
tests/             unit tests
```
