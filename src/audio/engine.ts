/**
 * Procedurally synthesised sound.
 *
 * No audio files, for the same reason there are no model files: the repo stays
 * text, deploys as static assets, and every sound is a handful of numbers that
 * can be retuned without opening an editor. WebAudio's oscillators and noise
 * buffers are more than enough for the register this game wants — soft, short,
 * unobtrusive.
 *
 * Browsers refuse to start an AudioContext until the user has interacted, so the
 * context is created lazily on the first sound after a gesture. Nothing here
 * throws if audio is unavailable; a silent game is a working game.
 */

export type SoundName = "plant" | "dig" | "build" | "gather" | "refuse" | "rain";

export interface Audio {
  play(name: SoundName): void;
  /** Rain is a sustained bed rather than a one-shot. */
  setRain(intensity: number): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
}

export function createAudio(): Audio {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let rainGain: GainNode | null = null;
  let muted = false;

  const ensure = (): AudioContext | null => {
    if (context) return context;
    try {
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(context.destination);
    } catch {
      return null;
    }
    return context;
  };

  /** A short pitched blip with a percussive envelope. */
  const blip = (
    ctx: AudioContext,
    frequency: number,
    duration: number,
    type: OscillatorType,
    gain: number,
  ): void => {
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
    // A slight downward glide stops repeated sounds feeling mechanical.
    oscillator.frequency.exponentialRampToValueAtTime(
      frequency * 0.82,
      ctx.currentTime + duration,
    );

    envelope.gain.setValueAtTime(0, ctx.currentTime);
    envelope.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    oscillator.connect(envelope);
    if (master) envelope.connect(master);
    oscillator.start();
    oscillator.stop(ctx.currentTime + duration + 0.02);
  };

  /** Filtered white noise, for rustles and rain. */
  const noise = (ctx: AudioContext, duration: number, cutoff: number, gain: number): void => {
    const samples = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i++) data[i] = Math.random() * 2 - 1;

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(gain, ctx.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    source.connect(filter).connect(envelope);
    if (master) envelope.connect(master);
    source.start();
  };

  return {
    get muted() {
      return muted;
    },

    play(name) {
      const ctx = ensure();
      if (!ctx || muted) return;
      void ctx.resume();

      switch (name) {
        case "plant":
          noise(ctx, 0.28, 2600, 0.16);
          blip(ctx, 520, 0.14, "sine", 0.1);
          break;
        case "dig":
          noise(ctx, 0.42, 900, 0.24);
          break;
        case "build":
          blip(ctx, 220, 0.18, "triangle", 0.16);
          blip(ctx, 330, 0.22, "triangle", 0.1);
          break;
        case "gather":
          blip(ctx, 740, 0.1, "sine", 0.12);
          blip(ctx, 990, 0.14, "sine", 0.08);
          break;
        case "refuse":
          blip(ctx, 180, 0.13, "square", 0.06);
          break;
        case "rain":
          noise(ctx, 0.6, 4200, 0.1);
          break;
      }
    },

    setRain(intensity) {
      const ctx = ensure();
      if (!ctx || !master) return;

      if (!rainGain) {
        rainGain = ctx.createGain();
        rainGain.gain.value = 0;
        rainGain.connect(master);

        // A long looping noise buffer, filtered — cheap and convincing enough
        // at the volume rain sits at.
        const seconds = 2;
        const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;

        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 2200;

        source.connect(filter).connect(rainGain);
        source.start();
      }

      // Ramped rather than set, or a change mid-storm clicks.
      rainGain.gain.linearRampToValueAtTime(
        Math.min(0.22, Math.max(0, intensity) * 0.22),
        ctx.currentTime + 0.3,
      );
    },

    setMuted(next) {
      muted = next;
      if (master) master.gain.value = muted ? 0 : 0.5;
    },
  };
}
