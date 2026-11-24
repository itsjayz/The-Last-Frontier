import { createRef, useMemo } from 'react';
import { CinematicStage } from './components/CinematicStage';
import { ChapterSection } from './components/ChapterSection';
import { Intro, Invitation, MissionMark, ReturnToEarth } from './components/Invitation';
import { MusicToggle } from './components/MusicToggle';
import { CHAPTER_COPY } from './content/chapters';
import { CHAPTERS, type Chapter } from './scene/chapters';
import './App.css';

function App() {
  const chapters = useMemo(
    () => Object.fromEntries(CHAPTERS.map((c) => [c, createRef<HTMLElement>()])) as Record<Chapter, React.RefObject<HTMLElement | null>>,
    [],
  );

  return (
    <main id="top">
      <CinematicStage chapters={chapters} />
      <MissionMark />
      <ReturnToEarth />
      <MusicToggle />
      <h1 className="visually-hidden">The Last Frontier — a journey to a possible new world</h1>
      {CHAPTER_COPY.map((copy) => (
        <ChapterSection key={copy.id} ref={chapters[copy.id]} copy={copy} intro={copy.id === 'departure' ? <Intro /> : undefined}>
          {copy.id === 'possibility' && <Invitation />}
        </ChapterSection>
      ))}
    </main>
  );
}

export default App;
