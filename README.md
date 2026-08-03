# VocabMaster

An interactive English vocabulary learning site built for BCS, Bank, and IBA exam prep — plus the classic Word Smart II word list.

💐 Dedicated to my beloved wife — Anjuman

## Features

- **1699 words** across BCS & Bank Exams, IBA Admission, Word Smart I, and Word Smart II (real book images + a bonus curated set)
- Each word: IPA pronunciation, part of speech, English meaning, Bangla meaning, example sentence, synonyms/antonyms, a memory-trick mnemonic, and an exam-relevance reference
- 🔊 Text-to-speech pronunciation + 🎤 mic-based pronunciation scoring (Web Speech API)
- Flip cards, search, group tabs, and mutually-exclusive Favorites / Most Important / Done filters
- 🎯 **Daily Challenge** — pick a daily word target, get a non-repeating set each day, track a streak
- 📝 **Review Exam** — quiz yourself only on words you've actually practiced, with pass/fail history
- 📊 **My Progress** — stats dashboard + a dedicated "Done Words" list with click-to-zoom images
- Light/dark theme, mobile-friendly layout, subtle motion throughout (respects `prefers-reduced-motion`)

## Running locally

No build step — it's plain HTML/CSS/JS.

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Tech

Vanilla JavaScript, no frameworks, no dependencies. Word data lives in `data.js`; app logic in `app.js`; styles in `style.css`.
