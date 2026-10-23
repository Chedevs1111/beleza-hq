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
import { Reactions } from './reactions';
import { ActionExecutor, idleSpotFor } from './executor';
import type { ExecutorHost } from './executor';
import { FpsGovernor, QualityLadder, chooseQuality, pixelRatioFor } from './quality';
import { hideAgentCard, isAgentCardOpen, onAgentCardClose, showAgentCard } from './ui/card';
import { createClockChip, createFpsMeter, createTeamBar, hideNoGl, showNoGl } from './ui/hud';
import type { AgentId } from './types';

const params = new URLSearchParams(location.search);
const live = params.get('live') === '1';
const fixedHour = params.get('h') !== null && Number.isFinite(Number(params.get('h'))) ? Number(params.get('h')) : null;
const debug = params.get('debug') === '1' || import.meta.env.DEV;

/** `navigator.deviceMemory` is Chrome-only and not in the DOM typings. */
type NavigatorExtras = Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };

function isMobile(): boolean {
  const nav = navigator as NavigatorExtras;
  const ua = nav.userAgent;
  return nav.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1);
}

const quality =
  params.get('lite') === '1' ? 'lite'
  : params.get('lite') === '0' ? 'full'
  : chooseQuality({
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      mobile: isMobile(),
      deviceMemoryGb: (navigator as NavigatorExtras).deviceMemory,
    });
const lite = quality === 'lite';
document.documentElement.dataset.quality = quality;

const canvas = document.getElementById('world') as HTMLCanvasElement;
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
  const chip = createClockChip(fixedHour !== null ? 'Fixed' : live ? 'Live' : 'Demo');
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
  let level = 0;
  let status = `${quality} · q0 · dpr ${renderer.getPixelRatio()}`;
  const fps = params.get('fps') === '1' ? createFpsMeter() : null;

  /** 0 full · 1 mirror every 4th frame · 2 pixel ratio 1.5 · 3 pixel ratio 1 and 1024 shadows · 4 no shadows. */
  function applyQuality(next: number): void {
    level = next;
    ocean.setReflectionEvery(level >= 1 ? 4 : 1);
    renderer.setPixelRatio(pixelRatioFor(level, devicePixelRatio, lite));
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

  // The card covers the right of the window; the picture slides left by half of it so the person is not under it.
  let frameDx = 0;
  let targetDx = 0;
  const cardShift = () => (innerWidth >= 720 ? -Math.round((340 + 24) / 2) : 0);
  // The views are composed for a landscape window; in a tall one the picture is zoomed out so the room still fits across.
  let zoom = 1;
  const viewZoom = () => Math.min(1, Math.max(0.5, innerWidth / innerHeight / 1.3));
  const syncZoom = () => {
    const z = viewZoom();
    if (z === zoom) return;
    zoom = z;
    parts.setFrame({ dx: frameDx, dy: 0, zoom });
  };
  addEventListener('resize', syncZoom);
  syncZoom();

  function openPerson(p: Person): void {
    const g = p.group.position;
    const here: [number, number, number] = [g.x, g.y, g.z];
    rig.flyTo(isSeated(p.state) ? personView(here, SEATS[p.agent.id].facing) : personView(here));
    const doing = p.label !== p.agent.name ? p.label : p.state;
    showAgentCard(p.agent, { task: doing.charAt(0).toUpperCase() + doing.slice(1) });
    targetDx = cardShift();
  }
  const closeCard = () => {
    rig.home();
    targetDx = 0;
  };
  onAgentCardClose(closeCard);
  createPicker(camera, canvas, () => peopleList, openPerson);

  // One Esc handler: closes the card and goes home, or goes home. Typing in a field is left alone.
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (isAgentCardOpen()) hideAgentCard(); // removes the card's own Esc listener, so nothing runs twice
    closeCard();
  });

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

    if (frameDx !== targetDx) {
      frameDx += (targetDx - frameDx) * Math.min(1, dt * 9);
      if (Math.abs(targetDx - frameDx) < 0.5) frameDx = targetDx;
      parts.setFrame({ dx: frameDx, dy: 0, zoom });
    }

    if (ready && ms >= readyAt) {
      const next = ladder.step(governor.sample(raw));
      if (next !== null) applyQuality(next);
    }
    fps?.frame(raw, status);

    try {
      renderer.render(scene, camera);
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

    // The demo day: events -> Reactions -> actions -> the per-agent queues. Handlers never throw.
    const demo = new DemoPlayer();
    demo.on((e) => {
      try {
        executor.run(reactions.handle(e));
      } catch (err) {
        console.warn('[hq] could not react to', e, err);
      }
    });
    demo.onLoop(() => {
      try {
        reactions = new Reactions();
        executor.reset();
        resetPeople();
      } catch (err) {
        console.warn('[hq] could not restart the day', err);
      }
    });
    if (document.hidden) demo.pause();
    player = demo;

    createTeamBar(ROSTER, (agent) => {
      const p = people[agent.id];
      if (p) openPerson(p);
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
      __hq: { parts, ocean, core, streak, rig, people, executor, applyQuality, get player() { return player; }, get steps() { return steps; } },
    });
  }
}

start();
