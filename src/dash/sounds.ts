// Soft cues, synthesised on the spot (no audio files): a pop for new work, a chime when you are needed,
// a tick when something is done and a whoosh when mail leaves the firm; plus the mascot's own voice: a hello, a thoughtful
// hum, a proud arpeggio, a grumble and a yawn. Every one is original Web Audio synthesis. Muting is remembered in this browser,
// and while muted no audio context is created at all.

export type Cue = 'pop' | 'attention' | 'done' | 'sent' | 'greet' | 'think' | 'proud' | 'annoyed' | 'yawn';

const KEY = 'beleza.hq.muted';

export class Sounds {
  private ctx?: AudioContext;
  private out?: GainNode;
  private off = false;
  private readonly last = new Map<Cue, number>();

  constructor(
    private readonly storage?: Pick<Storage, 'getItem' | 'setItem'>,
    private readonly audio: () => AudioContext = () => new AudioContext(),
  ) {
    try {
      this.off = storage?.getItem(KEY) === '1';
    } catch {
      // blocked storage: sounds start on
    }
    // Browsers only allow audio after the person has clicked or typed something.
    if (typeof addEventListener === 'function') {
      const unlock = () => {
        if (this.off) return; // muted: leave audio asleep, and keep listening for the first input after it is switched back on
        this.wake();
        removeEventListener('pointerdown', unlock, true);
        removeEventListener('keydown', unlock, true);
      };
      addEventListener('pointerdown', unlock, true);
      addEventListener('keydown', unlock, true);
    }
  }

  get muted(): boolean {
    return this.off;
  }

  setMuted(on: boolean): void {
    this.off = on;
    try {
      this.storage?.setItem(KEY, on ? '1' : '0');
    } catch {
      // not remembered, still muted for this visit
    }
  }

  play(cue: Cue): void {
    if (this.off) return;
    this.wake();
    const ctx = this.ctx;
    if (!ctx || !this.out || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now - (this.last.get(cue) ?? -1) < 0.12) return; // two of the same at once would only sound louder
    this.last.set(cue, now);
    switch (cue) {
      case 'pop': this.tone(520, 780, now, 0.05, 0.14, 'sine'); break;
      case 'done': this.tone(880, 880, now, 0.04, 0.16, 'sine'); this.tone(1320, 1320, now + 0.07, 0.035, 0.2, 'sine'); break;
      case 'attention': this.tone(659, 659, now, 0.06, 0.45, 'triangle'); this.tone(880, 880, now + 0.13, 0.06, 0.6, 'triangle'); break;
      case 'sent': this.whoosh(now); this.tone(1568, 1568, now + 0.32, 0.025, 0.3, 'sine'); break;
      // A rising "hel-lo": C5, E5, G5.
      case 'greet':
        this.tone(523, 523, now, 0.045, 0.2, 'sine');
        this.tone(659, 659, now + 0.09, 0.045, 0.2, 'sine');
        this.tone(784, 784, now + 0.18, 0.05, 0.4, 'sine');
        break;
      // A low, curious "hm-mm": two soft notes that lean up then settle.
      case 'think':
        this.tone(311, 392, now, 0.04, 0.26, 'sine', 0.18);
        this.tone(392, 349, now + 0.2, 0.035, 0.34, 'sine', 0.2);
        break;
      // A small triumphant arpeggio: E5, G#5, B5 and a bright E6 on top.
      case 'proud':
        this.tone(659, 659, now, 0.045, 0.22, 'triangle');
        this.tone(831, 831, now + 0.07, 0.045, 0.22, 'triangle');
        this.tone(988, 988, now + 0.14, 0.045, 0.24, 'triangle');
        this.tone(1319, 1319, now + 0.21, 0.04, 0.5, 'sine');
        break;
      // A grumbly "bwomp-bwomp": two falling, slightly rough notes.
      case 'annoyed':
        this.tone(262, 185, now, 0.03, 0.3, 'sawtooth', 0.22);
        this.tone(233, 156, now + 0.2, 0.03, 0.4, 'sawtooth', 0.28);
        break;
      // One long sigh sliding down, with a faint breath underneath.
      case 'yawn':
        this.tone(540, 240, now, 0.04, 0.9, 'sine', 0.8);
        this.tone(270, 120, now + 0.05, 0.02, 0.85, 'triangle', 0.8);
        break;
    }
  }

  private wake() {
    try {
      this.ctx ??= this.audio();
      if (!this.out) {
        this.out = this.ctx.createGain();
        this.out.gain.value = 0.9;
        this.out.connect(this.ctx.destination);
      }
      if (this.ctx.state !== 'running') void this.ctx.resume();
    } catch {
      // no Web Audio: the dashboard simply stays silent
    }
  }

  private tone(f0: number, f1: number, at: number, peak: number, decay: number, type: OscillatorType, glide = 0.06) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, at);
    osc.frequency.exponentialRampToValueAtTime(f1, at + glide);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(gain).connect(this.out!);
    osc.start(at);
    osc.stop(at + decay + 0.02);
  }

  private whoosh(at: number) {
    const ctx = this.ctx!;
    const length = Math.floor(ctx.sampleRate * 0.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.4;
    band.frequency.setValueAtTime(450, at);
    band.frequency.exponentialRampToValueAtTime(3200, at + 0.42);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.07, at + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.48);
    noise.connect(band).connect(gain).connect(this.out!);
    noise.start(at);
    noise.stop(at + 0.5);
  }
}
