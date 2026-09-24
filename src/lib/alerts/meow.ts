// Cat-sound detection with Google's YAMNet audio classifier (it knows the AudioSet classes "Cat",
// "Meow", "Caterwaul"…), running entirely in the browser via MediaPipe. Audio never leaves the device.
// The WebAssembly runtime is served from /mediapipe (copied from node_modules at build time); the
// ~4 MB model is fetched once from Google and then cached by the browser.
import type { AudioClassifier } from "@mediapipe/tasks-audio";
import type { Sensitivity } from "@/lib/alerts/types";

const MODEL_URL =
  process.env.NEXT_PUBLIC_YAMNET_MODEL_URL ??
  "https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite";
const CAT_LABELS = new Set(["Cat", "Meow", "Caterwaul", "Purr", "Hiss"]);
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

export class MeowDetector {
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private buffer = new Float32Array(0);
  private filled = 0;

  private constructor(
    private classifier: AudioClassifier,
    private sensitivity: Sensitivity,
    private onMeow: (score: number, label: string) => void,
  ) {}

  /** Downloads the model on first use (this is the slow part). */
  static async create(sensitivity: Sensitivity, onMeow: (score: number, label: string) => void) {
    return new MeowDetector(await loadClassifier(), sensitivity, onMeow);
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
    let best = { score: 0, label: "" };
    for (const result of this.classifier.classify(audio, rate)) {
      for (const c of result.classifications[0]?.categories ?? []) {
        if (CAT_LABELS.has(c.categoryName) && c.score > best.score) best = { score: c.score, label: c.categoryName };
      }
    }
    if (best.score >= MIN_SCORE[this.sensitivity]) this.onMeow(best.score, best.label);
  }
}
