'use strict';

// Shared by the ROM generator (both one-shot sound effects and Music-tab
// instrument notes), the browser preview (utils/sound-preview.js,
// utils/music-playback.js), and the envelope graph (components/
// EnvelopeGraph.vue) - all three build the exact same AUDV-per-frame curve
// from the same inputs, so the picture the user drags always matches what
// actually plays, both in the browser and in the compiled ROM.
//
// AUDV is 4-bit (0-15) write-only TIA hardware, so there's no real curve at
// runtime - just a sequence of discrete volume writes, one per frame.
// Attack ramps 0 -> peakVolume, Decay ramps peakVolume -> sustainVolume,
// Sustain holds flat for its own `sustainLength` frames, then Release ramps
// sustainVolume -> 0 over the following `release` frames - i.e. Release
// starts the instant Sustain ends, NOT always anchored to the sound/note's
// own last frame the way it originally was (see sustainLength's own comment
// in blocks/soundfx.js for why that changed - Sustain used to have no
// length of its own at all). If attack+decay+sustainLength+release together
// don't reach all the way to totalFrames, the note/sound simply stays
// silent for whatever's left after Release finishes, rather than Sustain
// silently absorbing that gap the way it used to.

// If attack+decay+sustainLength+release together don't fit within
// totalFrames, every stage is scaled down proportionally (rounded) rather
// than truncated - same spirit as the old one-stage Fade's own "a note
// shorter than its own fade length still fades for its whole duration
// instead of not fading at all" clamp, just generalized to 4 stages instead
// of 1. Exported separately (not just inlined into buildEnvelopeCurve
// below) because the ROM generator needs these exact clamped stage lengths
// themselves - not just the resulting curve - to size/index its  per-
// stage data tables (see generateEnvelopeChecks in generators/bbasic/
// soundfx.js).
export const clampEnvelopeStages = ({attack, decay, sustainLength, release, totalFrames}) => {
  const frames = Math.max(1, Math.round(Number(totalFrames) || 0));
  let a = Math.max(0, Math.round(Number(attack) || 0));
  let d = Math.max(0, Math.round(Number(decay) || 0));
  let s = Math.max(0, Math.round(Number(sustainLength) || 0));
  let r = Math.max(0, Math.round(Number(release) || 0));
  const stagesTotal = a + d + s + r;
  if (stagesTotal > frames) {
    const scale = frames / stagesTotal;
    a = Math.round(a * scale);
    d = Math.round(d * scale);
    s = Math.round(s * scale);
    r = Math.max(0, frames - a - d - s);
  }
  return {attack: a, decay: d, sustainLength: s, release: r};
};

export const buildEnvelopeCurve = ({attack, decay, sustainPercent, sustainLength, release, peakVolume,
  totalFrames}) => {
  const frames = Math.max(1, Math.round(Number(totalFrames) || 0));
  const peak = Math.max(0, Math.min(15, Math.round(Number(peakVolume) || 0)));
  const sustainVolume = Math.max(0, Math.min(peak, Math.round(peak * (Number(sustainPercent) || 0) / 100)));
  const {attack: a, decay: d, sustainLength: s, release: r} =
    clampEnvelopeStages({attack, decay, sustainLength, release, totalFrames: frames});

  const releaseStart = a + d + s;
  const releaseEnd = releaseStart + r;
  const curve = [];
  for (let i = 0; i < frames; i++) {
    if (i < a) {
      curve.push(a === 0 ? peak : Math.round(peak * (i + 1) / a));
    } else if (i < a + d) {
      const into = i - a;
      curve.push(d === 0 ? sustainVolume : Math.round(peak - (peak - sustainVolume) * (into + 1) / d));
    } else if (i < releaseStart) {
      curve.push(sustainVolume);
    } else if (i < releaseEnd) {
      const into = i - releaseStart;
      curve.push(r === 0 ? 0 : Math.max(0, Math.round(sustainVolume - sustainVolume * (into + 1) / r)));
    } else {
      // Envelope has fully finished (attack+decay+sustain+release all
      // elapsed) before the sound/note itself ends - stays silent for
      // whatever's left, rather than Sustain silently stretching to fill
      // the gap the way it used to.
      curve.push(0);
    }
  }
  return curve;
};
