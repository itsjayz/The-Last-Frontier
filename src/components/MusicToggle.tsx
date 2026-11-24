import { useEffect, useRef, useState } from 'react';

const SRC = '/audio/dreaming-of-the-crash.mp3';
// The track's quiet intro is skipped: playback starts on the full entrance (1:38)
// and loops back before the closing fade (3:55). The reverb tail needs a longer
// loop crossfade than a dry mix would, so the seam doesn't sound cut off.
const START = 98;
const END = 235;
const LEVEL = 0.48; // 20% quieter than the original 0.6
const FADE_IN = 2.5;
const FADE_OUT = 1.2;
const LOOP_FADE = 4;

interface Player {
  el: HTMLAudioElement;
  ctx: AudioContext;
  gain: GainNode;
  looping: boolean;
}

function ramp(p: Player, to: number, seconds: number) {
  const g = p.gain.gain;
  const t = p.ctx.currentTime;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(to, t + seconds);
}

export function MusicToggle() {
  const [on, setOn] = useState(false);
  const player = useRef<Player | null>(null);
  const onRef = useRef(false);

  const ensure = () => {
    if (player.current) return player.current;
    const el = new Audio(SRC);
    el.preload = 'auto';
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    ctx.createMediaElementSource(el).connect(gain).connect(ctx.destination);
    const p: Player = { el, ctx, gain, looping: false };

    const restart = () => {
      el.currentTime = START;
      p.looping = false;
      if (onRef.current) ramp(p, LEVEL, LOOP_FADE);
    };
    el.addEventListener('timeupdate', () => {
      if (p.looping || el.currentTime < END - LOOP_FADE) return;
      p.looping = true;
      ramp(p, 0, LOOP_FADE);
      window.setTimeout(restart, LOOP_FADE * 1000);
    });
    el.addEventListener('ended', restart);
    player.current = p;
    return p;
  };

  const toggle = () => {
    const next = !on;
    setOn(next);
    onRef.current = next;
    const p = ensure();
    if (next) {
      void p.ctx.resume();
      if (p.el.currentTime < START) p.el.currentTime = START;
      void p.el.play().then(() => ramp(p, LEVEL, FADE_IN));
    } else {
      ramp(p, 0, FADE_OUT);
      window.setTimeout(() => {
        if (!onRef.current) p.el.pause();
      }, FADE_OUT * 1000);
    }
  };

  useEffect(() => {
    const onVisibility = () => {
      const p = player.current;
      if (!p || !onRef.current) return;
      if (document.hidden) p.el.pause();
      else void p.el.play();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      const p = player.current;
      if (p) {
        p.el.pause();
        void p.ctx.close();
      }
    };
  }, []);

  return (
    <button type="button" className={`music-toggle ${on ? 'is-on' : ''}`} onClick={toggle} aria-pressed={on}>
      <span aria-hidden="true" className="music-toggle__bars">
        <i />
        <i />
        <i />
        <i />
      </span>
      {on ? 'Sound on' : 'Sound off'}
    </button>
  );
}
