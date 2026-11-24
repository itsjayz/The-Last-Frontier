import { forwardRef, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { ChapterCopy } from '../content/chapters';

gsap.registerPlugin(ScrollTrigger);

interface Props {
  copy: ChapterCopy;
  /** Shown at the very start of the chapter and lifted away by the first scroll. */
  intro?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * One scroll chapter. Its height sets the pace; a sticky full-viewport frame
 * holds the copy, which reveals and recedes with the chapter's own progress
 * (the same progress that drives the camera), so words move with the image.
 * Beats within a chapter share one spot: each replaces the last.
 */
export const ChapterSection = forwardRef<HTMLElement, Props>(function ChapterSection({ copy, intro, children }, ref) {
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = frameRef.current;
    const section = frame?.parentElement;
    if (!frame || !section) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: { trigger: section, start: 'top top', end: 'bottom bottom', scrub: reduced ? true : 0.8 },
        defaults: { ease: 'power2.out' },
      });
      tl.set({}, {}, 1); // timeline spans 0..1 = chapter progress
      const hidden = reduced ? { opacity: 0 } : { opacity: 0, y: 28, filter: 'blur(10px)' };
      const shown = reduced ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' };
      const gone = reduced ? { opacity: 0 } : { opacity: 0, y: -18, filter: 'blur(6px)' };

      frame.querySelectorAll<HTMLElement>('[data-beat]').forEach((beat, i) => {
        const [tin, tout] = copy.beats[i].at;
        const span = tout - tin;
        const lines = beat.querySelectorAll('[data-line]');
        tl.fromTo(lines, hidden, { ...shown, duration: span * 0.25, stagger: span * 0.12 }, tin);
        if (tout <= 1) tl.to(lines, { ...gone, duration: span * 0.18, stagger: span * 0.05 }, tout - span * 0.2);
      });

      const label = frame.querySelector('[data-label]');
      const firstIn = copy.beats[0].at[0];
      if (label) tl.fromTo(label, { opacity: 0 }, { opacity: 1, duration: 0.06 }, Math.max(0, firstIn - 0.04)).to(label, { opacity: 0, duration: 0.05 }, 0.95);

      const notes = frame.querySelectorAll('[data-note]');
      if (notes.length && copy.notesAt) {
        const [tin, tout] = copy.notesAt;
        tl.fromTo(notes, { opacity: 0, x: reduced ? 0 : 12 }, { opacity: 1, x: 0, duration: 0.06, stagger: 0.035 }, tin);
        if (tout <= 1) tl.to(notes, { opacity: 0, duration: 0.05 }, tout - 0.06);
      }

      const introEl = frame.querySelector('[data-intro]');
      if (introEl) tl.fromTo(introEl, { opacity: 1, y: 0 }, { opacity: 0, y: reduced ? 0 : -40, duration: 0.07, ease: 'power1.in' }, 0.005);

      const cta = frame.querySelector('[data-cta]');
      if (cta) tl.fromTo(cta, { autoAlpha: 0, y: reduced ? 0 : 16 }, { autoAlpha: 1, y: 0, duration: 0.1 }, 0.62);
    }, frame);
    return () => ctx.revert();
  }, [copy]);

  return (
    <section ref={ref} className={`chapter chapter--${copy.id}`} aria-label={`${copy.label}. ${copy.ariaSummary}`}>
      <div ref={frameRef} className={`chapter__frame chapter__frame--${copy.placement}`}>
        {intro && (
          <div className="chapter__intro" data-intro>
            {intro}
          </div>
        )}
        <p className="chapter__label" data-label>
          {copy.label}
        </p>
        <div className="chapter__beats">
          {copy.beats.map((beat) => (
            <h2 key={beat.lead} className="chapter__statement" data-beat>
              <span className="chapter__line" data-line>
                {beat.lead}
              </span>{' '}
              {beat.turn && (
                <em className="chapter__line chapter__line--turn" data-line>
                  {beat.turn}
                </em>
              )}
            </h2>
          ))}
        </div>
        {copy.notes && (
          <dl className="chapter__notes">
            {copy.notes.map((n) => (
              <div key={n.label} className="chapter__note" data-note>
                <dt>{n.label}</dt>
                <dd>{n.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {children}
      </div>
    </section>
  );
});
