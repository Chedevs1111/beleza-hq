# Beleza HQ

A live 3D office in the browser. Fifteen staff, one per agent, work through a scripted day in an open-plan, ocean-view
office: they walk to their desks, type, carry drafts to the checker, wait for approval, and send. The sun moves across
the sky, the LED steps pulse on approvals, and a light streak leaves over the sea when something is sent.

Stage 2 wraps the office in a liquid-glass dashboard: a sidebar of pages, a live island at the top, a team bar along
the bottom, and a command bar on ⌘K. It is all demo data. The site needs no accounts and no backend, and the public
version is demo-only: it never asks for, stores or sends a password, token or key.

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

## The dashboard

The office fills the window on **Home**, with glass only at the edges. Every other page is a glass column on the left
and the same office, still animating, in a live column at the right.

| Page | What it shows |
|---|---|
| Home | The office, the island (top), the team bar (bottom) and the clock |
| Approvals | Every draft waiting for a decision, with Approve, Edit (an inline editor) and Reject, and "Approve all plan" |
| Leads | New leads from Scout, filterable by grade, and where each one stands |
| Content | Posts and plans in progress, scheduled and published, plus Muse's week |
| Inbox | Replies and messages that need a person |
| Activity | Everything the team did, filterable by agent, with a CSV export |
| Insights | Time saved, your streak of days with an approval, and a weekly recap card you can download as a picture |
| Spend | What each agent has cost today in dollars and rand (a fixed demo rate, stated under the table) and a month estimate |
| Settings | Sounds, dictation and lite-graphics switches, timetables with Pause and Run now, Sentinel's rules, approval modes, connections |
| Welcome wizard (`#/welcome`) | A guided tour of setting up email, social networks, website and WhatsApp. Opens once on a first visit; also from Settings, More and the command bar |

Pages are hash routes (`#/approvals`, `#/content?agent=muse`, `#/welcome?step=email`), so links and Back work.

### The island and the team bar

The pill at the top centre says what the team is doing and how many drafts wait for you. Click it (or press Enter) for a
preview of the newest waiting draft with Approve, Edit and Reject. Under the line sit up to four **status pills**:
Waiting, Next (the next scheduled run), Spend and Leads. A brief alert replaces them for two seconds when a run finishes
or fails. The mascot, a small amethyst "b", changes **mood** with the team: bright, a gold envelope when something waits
for you, a cheer when mail goes out, a hello when the page opens, a thoughtful look when a run starts, proud after you
approve, annoyed when a run fails, and a yawn and then sleep after three and six quiet minutes. Its sounds and the
other soft cues (a pop for new work, a chime when you are needed, a tick, a whoosh) are synthesised in the browser with
Web Audio; there are no audio files, and Settings or the command bar mutes them.

The team bar holds all fifteen people as round buttons ringed by what each one is doing (working, waiting on you, idle,
parked, failed). Click one to fly the camera to them and open their card.

### Insights

Time saved is the approved and sent drafts times what each kind would take by hand. The streak counts days in a row with
at least one approval. The weekly recap card is drawn on a canvas in the Beleza palette and downloads as a 1080 x 1080
PNG; "Hide client names" removes every draft summary from it. All of it is counted in your browser and nothing is sent
anywhere.

### Command bar (⌘K, or Ctrl K)

Type to filter, arrows to move, Enter to run, Esc to close.

| Command | Does |
|---|---|
| What's waiting? | Opens Approvals |
| Approve all plan | Approves every waiting content plan at once |
| Home, Approvals, Leads, ... Settings | Opens that page |
| Set up connections | Opens the welcome wizard |
| Run Scout (and every other working agent) | Starts a short demo run for that agent |
| Show Muse's work (and the rest) | Opens Content (studio agents) or Activity (everyone else), filtered to them |
| Sound on or off | Mutes or unmutes the soft cues |
| Lighter graphics on or off | Switches the light profile now |
| Dictation on or off | Turns the mic button on or off |

**Dictation** is off by default. When it is on, the bar shows a mic button that uses the browser's own speech recognition
(South African English). Chrome sends the audio to Google to turn it into text, so the bar says so before anyone uses it
(POPIA). The words appear in the input, and a recognised phrase such as "run scout" or "approve all plan" runs only when
the speech ends.

### Demo actions

Approve, Reject, Approve all plan and Run now are real in the demo: each only emits the same events the scripted day
does, so the dashboard and the 3D office stay in step. Courier sends an approved draft about three
seconds later. Edit changes the draft text in memory; Save keeps it waiting. When the demo day restarts
(every ten minutes) the drafts reset. Nothing leaves the browser.

### On a phone

Under 720 px wide the sidebar becomes a bottom tab bar (Home, Approvals, Content, Activity and **More**, which opens a
sheet with Leads, Inbox, Insights, Spend, Settings and Set up connections). Home shows the office with the island at the
top and the team bar above the tabs; any other page takes the screen. The agent card, the island's draft preview and the
Approvals editor open as bottom sheets, controls are at least 44 px, only two status pills show, and the page picks the
light graphics profile automatically.

## Using it

- Drag to look around, scroll to zoom. Right-drag (or two fingers) pans.
- Click a person, or a name in the team bar along the bottom, to fly to them and open their card.
  Esc closes the card and returns to the overview.
- The clock in the sidebar shows the time of day and its phase: morning, day, golden hour, night.

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

The page picks the **lite** profile (still water, no clouds, smaller shadow map, pixel ratio 1) on phones and in windows
narrower than 720 px, with reduced motion switched on, or when the browser reports 2 GB of memory or less. A choice made
in Settings or the command bar is remembered and wins over that. Otherwise it runs **full**.

Either way a frame-rate governor watches the last two seconds and steps the picture down when the page drops under
45 fps, and back up when it holds over 58: the water reflection is redrawn less often first, then the pixel ratio
comes down, then the shadow map shrinks, then shadows go. If WebGL is missing or the graphics context is lost, the
page shows a short message instead of the picture; if the browser restores the context, the picture comes back.

## What comes next

Stage 3 adds a private server on a new Beleza Cloudflare account, behind Cloudflare Access, which brings the real
connections: the shared mailbox, Instagram, Facebook and LinkedIn (through Composio), the website's contact form, a
monthly site check and visit stats. The welcome wizard already shows every screen; its connect buttons stay locked
until then. This public site stays demo-only.

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
  dash/            the dashboard: shell and routes, pages, island, team bar, command bar, store, demo actions, insights
  ui/              agent card, clock chip, frame-rate meter
scripts/           asset pipeline
tests/             unit tests
```
