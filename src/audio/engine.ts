/**
 * Procedurally synthesised sound.
 *
 * No audio files, for the same reason there are no model files: the repo stays
 * text, deploys as static assets, and every sound is a handful of numbers that
 * can be retuned without opening an editor. WebAudio's oscillators and noise
 * buffers are more than enough for the register this game wants — soft, short,
 * unobtrusive.
 *
 * Browsers refuse to start an AudioContext until the user has interacted. A
 * context created earlier starts suspended and stays silent until something
 * resumes it, so it is created — and resumed — on the first key press or click
 * instead, and rain asked for before then waits rather than creating one.
 * Nothing here throws if audio is unavailable; a silent game is a working game.
 */

import { clamp01 } from "../core/clamp";

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
  /** Level the rain is ramping towards, so the ramp is only rescheduled on a change. */
  let rainLevel = 0;
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

  // The first gesture is the earliest moment a context is allowed to run.
  const unlock = (): void => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
    const ctx = ensure();
    if (ctx?.state === "suspended") void ctx.resume();
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);

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
      const level = clamp01(intensity) * 0.22;
      // Called every frame; nothing to do unless the level actually moves.
      if (Math.abs(level - rainLevel) < 0.002) return;
      // Silence needs no context, and creating one before a gesture would only
      // make a suspended one.
      if (!context && level === 0) return;
      const ctx = ensure();
      if (!ctx || !master) return;
      rainLevel = level;

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
      rainGain.gain.linearRampToValueAtTime(level, ctx.currentTime + 0.3);
    },

    setMuted(next) {
      muted = next;
      if (master) master.gain.value = muted ? 0 : 0.5;
    },
  };
}
