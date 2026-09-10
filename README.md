# Restaurant Tracker

> ⚠️ **Proof of Concept.** 

As a family full of neurodivergent folks, we often struggle to keep track of where everyone likes to eat, and what they like to eat. Each of us has different sensory needs when it comes to food. It can often be a challenge to remember where we all like to eat together. The goal of this app is to make this process easy and fun by centering the UX around simply taking a photo and uploading it later.

## Tech stack

- **Next.js 15** (App Router) + **React 18**
- **Material UI 6** with a dark theme
- **exifr** for client-side EXIF parsing
- **Mapbox Search Box API** for nearby-business lookup

## Getting started

### Prerequisites

- Node.js 18+
- A free [Mapbox access token](https://account.mapbox.com/access-tokens/)

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure your Mapbox token
cp .env.local.example .env.local
# then edit .env.local and set MAPBOX_TOKEN=...

# 3. Run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and select a photo that has location data.

> **Tip:** Photos taken on a phone with location services enabled are the best test cases. Images shared via most messaging apps or social platforms have their EXIF/GPS stripped.

## Environment variables

| Variable       | Description                                              |
| -------------- | ------------------------------------------------------- |
| `MAPBOX_TOKEN` | Mapbox access token, used **server-side** only.         |

`MAPBOX_TOKEN` is read only inside the `/api/nearby` route, so it is never exposed to the browser.

## Scripts

| Command         | Description                       |
| --------------- | --------------------------------- |
| `npm run dev`   | Start the development server      |
| `npm run build` | Production build                  |
| `npm run start` | Serve the production build        |
| `npm run lint`  | Run ESLint                        |

## Project structure

```
src/
├── app/
│   ├── api/nearby/route.ts   # Server route: coords -> nearby businesses (Mapbox)
│   ├── layout.tsx            # Root layout, MUI theme provider
│   └── page.tsx              # Home: image select + EXIF read + results
└── theme.ts                  # MUI dark theme
```

## Known limitations (it's a POC)

- Only surfaces `food_and_drink` businesses within a fixed ~60m radius.
- No tests, no auth, minimal error handling.
- Relies entirely on EXIF GPS — images without it produce no result.
- Not optimized or hardened for production use.
