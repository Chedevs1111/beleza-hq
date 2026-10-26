// Beleza HQ, stage 1: the office with its 15 staff, playing a scripted demo day.
//
// Load order: scene + camera + ocean + Core + streak (the sky and sea draw at once) -> fonts -> textures -> shell, loft,
// steps, furniture -> HDRI (in the background) -> 15 people -> DemoPlayer -> Reactions -> ActionExecutor -> HUD.
// Each frame: demo clock -> events -> lighting (when the time moved a minute) -> camera, ocean, Core, streak, people -> render.
//
// Query: ?live=1 lights the office by the real Johannesburg time, ?h=<0..24> freezes the time of day, ?fps=1 shows a
// frame-rate meter, ?lite=1 / ?lite=0 force the light / full profile, ?debug=1 exposes window.__hq.
import type { Texture } from 'three';
import './ui/hud.css';
import './dash/theme.css';
import './dash/shell.css';
import './dash/island.css';
import './dash/pills.css';
import './dash/palette.css';
import './dash/pages.css';
import './dash/pages/pages2.css';
import './dash/onboarding.css';
import './dash/phone.css';
import { createScene } from './office/scene';
import type { SceneParts } from './office/scene';
import { loadHdri, loadManifest, loadTextureSet } from './office/assets';
import type { Manifest, TextureKey, TextureSet } from './office/assets';
import { createMaterials } from './office/materials';
import { buildShell } from './office/shell';
import { buildLoft, buildSteps } from './office/loft';
import { buildFurniture } from './office/furniture';
import { buildCore } from './office/core';
import { buildOcean } from './office/ocean';
import type { Ocean } from './office/ocean';
import { buildStreak } from './office/streak';
import { johannesburgHour, lightingAt } from './office/timeofday';
import type { Lighting } from './office/timeofday';
import { COURIER_WINDOW, IDLE_SPOTS, SEATS, SENTINEL_DESK } from './office/layout';
import { createCamera, createPicker, personView } from './office/camera';
import type { CameraRig } from './office/camera';
import { ROSTER } from './roster';
import { Person } from './staff/person';
import { isSeated } from './staff/states';
import { DemoPlayer } from './demo/player';
import { DashStore } from './dash/store';
import { Layers, escapeDecision } from './dash/layers';
import { createDemoActions, isPlanDraft } from './dash/actions';
import { createDashboard } from './dash/shell';
import { createIsland, setPendingEdit } from './dash/island';
import { createTeam } from './dash/team';
import { createPalette } from './dash/palette';
import { renderApprovals } from './dash/pages/approvals';
import { renderContent } from './dash/pages/content';
import { renderInbox } from './dash/pages/inbox';
import { renderLeads } from './dash/pages/leads';
import { renderActivity } from './dash/pages/activity';
import { renderInsights } from './dash/pages/insights';
import { renderSpend } from './dash/pages/spend';
import { recordIfApproval } from './dash/insights';
import { renderSettings } from './dash/pages/settings';
import { renderOnboarding } from './dash/pages/onboarding';
import { isStepId } from './dash/onboarding';
import { SCHEDULES, reasonText, whyNotRunnable } from './dash/settings-data';
import type { Palette, Run } from './dash/palette';
import { holdScriptedDecisions } from './dash/editing';
import { dictationOn, liteOn, setDictation, setLite, setOnboarded } from './dash/prefs';
import { Sounds } from './dash/sounds';
import type { DemoActions } from './dash/actions';
import type { AgentEvent } from './events';
import { Reactions } from './reactions';
import { ActionExecutor, idleSpotFor } from './executor';
import type { ExecutorHost } from './executor';
import { FpsGovernor, QualityLadder, chooseQuality, pixelRatioFor } from './quality';
import { hideAgentCard, onAgentCardClose, setAgentCardDock, showAgentCard } from './ui/card';
import { createClockChip, createFpsMeter, hideNoGl, showNoGl } from './ui/hud';
import type { AgentId } from './types';

const params = new URLSearchParams(location.search);
const live = params.get('live') === '1';
const fixedHour = params.get('h') !== null && Number.isFinite(Number(params.get('h'))) ? Number(params.get('h')) : null;
const debug = params.get('debug') === '1' || import.meta.env.DEV;

/** `navigator.deviceMemory` is Chrome-only and not in the DOM typings. */
type NavigatorExtras = Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };

/** A phone or tablet by its browser, or any window narrow enough to get the phone layout (under 720 px). */
function isMobile(): boolean {
  const nav = navigator as NavigatorExtras;
  const ua = nav.userAgent;
  return nav.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1) || innerWidth < 720;
}

// A ?lite= parameter wins; otherwise the choice remembered from Settings; otherwise the device decides.
const remembered = liteOn();
const quality =
  params.get('lite') === '1' ? 'lite'
  : params.get('lite') === '0' ? 'full'
  : remembered !== undefined ? (remembered ? 'lite' : 'full')
  : chooseQuality({
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      mobile: isMobile(),
      deviceMemoryGb: (navigator as NavigatorExtras).deviceMemory,
    });
const lite = quality === 'lite';
document.documentElement.dataset.quality = quality;

const canvas = document.getElementById('world') as HTMLCanvasElement;
// The shell owns the layout; the canvas lives in its world host (the whole window on Home, the live column elsewhere).
const shellRoot = document.createElement('div');
document.body.prepend(shellRoot);
// Everything Esc can close sits in one stack: the More sheet (phones) is its first layer here; the agent card, palette,
// editor and island follow once they open. The global Esc handler is installed in start().
const layers = new Layers();
// The More sheet's Commands row opens the ⌘K bar, which is built later (once the office has loaded).
let palette: Palette | undefined;
const dash = createDashboard(shellRoot, { layers, onCommands: () => palette?.open() });
dash.worldHost.append(canvas);
dash.setLite(lite);
const boot = document.getElementById('boot');

function endBoot(): void {
  if (!boot) return;
  boot.classList.add('hq-boot-done');
  setTimeout(() => boot.remove(), 800);
}

/** No WebGL (or it died for good): a plain message instead of the picture. */
function fail(error?: unknown): void {
  if (error) console.error('[hq] WebGL unavailable', error);
  endBoot();
  showNoGl();
}

const KEYS: TextureKey[] = ['concrete', 'oak', 'terrazzo', 'stone', 'floor'];

function start(): void {
  let parts: SceneParts;
  let ocean: Ocean;
  try {
    parts = createScene(canvas, { lite });
    ocean = buildOcean(parts.scene, parts.renderer, lite);
  } catch (e) {
    fail(e);
    return;
  }
  const { renderer, scene, camera } = parts;
  const rig: CameraRig = createCamera(camera, canvas);
  const core = buildCore();
  const streak = buildStreak();
  scene.add(core.group, streak.group);

  // ---------------------------------------------------------------- time of day
  const chip = createClockChip(fixedHour !== null ? 'Fixed' : live ? 'Live' : 'Demo', dash.clockHost);
  let player: DemoPlayer | null = null;
  let appliedHour = Number.NaN;
  let lastClockMs = -1e9;
  let lighting: Lighting = lightingAt(fixedHour ?? 6);

  const hourNow = (): number =>
    fixedHour ?? (live ? johannesburgHour(new Date()) : player ? player.hour() : 6);

  /** Re-lights the office when the time has moved a minute (or on `force`). Cheap to call every frame. */
  function updateTime(ms: number, force = false): void {
    if (!force && ms - lastClockMs < 200) return;
    lastClockMs = ms;
    const h = hourNow();
    let d = Math.abs(h - appliedHour);
    d = Math.min(d, 24 - d);
    if (force || !(d < 1 / 60)) {
      lighting = lightingAt(h);
      parts.applyLighting(lighting);
      ocean.applyLighting(lighting);
      appliedHour = h;
    }
    chip.set(h, lighting.phase);
  }
  updateTime(0, true);

  // ---------------------------------------------------------------- quality
  const governor = new FpsGovernor();
  const ladder = new QualityLadder();
  const shadowSize = lite ? 1024 : 2048;
  /** The light profile as it stands now: starts as chosen at boot, flipped by the ⌘K bar. */
  let liteNow = lite;
  let level = 0;
  let status = `${quality} · q0 · dpr ${renderer.getPixelRatio()}`;
  const fps = params.get('fps') === '1' ? createFpsMeter() : null;

  /** 0 full · 1 mirror every 4th frame · 2 pixel ratio 1.5 · 3 pixel ratio 1 and 1024 shadows · 4 no shadows. */
  function applyQuality(next: number): void {
    level = next;
    ocean.setReflectionEvery(level >= 1 ? 4 : 1);
    renderer.setPixelRatio(pixelRatioFor(level, devicePixelRatio, liteNow));
    parts.resize();
    const size = level >= 3 ? 1024 : shadowSize;
    if (parts.sun.shadow.mapSize.x !== size) {
      parts.sun.shadow.mapSize.set(size, size);
      parts.sun.shadow.map?.dispose();
      parts.sun.shadow.map = null;
    }
    parts.sun.castShadow = level < 4;
    status = `${quality} · q${level} · dpr ${renderer.getPixelRatio()}`;
  }

  // ---------------------------------------------------------------- people, executor, card
  const people: Partial<Record<AgentId, Person>> = {};
  const peopleList: Person[] = [];
  let reactions = new Reactions();
  let steps: ReturnType<typeof buildSteps> | null = null;
  let ready = false;
  let readyAt = 0;

  const host: ExecutorHost = {
    walk(agent, target) {
      const p = people[agent];
      if (!p) return Promise.resolve();
      switch (target) {
        case 'seat': return p.sitAt(SEATS[agent]);
        case 'sentinel': return p.walkTo(SENTINEL_DESK);
        case 'courier_window': return p.walkTo(COURIER_WINDOW);
        case 'idle': return p.walkTo(idleSpotFor(agent));
      }
    },
    setState: (agent, state) => people[agent]?.setState(state),
    stateOf: (agent) => people[agent]?.state,
    setLabel: (agent, text) => people[agent]?.setLabel(text || people[agent].agent.name),
    setMarker: (agent, on) => people[agent]?.setMarker(on),
    stepsPulse: () => steps?.pulse(),
    corePulse: () => core.pulse(),
    streak: () => streak.fire(),
    isWorking: (agent) => reactions.activeRun(agent) !== undefined,
  };
  const executor = new ActionExecutor(host);
  const store = new DashStore();
  let actions: DemoActions | null = null;
  /** Agents whose timetable Settings has paused. In memory only; the actions read it on every "Run now". */
  const pausedAgents = new Set<AgentId>();

  /** Why "Run now" did nothing for this agent, in the words Settings and the agent card share. */
  function runRefusal(id: AgentId): string {
    const a = ROSTER.find((r) => r.id === id);
    const why = whyNotRunnable(id, { store, roster: ROSTER, paused: pausedAgents }) ?? 'Already working';
    return reasonText(a?.name ?? id, why, a?.parkedReason);
  }

  /** Switches the light profile now (data-quality, blur, pixel ratio) and remembers the choice for the next visit. */
  function applyLite(on: boolean): void {
    liteNow = on;
    setLite(on);
    document.documentElement.dataset.quality = liteNow ? 'lite' : 'full';
    dash.setLite(liteNow);
    applyQuality(level);
  }

  /** Everyone at their seat typing, the parked pair standing at the glazing: the start of every demo day. */
  function resetPeople(): void {
    let spot = 0;
    for (const p of peopleList) {
      p.setMarker(false);
      p.setLabel(p.agent.name);
      if (p.agent.parked) {
        p.placeAt(IDLE_SPOTS[spot++], Math.PI / 2); // facing the ocean
        p.setState('idle');
      } else {
        const seat = SEATS[p.agent.id];
        p.placeAt(seat.position, seat.facing);
        p.setState('typing');
      }
      p.snap();
    }
  }

  // Where the picture sits: dash.frame() slides it into the clear middle between the glass panels (the agent card
  // reports its width through dash.setInset). dx and dy ease toward the target; a new page or a resized view snaps.
  let cur = dash.frame();
  let target = cur;
  let shownPage = dash.page();
  let shownSize = '';
  const worldSize = () => `${canvas.clientWidth}x${canvas.clientHeight}`;
  const applyFrame = () => {
    parts.setFrame(cur);
    shownSize = worldSize();
  };
  dash.onLayout(() => {
    target = dash.frame();
    if (dash.page() !== shownPage || worldSize() !== shownSize) {
      shownPage = dash.page();
      cur = target;
      applyFrame();
    } else if (target.zoom !== cur.zoom) {
      cur = { ...cur, zoom: target.zoom };
      applyFrame();
    }
  });
  applyFrame();

  let dropCardLayer: (() => void) | null = null;

  /** The width the open agent card covers on Home (it sits at the right edge; below 720 px it is a bottom sheet). */
  function cardInset(): number {
    const card = document.querySelector<HTMLElement>('.hq-card');
    if (!card || card.hidden || innerWidth < 720 || dash.page() !== 'home') return 0;
    return card.offsetWidth + (parseFloat(getComputedStyle(card).right) || 0);
  }

  /**
   * On every page but Home the office lives in the live column at the right. Park the card just left of it
   * (the column's width + 24 px) so the animated office stays in view; on Home it keeps its own spot at the edge.
   */
  function dockCard(): void {
    const live = dash.page() !== 'home' && dash.worldVisible() ? dash.worldHost.getBoundingClientRect().width : 0;
    setAgentCardDock(live > 0 ? live + 24 : null);
  }

  function openPerson(p: Person): void {
    const g = p.group.position;
    const here: [number, number, number] = [g.x, g.y, g.z];
    rig.flyTo(isSeated(p.state) ? personView(here, SEATS[p.agent.id].facing) : personView(here));
    const doing = p.label !== p.agent.name ? p.label : p.state;
    showAgentCard(p.agent, {
      task: doing.charAt(0).toUpperCase() + doing.slice(1),
      nextRun: SCHEDULES[p.agent.id],
      costToday: store.spendToday().get(p.agent.id) ?? 0,
      onRun: () => actions?.runNow(p.agent.id) !== undefined,
      refusal: () => runRefusal(p.agent.id),
    });
    dropCardLayer ??= layers.push('card', () => {
      hideAgentCard();
      closeCard();
    });
    dockCard();
    dash.setInset('right', cardInset());
  }
  const closeCard = () => {
    dropCardLayer?.();
    dropCardLayer = null;
    rig.home();
    dash.setInset('right', 0);
  };
  onAgentCardClose(closeCard);
  // A new page or a resized view moves the live column, and with it where the card docks and what it covers.
  dash.onLayout(() => {
    dockCard();
    if (dropCardLayer) dash.setInset('right', cardInset());
  });
  addEventListener('resize', () => {
    if (dropCardLayer) dash.setInset('right', cardInset());
  });
  createPicker(camera, canvas, () => peopleList, openPerson);

  // One global Esc handler, in the capture phase so it runs before the agent card's own Esc listener. A layer closes
  // (the card also sends the camera home), or the camera goes home. Typing in a field is left alone unless the palette
  // is on top. With a layer open the event is stopped, so the card's listener never closes a second thing.
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const top = layers.top();
    const { stop, prevent } = escapeDecision(top, layers.handleEscape(e.target, () => rig.home()));
    if (prevent) e.preventDefault();
    if (stop) e.stopImmediatePropagation();
  }, true);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) player?.pause();
    else player?.resume();
  });

  // ---------------------------------------------------------------- the frame loop
  let last = -1;
  let hdri: Texture | null = null;
  const frame = (ms: number): void => {
    const t = ms / 1000;
    const raw = last < 0 ? 1 / 60 : t - last;
    last = t;
    const dt = raw > 0.1 ? 0.1 : raw < 0 ? 0 : raw;

    player?.update(dt);
    updateTime(ms);
    rig.update(t);
    ocean.update(t);
    core.update(t);
    streak.update(t);
    for (let i = 0; i < peopleList.length; i++) peopleList[i].update(dt);

    if (cur.dx !== target.dx || cur.dy !== target.dy) {
      const k = Math.min(1, dt * 9);
      let dx = cur.dx + (target.dx - cur.dx) * k;
      let dy = cur.dy + (target.dy - cur.dy) * k;
      if (Math.abs(target.dx - dx) < 0.5) dx = target.dx;
      if (Math.abs(target.dy - dy) < 0.5) dy = target.dy;
      cur = { dx, dy, zoom: cur.zoom };
      applyFrame();
    }

    // A page under 720 px has no live column and nothing is drawn: those frames say nothing about the GPU.
    if (ready && ms >= readyAt && dash.worldVisible()) {
      const next = ladder.step(governor.sample(raw));
      if (next !== null) applyQuality(next);
    }
    fps?.frame(raw, status);

    try {
      if (dash.worldVisible()) renderer.render(scene, camera); // a page under 720 px has no live column
    } catch (e) {
      renderer.setAnimationLoop(null);
      fail(e);
    }
  };

  // Context loss: stop drawing and say so; if the browser gives the context back, rebuild what the GPU lost.
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); // lets the browser restore it
    renderer.setAnimationLoop(null);
    showNoGl();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    try {
      hideNoGl();
      if (hdri) parts.setEnvironment(hdri); // the environment map lived on the GPU
      updateTime(performance.now(), true);
      applyQuality(level);
      last = -1;
      renderer.setAnimationLoop(frame);
    } catch (err) {
      fail(err);
    }
  });

  renderer.setAnimationLoop(frame);

  // ---------------------------------------------------------------- loading
  async function load(): Promise<void> {
    // Space Grotesk draws the name tags; wait for it (briefly) so they don't come out in the system face.
    await Promise.race([
      document.fonts?.load('600 16px "Space Grotesk"').catch(() => undefined),
      new Promise((r) => setTimeout(r, 1500)),
    ]);

    const loaded = await Promise.allSettled(KEYS.map((k) => loadTextureSet(k)));
    const sets: Partial<Record<TextureKey, TextureSet>> = {};
    loaded.forEach((r, i) => {
      if (r.status === 'fulfilled') sets[KEYS[i]] = r.value;
      else console.warn(`Texture set "${KEYS[i]}" failed; using a flat colour`, r.reason);
    });
    const mats = createMaterials(sets, { lite });
    buildShell(scene, mats);
    scene.add(buildLoft(mats, scene));
    steps = buildSteps(mats, scene);
    scene.add(steps.group, buildFurniture(mats));

    loadHdri()
      .then((h) => {
        hdri = h;
        parts.setEnvironment(h);
      })
      .catch((e) => console.warn('HDRI failed to load', e));

    const manifest = await loadManifest().catch((e): Manifest => {
      console.warn('Asset manifest failed to load; the staff will be stand-ins', e);
      return { people: {}, textures: {}, hdri: '', sources: [] } as unknown as Manifest;
    });
    const t0 = performance.now();
    const made = await Promise.allSettled(ROSTER.map((a) => Person.create(a, manifest)));
    for (const r of made) {
      if (r.status === 'rejected') {
        console.warn('[staff] a person could not be created', r.reason);
        continue;
      }
      const p = r.value;
      people[p.agent.id] = p;
      peopleList.push(p);
      scene.add(p.group);
      if (p.card) scene.add(p.card);
    }
    console.info(`[staff] ${peopleList.length} people loaded in ${Math.round(performance.now() - t0)} ms`);
    resetPeople();

    // The demo day: events -> store (the gate) -> Reactions -> actions -> the per-agent queues. Handlers never throw.
    // `emit` is the single entry: the demo player and the dashboard's actions both go through it.
    const demo = new DemoPlayer();
    const emit = (e: AgentEvent): void => {
      try {
        if (store.accept(e, demo.hour())) {
          recordIfApproval(e); // an accepted approval counts toward the streak (this browser only)
          executor.run(reactions.handle(e));
        }
      } catch (err) {
        console.warn('[hq] could not react to', e, err);
      }
    };
    actions = createDemoActions({ store, emit, later: (ms, fn) => void setTimeout(fn, ms), paused: (a) => pausedAgents.has(a) });
    // While the Approvals editor is open for a draft, the script's own approved / rejected / sent for it wait (the
    // visitor's typing would be thrown away otherwise) and go through `emit` when the editor closes or moves to another draft; a restart drops them.
    const hold = holdScriptedDecisions(emit);
    demo.on(hold.handle);
    demo.onLoop(() => {
      try {
        hold.discard();
        actions?.cancelPending();
        store.reset();
        reactions = new Reactions();
        executor.reset();
        resetPeople();
      } catch (err) {
        console.warn('[hq] could not restart the day', err);
      }
    });
    if (document.hidden) demo.pause();
    player = demo;

    // Dashboard chrome around the office: the island (top) and the team bar (bottom). Both read the same store as the
    // pages and act only through `actions`, so they stay in step with the 3D office.
    let storage: Storage | undefined;
    try {
      storage = localStorage;
    } catch {
      // blocked storage: the mute choice is just not remembered
    }
    const sounds = new Sounds(storage);
    createIsland(dash.islandHost, {
      store,
      actions,
      hour: () => demo.hour(),
      onEdit: (id) => {
        setPendingEdit(id); // the Approvals editor opens it
        dash.go('approvals');
      },
      sounds,
      layers,
    });
    // The four working pages replace their placeholders; they read the same store and act only through `actions`.
    const pageActions = actions;
    const pageDeps = (filter?: string) => ({ store, actions: pageActions, layers, filter });
    dash.setPage('approvals', (host, f) => renderApprovals(host, pageDeps(f)));
    dash.setPage('leads', (host, f) => renderLeads(host, pageDeps(f)));
    dash.setPage('content', (host, f) => renderContent(host, pageDeps(f)));
    dash.setPage('inbox', (host, f) => renderInbox(host, pageDeps(f)));
    dash.setPage('activity', (host, f) => renderActivity(host, pageDeps(f)));
    dash.setPage('insights', (host, f) => renderInsights(host, pageDeps(f)));
    dash.setPage('spend', (host, f) => renderSpend(host, pageDeps(f)));
    // Settings' switches go through the same preferences as the ⌘K bar; the dictation one needs nothing more here,
    // because the bar re-reads the preference (and stops any live recognition) whenever it opens.
    dash.setPage('settings', (host, f) => renderSettings(host, {
      ...pageDeps(f),
      roster: ROSTER,
      paused: pausedAgents,
      sound: { get: () => !sounds.muted, set: (on) => sounds.setMuted(!on) },
      dictation: { get: dictationOn, set: setDictation },
      lite: { get: () => liteNow, set: applyLite },
    }));
    // The welcome wizard (#/welcome): screens only. Nothing is live on the public demo, so every connect step needs the
    // private server; stage 3 passes the real state here.
    dash.setPage('welcome', (host, f) => renderOnboarding(host, {
      step: isStepId(f) ? f : undefined,
      env: { live: false, connections: {} },
      goStep: (id) => dash.go('welcome', id === 'welcome' ? undefined : id),
      done: () => {
        setOnboarded();
        dash.go('home');
      },
    }));
    createTeam(dash.teamHost, {
      store,
      onPick: (id) => {
        const p = people[id];
        if (p) openPerson(p);
      },
    });

    // The ⌘K / Ctrl K command bar. A string back from `run` is shown in the bar (which stays open); undefined closes it.
    palette = createPalette(shellRoot, {
      layers,
      dictation: dictationOn,
      run(r: Run): string | undefined {
        switch (r.kind) {
          case 'page':
            dash.go(r.page, r.filter);
            return undefined;
          case 'run': {
            if (actions?.runNow(r.agent) !== undefined) return undefined;
            return runRefusal(r.agent);
          }
          case 'approve-plan':
            return actions?.approveAll(isPlanDraft, 'plan') ? undefined : 'No plan is waiting for approval.';
          case 'toggle':
            switch (r.what) {
              case 'sound':
                sounds.setMuted(!sounds.muted);
                return sounds.muted ? 'Sound is off.' : 'Sound is on.';
              case 'lite':
                applyLite(!liteNow);
                return liteNow ? 'Lighter graphics are on.' : 'Lighter graphics are off.';
              case 'dictation':
                setDictation(!dictationOn());
                return dictationOn() ? 'Dictation is on.' : 'Dictation is off.';
            }
        }
      },
    });
    ready = true;
    readyAt = performance.now() + 4000; // shader compiles and texture uploads make the first seconds slow; don't judge them
    endBoot();
  }

  load().catch((e) => {
    console.error(e);
    endBoot();
  });

  if (debug) {
    Object.assign(window, {
      __hq: { parts, ocean, core, streak, rig, people, executor, store, applyQuality, get actions() { return actions; }, get player() { return player; }, get steps() { return steps; } },
    });
  }
}

start();
