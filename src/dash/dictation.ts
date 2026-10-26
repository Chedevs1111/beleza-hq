// Dictation for the command bar, using the browser's own speech recognition (South African English).
// Chrome sends the audio to Google to recognise it; the palette says so (POPIA) before anyone uses it.
// The words land in the input for the person to see, and a recognised command runs only when the speech ends.

interface RecognitionResult {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}
export interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort?(): void;
  onresult: ((e: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
export type RecognitionCtor = new () => Recognition;

const speech = (): RecognitionCtor | undefined => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

const NS = 'http://www.w3.org/2000/svg';
const HINT = "Dictate a command: your browser's speech service turns it into text";
const BLOCKED = 'The microphone is blocked for this page: allow it in the browser to dictate';

export interface MicOptions {
  /** The words heard so far; `final` is true once the browser is sure (the speech has ended). */
  onText(text: string, final: boolean): void;
  /** Something the person should be told, such as a blocked microphone. */
  onError?(message: string): void;
}

export interface Listener {
  /** Starts listening, or stops if already listening. */
  toggle(): void;
  /** Ends any live recognition at once (audio stops streaming) and drops whatever it had not yet delivered. */
  stop(): void;
  listening(): boolean;
}

/** The recogniser session without any DOM, so it can be tested with a fake constructor. */
export function createListener(
  Ctor: RecognitionCtor,
  opts: MicOptions & { onState?(listening: boolean): void },
): Listener {
  let rec: Recognition | null = null;

  const stop = (): void => {
    const r = rec;
    if (!r) return;
    rec = null; // anything it still reports is ignored
    opts.onState?.(false);
    try {
      if (r.abort) r.abort();
      else r.stop();
    } catch {
      // already ended
    }
  };

  const start = (): void => {
    const r = new Ctor();
    r.lang = 'en-ZA';
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      if (rec !== r) return;
      try {
        let text = '';
        let final = e.results.length > 0;
        for (let i = 0; i < e.results.length; i++) {
          text += e.results[i][0].transcript;
          if (!e.results[i].isFinal) final = false;
        }
        opts.onText(text.trim(), final);
      } catch (err) {
        console.warn('[hq] dictation result failed', err);
      }
    };
    r.onerror = (e) => {
      if (rec !== r) return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') opts.onError?.(BLOCKED);
    };
    r.onend = () => {
      if (rec !== r) return;
      rec = null;
      opts.onState?.(false);
    };
    r.start();
    rec = r;
    opts.onState?.(true);
  };

  return {
    toggle() {
      try {
        // A second press asks the browser to finish: what was heard so far still arrives as the final text.
        if (rec) rec.stop();
        else start();
      } catch {
        // already listening in another tab, or blocked: leave things as they were
      }
    },
    stop,
    listening: () => rec !== null,
  };
}

export type MicButton = HTMLButtonElement & { stopListening(): void };

/** A mic button, or null where the browser has no speech recognition (Firefox, for one). */
export function createMic(opts: MicOptions): MicButton | null {
  const Ctor = speech();
  if (!Ctor) return null;
  const button = document.createElement('button') as MicButton;
  button.type = 'button';
  button.className = 'bz-mic';
  button.title = HINT;
  button.setAttribute('aria-label', 'Dictate a command');
  button.setAttribute('aria-pressed', 'false');

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of [
    ['rect', { x: '9', y: '3', width: '6', height: '11', rx: '3' }],
    ['path', { d: 'M5 11a7 7 0 0 0 14 0M12 18v3' }],
  ] as const) {
    const part = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) part.setAttribute(k, v);
    svg.append(part);
  }
  button.append(svg);

  const listener = createListener(Ctor, {
    ...opts,
    onError(message) {
      button.title = message;
      opts.onError?.(message);
    },
    onState(on) {
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    },
  });
  button.addEventListener('click', () => listener.toggle());
  button.stopListening = listener.stop;
  return button;
}
