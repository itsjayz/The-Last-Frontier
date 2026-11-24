import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { Experience } from '../scene/Experience';
import { CHAPTERS, type Chapter } from '../scene/chapters';
import { RETURN_EVENT } from './Invitation';

gsap.registerPlugin(ScrollTrigger);

type Status = 'loading' | 'ready' | 'unsupported';

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

interface Props {
  /** Section elements whose scroll extent drives each chapter's progress. */
  chapters: Record<Chapter, React.RefObject<HTMLElement | null>>;
}

const ORDER = CHAPTERS;

/**
 * Fixed full-viewport stage: the vgpu (WebGPU) black-hole canvas underneath,
 * the Three.js canvas on top.
 *
 * Query params (development aids):
 *   ?standalone                — ignore scroll; hold the scene at a fixed moment
 *   &chapter=crossing          — which chapter to hold (earlier chapters complete)
 *   &progress=0.4              — progress within that chapter
 */
export function CinematicStage({ chapters }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const holeCanvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<Status>(() => (webglAvailable() ? 'loading' : 'unsupported'));
  const [steps, setSteps] = useState({ fonts: false, scene: false, gpu: false });
  const [returning, setReturning] = useState(false);
  const loaded = steps.fonts && steps.scene && steps.gpu;
  const done = (key: keyof typeof steps) => setSteps((s) => (s[key] ? s : { ...s, [key]: true }));

  // Hold the page at the opening (no scroll) until everything is ready.
  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
    document.fonts.ready.then(() => done('fonts'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('is-loading', !loaded && status !== 'unsupported');
    root.classList.toggle('is-loaded', loaded || status === 'unsupported');
  }, [loaded, status]);

  useEffect(() => {
    if (status === 'unsupported' || !canvasRef.current || !holeCanvasRef.current) return;
    const canvas = canvasRef.current;
    const holeCanvas = holeCanvasRef.current;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const params = new URLSearchParams(window.location.search);
    const standalone = params.has('standalone');
    let experience: Experience | null = null;
    const triggers: ScrollTrigger[] = [];
    let cancelled = false;
    let disposeHole: (() => void) | null = null;

    const onResize = () => experience?.resize(window.innerWidth, window.innerHeight);

    // Return to Earth: fade to black, jump to the top, snap the scene back, fade in.
    const reduced = reducedMotion;
    const onReturn = () => {
      setReturning(true);
      window.setTimeout(
        () => {
          window.scrollTo({ top: 0, behavior: 'instant' });
          ScrollTrigger.update();
          experience?.snapProgress();
          window.setTimeout(() => setReturning(false), 80);
        },
        reduced ? 0 : 520,
      );
    };
    window.addEventListener(RETURN_EVENT, onReturn);

    // Loaded lazily so the page shell paints before three.js is parsed.
    import('../scene/Experience').then(({ Experience }) => {
      if (cancelled) return;
      try {
        experience = new Experience({ canvas, reducedMotion });
      } catch (err) {
        console.error(err);
        setStatus('unsupported');
        return;
      }
      const exp = experience;
      if (import.meta.env.DEV) (window as unknown as { __experience: Experience }).__experience = exp;
      window.addEventListener('resize', onResize);

      if (standalone) {
        const chapter = (params.get('chapter') as Chapter) ?? 'departure';
        const index = Math.max(0, ORDER.indexOf(chapter));
        ORDER.forEach((ch, i) => exp.setProgress(ch, i < index ? 1 : i === index ? Number(params.get('progress') ?? 0) : 0));
      } else {
        for (const ch of ORDER) {
          const el = chapters[ch].current;
          if (!el) continue;
          const trigger = ScrollTrigger.create({
            trigger: el,
            start: 'top top',
            end: 'bottom bottom',
            onUpdate: (self) => exp.setProgress(ch, self.progress),
          });
          exp.setProgress(ch, trigger.progress);
          triggers.push(trigger);
        }
      }

      exp.ready.then(
        () => {
          if (cancelled) return;
          setStatus('ready');
          done('scene');
        },
        (err) => {
          console.error('Astronaut failed to load', err);
          if (cancelled) return;
          setStatus('ready'); // still show space and Earth
          done('scene');
        },
      );

      // vgpu environments (WebGPU). The loader waits for them, but never longer
      // than the cap — on a slow GPU they finish in the background instead.
      const gpuCap = window.setTimeout(() => done('gpu'), 15000);
      import('../scene/vgpu/VgpuStage')
        .then(({ VgpuStage }) => VgpuStage.create(holeCanvas))
        .then((stage) => {
          if (!stage) return;
          if (cancelled) return stage.dispose();
          disposeHole = () => stage.dispose();
          exp.setStage(stage, holeCanvas);
        })
        .catch((err) => console.warn('vgpu stage failed', err))
        .finally(() => {
          window.clearTimeout(gpuCap);
          if (!cancelled) done('gpu');
        });
    });

    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      window.removeEventListener(RETURN_EVENT, onReturn);
      triggers.forEach((t) => t.kill());
      experience?.dispose(); // also disposes an attached vgpu stage
      if (!experience) disposeHole?.();
    };
  }, [status === 'unsupported', chapters]); // eslint-disable-line react-hooks/exhaustive-deps

  if (status === 'unsupported') {
    return (
      <div className="stage stage--fallback" role="img" aria-label="A lone astronaut drifting in deep space, Earth far behind.">
        <p>This journey needs WebGL 2. Try a recent desktop or mobile browser.</p>
      </div>
    );
  }

  const progress = (steps.fonts ? 0.1 : 0) + (steps.scene ? 0.5 : 0) + (steps.gpu ? 0.4 : 0);
  const stepLabel = !steps.scene ? 'Bringing the astronaut and Earth online' : !steps.gpu ? 'Bending light around the unknown' : 'Ready';

  return (
    <>
      <div className={`stage ${loaded ? 'is-ready' : ''}`} aria-hidden="true">
        <canvas ref={holeCanvasRef} className="stage__canvas stage__canvas--hole" />
        <canvas ref={canvasRef} className="stage__canvas stage__canvas--main" />
      </div>
      <div className={`veil ${returning ? 'is-on' : ''}`} aria-hidden="true" />
      <div className={`loader ${loaded ? 'is-done' : ''}`} role="status" aria-live="polite" aria-hidden={loaded}>
        <p className="loader__title">The Last Frontier</p>
        <div className="loader__bar">
          <span className="loader__fill" style={{ transform: `scaleX(${Math.max(0.04, progress)})` }} />
        </div>
        <p className="loader__meta">
          <span>{stepLabel}</span>
          <span>{Math.round(progress * 100)}%</span>
        </p>
      </div>
    </>
  );
}
