# 75-Day Challenge

A single-page tracker for a 75-day challenge (18 October – 31 December 2026, residency edition).

## Features

- Daily sheet with an 11-item checklist (sleep, workout, walk, diet, water, Anki, deep study, AI hour, reading, conversation, progress photo)
- Day types: workout day, Sunday rest, duty day
- Weekly study / AI / communication focus for each of the 11 weeks
- Body weight, energy, chapters read, top sets and notes per day
- Progress photos with a first-vs-latest comparison
- 75-day calendar heatmap, streak, good days (8+/11) and average score
- "Never miss twice" alert
- Group leaderboard (when hosted as a Claude artifact)

## Running

Open `index.html` in a browser. No build step.

When opened outside Claude, all data (including photos) is saved in the browser's
`localStorage` only. When hosted as a Claude artifact, data syncs to your account and
the group board is shared with others who open the page.
