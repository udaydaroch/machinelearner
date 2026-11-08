# Machine Learner — evolving the perfect shot

A genetic algorithm that learns live, one attempt at a time, to:

- 🏏 **Cricket**: hit a SIX (keeper's view). You set where the ball pitches, its line and its speed.
- 🏀 **Basketball**: sink the shot (behind the shooter). You set the shooter's distance and court angle.
- 🎯 **Darts**: hit the BULLSEYE (over the thrower's shoulder). You set the throwing distance, the board height and how much the hand wobbles.
  Every throw leaves a hole in the board, so you can watch the trial-and-error scatter tighten around the bull.

## How it learns
**General strategy (shared, `js/ga.js`):** a steady-state genetic algorithm. Each attempt is a genome (genes in 0..1).
After every attempt the genome is scored and, if it beats the weakest member, it replaces that member (elitist). Children
come from tournament selection, uniform/blend crossover and Gaussian mutation. The mutation size adapts (1/5th success rule),
and random immigrants are injected when learning stalls.

**Sport-specific strategy (`js/sports/*.js` → `guide()`):** about half of the children are "coached". The learner reads
what happened on the parent's attempt (where the ball really was, short/long, launch angle, spray direction) and nudges the
genes in the right direction. Untick "Use sport-specific strategy" in the UI to compare it with a pure GA.

## Run locally
It's a static site with no build step:
```bash
npx serve .        # or: python3 -m http.server 8000
```
(It must be served over HTTP because ES modules don't load from `file://`.)

## Deploy to Vercel
```bash
npm i -g vercel
vercel          # preview
vercel --prod   # production
```
Or push to GitHub and import the repo at vercel.com/new. Use Framework Preset **Other**, with no build command and `.` as the output directory.
