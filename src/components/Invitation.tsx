import { useEffect, useState } from 'react';
import { INTRO } from '../content/chapters';

export const RETURN_EVENT = 'journey:return';

/**
 * The opening title card. Two parts with their own space: the title group
 * (eyebrow → heading → description, kept tight together) in the frame's empty
 * dark region, and the scroll invitation at the bottom.
 */
export function Intro() {
  const [mission, concept] = INTRO.kicker.split(' · ');
  const [first, ...rest] = INTRO.title.split(' ');
  const titleEnd = rest.slice(1).join(' ');
  return (
    <>
      <div className="intro__group">
        <p className="intro__eyebrow">
          <span>{mission}</span>
          <span aria-hidden="true" className="intro__eyebrow-rule" />
          <span>{concept}</span>
        </p>
        <p className="intro__title">
          {/* "The Last / Frontier": stacks on larger screens, one line on phones. */}
          <span className="intro__title-line">
            {first} {rest[0]}
          </span>{' '}
          <span className="intro__title-line">{titleEnd}</span>
        </p>
        <p className="intro__line">{INTRO.line}</p>
      </div>
      <p className="intro__cue">
        <span aria-hidden="true" className="intro__cue-line" />
        {INTRO.cue}
      </p>
    </>
  );
}

/**
 * The single call to action, and the credits the imagery requires.
 * The destination is a placeholder until a real mission page exists.
 */
export function Invitation() {
  return (
    <>
      <div className="invitation" data-cta>
        <a className="invitation__cta" href="#top">
          Follow the journey
          <span aria-hidden="true" className="invitation__arrow">
            →
          </span>
        </a>
        <p className="invitation__note">Follow LF-1’s findings as they come in — and be part of what we discover next.</p>
      </div>
      {/* Outside the animated block, so it anchors to the frame's corner. */}
      <p className="invitation__credits">
        THE LAST FRONTIER is a fictional mission concept. Earth imagery: NASA Earth Observatory (Blue Marble, Black Marble).
        Black hole and planet rendering adapted from vgpu examples (MIT).
      </p>
    </>
  );
}

/** One click back to the opening shot, from anywhere in the journey. */
export function ReturnToEarth() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const update = () => setVisible(window.scrollY > window.innerHeight * 0.8);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  return (
    <button
      type="button"
      className={`return-earth ${visible ? 'is-visible' : ''}`}
      onClick={() => window.dispatchEvent(new Event(RETURN_EVENT))}
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
    >
      <span aria-hidden="true" className="return-earth__icon" />
      Return to Earth
    </button>
  );
}

/** Fixed, quiet mission identity at the frame edges. */
export function MissionMark() {
  return (
    <header className="mission-mark" aria-hidden="true">
      <span className="mission-mark__name">The Last Frontier</span>
      <span className="mission-mark__meta">Mission LF-1 · Exploratory</span>
    </header>
  );
}
