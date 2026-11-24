# CLAUDE.md — THE LAST FRONTIER

## 1. Project overview

THE LAST FRONTIER is a fictional NASA exoplanet exploration mission landing page.

The experience follows one lone astronaut travelling through deep space to investigate a potentially habitable planet.

The creative direction combines:
- Cinematic space realism inspired by Interstellar.
- Immersive 3D storytelling inspired by Lusion.
- GPU-powered visual effects from vgpu.
- Experimental editorial design and typography.
- Scroll-driven cinematic storytelling inspired by the Skyroot Aerospace reference.

This is not a conventional SaaS landing page. It should feel like an interactive science-fiction film.

For the project goal refer 'C:\Users\jayde\Documents\Molades\beyond earth\research.md'

For the art direction refer 'C:\Users\jayde\Documents\Molades\beyond earth\art-direction.md'


## 2. Mandatory source documents

Read these before making significant decisions:

- `research.md`: JTBD, audience motivations and emotional outcomes.
- `art-direction.md`: Visual direction, narrative, typography and interaction principles.

Both documents are the creative source of truth.

## 3. Reference library

These references serve different purposes. Do not copy them literally. Extract their relevant design and interaction principles.

### A. Lusion
https://lusion.co/

Study:
- Immersive 3D environments.
- Spatial storytelling.
- Experimental transitions.
- Scroll-led interaction.
- Integration of typography and 3D visuals.

Apply these principles to the astronaut's journey.

### B. vgpu
https://vgpu.sh/examples

This is a technical visual reference and source for GPU-powered effects.

Prioritise:
- Optimized Black Hole: gravitational distortion and cosmic visuals.
- Earth: opening environment.
- Atmosphere & Clouds: destination planet and atmospheric descent.
- Particle Orbit: optional environmental particles.

Inspect actual source code and integration requirements before implementation.

Do not simply embed independent demos. Create a coherent visual experience.

### C. KEPLER-X
https://kepler-x-mocha.vercel.app/

Study:
- Space exploration narrative.
- Mission progression.
- Planetary discovery.
- Information hierarchy.
- How scientific information supports the visual experience.

Use it as a storytelling reference, not a visual template.

### D. Skyroot Aerospace scroll-driven website reference

User-provided video demonstrating a scroll-driven aerospace website.

Study:
- Rocket imagery and cinematic presentation.
- Image-sequence/frame-based animation.
- Scroll-controlled visual progression.
- Text overlays and narrative pacing.
- Relationship between scrolling and visual movement.

Use this as an interaction reference.

The final experience should adapt this approach to an astronaut travelling through space, rather than simply reproducing a rocket launch.

### E. Experimental black-hole coding poster

User-provided visual reference.

Study:
- Code as a physical visual element.
- Distorted perspective.
- Computational surrealism.
- Strong contrast and dramatic depth.

Use selectively for transitions and editorial treatments.

### F. End Credits editorial poster

User-provided visual reference.

Study:
- Experimental typography.
- Oversized display lettering.
- Film grain and texture.
- Unconventional positioning.
- Negative space.

### G. Built for the Thinkers visual

User-provided visual reference.

Study:
- Atmospheric lighting.
- Organic environments.
- Restrained typography.
- Isolated illumination.
- Cinematic contrast.

## 4. Core JTBD

**Emotional job:**

When humanity faces uncertainty about its future, I want to believe that there are still worlds worth discovering, so I can feel hope rather than helplessness about what lies ahead.

**Functional job:**

Discover and evaluate potentially habitable worlds beyond our solar system.

**Social job:**

Feel part of humanity's pursuit of something greater than ourselves.

Emotional progression:

Awe → Curiosity → Courage → Hope.

## 5. Narrative structure

Five primary chapters:

1. Departure: The astronaut leaves Earth.
2. The Crossing: The astronaut approaches and traverses a gravitational passage.
3. Discovery: A new planet emerges.
4. Arrival: Atmospheric descent and planetary landing.
5. Possibility: The astronaut explores the new world and the audience is invited to join the mission.

The astronaut must remain visibly present throughout the journey.

## 6. Technical direction

Preferred stack:
- React.
- TypeScript.
- Vite.
- vgpu for selected GPU-powered visuals.
- Three.js / React Three Fiber where appropriate.
- GSAP ScrollTrigger for scroll orchestration.
- CSS for typography and editorial composition.

Inspect the actual vgpu rendering architecture before deciding how to integrate it with Three.js.

Do not introduce unnecessary dependencies.

Evaluate real-time rendering versus scroll-synchronised cinematic sequences. Choose the leanest approach that meets the visual requirements.

## 7. Visual requirements

- Interstellar-level cinematic space realism.
- One consistent astronaut character.
- Realistic lighting, atmospheric depth and spatial scale.
- Experimental editorial typography.
- Minimal interface elements.
- Restrained colours.
- Meaningful transitions.
- Large areas of negative space.

Avoid generic SaaS layouts, excessive HUD elements, neon cyberpunk aesthetics and decorative animation without narrative purpose.

## 8. Development workflow

Build incrementally:

1. Project setup and dependency verification.
2. vgpu example inspection and integration.
3. Astronaut asset acquisition and loading.
4. First cinematic astronaut scene.
5. Scroll choreography and transitions.
6. Narrative typography and editorial UI.
7. Final polish and optimisation.

Do not implement the complete website before the first cinematic scene is convincing.

## 9. Development rules

- Inspect existing code before modifying it.
- Preserve working implementations.
- Keep components modular.
- Explain major architectural decisions.
- Avoid unnecessary dependencies.
- Do not fabricate assets or pretend placeholders are final visuals.
- Test every major implementation.
- Support responsive behaviour and reduced motion.
- Provide fallback behaviour when WebGPU is unavailable.
- Make targeted changes rather than rebuilding the application unnecessarily.

## 10. Creative north star

Make people feel the possibility of another world before asking them to understand the science behind it.

The website is not selling a planet. It is inviting people to imagine a future beyond the one they know.

Awe, followed by hope.