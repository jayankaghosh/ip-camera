// Sound alerts (cats, dogs, crashes) with Google's YAMNet audio classifier, which scores all 521
// AudioSet sound classes every second, running entirely in the browser via MediaPipe. Watching for
// more kinds costs nothing extra. Audio never leaves the device.
// The WebAssembly runtime is served from /mediapipe (copied from node_modules at build time); the
// ~4 MB model is fetched once from Google and then cached by the browser.
import type { AudioClassifier } from "@mediapipe/tasks-audio";
import type { Sensitivity, SoundKind } from "@/lib/alerts/types";

const MODEL_URL =
  process.env.NEXT_PUBLIC_YAMNET_MODEL_URL ??
  "https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite";
/** YAMNet label names (exactly as in the model's label list) that count as each kind of alert. */
const LABELS: Record<SoundKind, Set<string>> = {
  meow: new Set(["Cat", "Meow", "Caterwaul", "Purr", "Hiss"]),
  bark: new Set(["Dog", "Bark", "Yip", "Howl", "Bow-wow", "Growling", "Whimper (dog)"]),
  // Not "Knock" (usually the door) or "Crack" (fireworks, knuckles…).
  crash: new Set(["Smash, crash", "Thump, thud", "Thunk", "Bang", "Slam", "Breaking", "Shatter", "Clatter"]),
};
const MIN_SCORE: Record<Sensitivity, number> = { high: 0.15, medium: 0.3, low: 0.5 };
/** YAMNet looks at ~1 s of audio; classify once per second. */
const WINDOW_SECONDS = 1;

let classifierPromise: Promise<AudioClassifier> | null = null;

function loadClassifier() {
  classifierPromise ??= (async () => {
    const { AudioClassifier, FilesetResolver } = await import("@mediapipe/tasks-audio");
    const fileset = await FilesetResolver.forAudioTasks("/mediapipe");
    return AudioClassifier.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL },
      maxResults: 8,
      scoreThreshold: 0.05,
    });
  })().catch((err) => {
    classifierPromise = null; // allow a retry next time
    throw err;
  });
  return classifierPromise;
}

export class SoundDetector {
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private buffer = new Float32Array(0);
  private filled = 0;

  private constructor(
    private classifier: AudioClassifier,
    private kinds: SoundKind[],
    private sensitivity: Sensitivity,
    private onSound: (kind: SoundKind, score: number, label: string) => void,
  ) {}

  /** Downloads the model on first use (this is the slow part). */
  static async create(
    kinds: SoundKind[],
    sensitivity: Sensitivity,
    onSound: (kind: SoundKind, score: number, label: string) => void,
  ) {
    return new SoundDetector(await loadClassifier(), kinds, sensitivity, onSound);
  }

  /** Listen to this mic track, or pause with null (e.g. the host's mic was turned off). */
  setTrack(track: MediaStreamTrack | null) {
    this.source?.disconnect();
    this.processor?.disconnect();
    this.source = null;
    this.processor = null;
    if (!track) return;

    this.context ??= new AudioContext();
    this.context.resume().catch(() => {});
    const rate = this.context.sampleRate;
    this.buffer = new Float32Array(Math.round(rate * WINDOW_SECONDS));
    this.filled = 0;

    this.source = this.context.createMediaStreamSource(new MediaStream([track]));
    // ScriptProcessor is deprecated but works everywhere (including old phones) without a worklet file.
    this.processor = this.context.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (e) => this.collect(e.inputBuffer.getChannelData(0), rate);
    const mute = this.context.createGain();
    mute.gain.value = 0; // the processor must be connected to run, but we don't want to hear it
    this.source.connect(this.processor).connect(mute).connect(this.context.destination);
  }

  stop() {
    this.setTrack(null);
    this.context?.close().catch(() => {});
    this.context = null;
  }

  private collect(samples: Float32Array, rate: number) {
    let offset = 0;
    while (offset < samples.length) {
      const n = Math.min(samples.length - offset, this.buffer.length - this.filled);
      this.buffer.set(samples.subarray(offset, offset + n), this.filled);
      this.filled += n;
      offset += n;
      if (this.filled === this.buffer.length) {
        this.classify(this.buffer, rate);
        this.filled = 0;
      }
    }
  }

  private classify(audio: Float32Array, rate: number) {
    const results = this.classifier.classify(audio, rate);
    for (const kind of this.kinds) {
      let best = { score: 0, label: "" };
      for (const result of results) {
        for (const c of result.classifications[0]?.categories ?? []) {
          if (LABELS[kind].has(c.categoryName) && c.score > best.score) best = { score: c.score, label: c.categoryName };
        }
      }
      if (best.score >= MIN_SCORE[this.sensitivity]) this.onSound(kind, best.score, best.label);
    }
  }
}
