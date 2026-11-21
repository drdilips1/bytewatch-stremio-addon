// Home's picture, chosen with the dice in the header: a misty sunrise lake, a sunset over the sea,
// a quiet night sky, a green meadow and snowy mountains. All drawn (no downloads, works offline),
// soft at the edges so the page stays calm and light.
import { persisted, useStore } from '../src/lib/store.js';

export const sceneChoice = persisted('briskScene', 'sunrise');
export const SCENES = ['sunrise', 'sunset', 'night', 'meadow', 'mountains'];
/** Another scene than the one showing. */
export function rollScene() {
  const now = sceneChoice.get();
  const rest = SCENES.filter((k) => k !== now);
  sceneChoice.set(rest[Math.floor(Math.random() * rest.length)]);
}

/** A misty lake at sunrise: hills, a low sun, a sailboat and three birds (drawn, so it works offline). */
const Lake = () => (
  <svg class="b-scene" data-scene="sunrise" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="bs-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f6efe4" stop-opacity="0" />
        <stop offset="0.5" stop-color="#f3e6d3" />
        <stop offset="1" stop-color="#efdfc8" />
      </linearGradient>
      <radialGradient id="bs-sun" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#fbeed6" />
        <stop offset="1" stop-color="#f5dcb5" />
      </radialGradient>
      <linearGradient id="bs-water" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#e9dcc8" />
        <stop offset="1" stop-color="#f6efe4" />
      </linearGradient>
      <linearGradient id="bs-mist" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f3e8d8" stop-opacity="0" />
        <stop offset="0.55" stop-color="#f1e5d3" stop-opacity="0.85" />
        <stop offset="1" stop-color="#ece0cc" stop-opacity="0" />
      </linearGradient>
      <linearGradient id="bs-glow" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f7e3bf" stop-opacity="0.9" />
        <stop offset="1" stop-color="#f7e3bf" stop-opacity="0" />
      </linearGradient>
    </defs>
    <rect width="400" height="260" fill="url(#bs-sky)" />
    <circle cx="232" cy="122" r="30" fill="url(#bs-sun)" />
    <path d="M0 118 C40 100 80 104 120 112 C170 122 200 98 250 96 C300 94 340 80 400 72 V160 H0 Z" fill="#cfc2ae" opacity="0.55" />
    <path d="M0 136 C50 120 90 126 140 132 C190 138 230 112 280 116 C330 120 360 104 400 100 V160 H0 Z" fill="#b8ad99" opacity="0.6" />
    <path d="M0 150 C30 142 60 146 90 144 C120 141 150 148 180 146 C230 142 260 150 300 146 C340 142 370 146 400 142 V162 H0 Z" fill="#8f927b" opacity="0.55" />
    <rect y="160" width="400" height="100" fill="url(#bs-water)" />
    <rect y="146" width="400" height="30" fill="url(#bs-mist)" />
    <rect x="214" y="160" width="36" height="80" fill="url(#bs-glow)" opacity="0.7" />
    <g opacity="0.85">
      <path d="M314 116 L314 154" stroke="#6b5d4c" stroke-width="1.2" />
      <path d="M314 116 L332 150 L314 150 Z" fill="#f4ece0" stroke="#d9cbb6" stroke-width="0.6" />
      <path d="M313 122 L300 150 L313 150 Z" fill="#ece1d1" />
      <path d="M296 154 L334 154 L329 159 L301 159 Z" fill="#7a6b58" />
      <path d="M314 162 L314 186" stroke="#7a6b58" stroke-width="0.8" opacity="0.35" />
    </g>
    <g fill="none" stroke="#7d7062" stroke-width="1.3" stroke-linecap="round" opacity="0.8">
      <path d="M318 52 q4 -4 8 0 q4 -4 8 0" />
      <path d="M340 40 q3 -3 6 0 q3 -3 6 0" />
      <path d="M332 64 q3 -3 6 0 q3 -3 6 0" />
    </g>
  </svg>
);

/** Sunset over the sea: a peach-and-rose sky, a half sun on the water, gulls and a far headland. */
const Sunset = () => (
  <svg class="b-scene" data-scene="sunset" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="ss-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f6e7dc" stop-opacity="0" />
        <stop offset="0.45" stop-color="#f4d3c0" />
        <stop offset="0.8" stop-color="#f1c0a2" />
        <stop offset="1" stop-color="#eeb48f" />
      </linearGradient>
      <linearGradient id="ss-sea" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#d9a68e" />
        <stop offset="1" stop-color="#f3e3d6" />
      </linearGradient>
      <linearGradient id="ss-path" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fbe2b8" stop-opacity="0.95" />
        <stop offset="1" stop-color="#fbe2b8" stop-opacity="0" />
      </linearGradient>
    </defs>
    <rect width="400" height="260" fill="url(#ss-sky)" />
    <path d="M60 92 q60 -10 120 -2 q40 6 70 0" fill="none" stroke="#f8dccb" stroke-width="7" stroke-linecap="round" opacity="0.7" />
    <path d="M230 70 q50 -8 110 0" fill="none" stroke="#f9e2d3" stroke-width="5" stroke-linecap="round" opacity="0.6" />
    <circle cx="200" cy="158" r="34" fill="#f9d79f" />
    <path d="M300 158 C320 140 345 134 372 140 C388 144 396 150 400 152 V160 H300 Z" fill="#a9877a" opacity="0.65" />
    <rect y="158" width="400" height="102" fill="url(#ss-sea)" />
    <rect x="176" y="158" width="48" height="90" fill="url(#ss-path)" opacity="0.8" />
    <g stroke="#fbe7c8" stroke-width="1.4" stroke-linecap="round" opacity="0.8">
      <path d="M150 176 h30" /><path d="M222 184 h40" /><path d="M120 198 h24" /><path d="M240 206 h30" />
    </g>
    <g fill="none" stroke="#8a6658" stroke-width="1.3" stroke-linecap="round" opacity="0.75">
      <path d="M96 64 q4 -4 8 0 q4 -4 8 0" />
      <path d="M120 50 q3 -3 6 0 q3 -3 6 0" />
    </g>
  </svg>
);

/** A quiet night: deep blue fading to dusk, a crescent moon, stars and its light on a still lake. */
const Night = () => (
  <svg class="b-scene" data-scene="night" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="nt-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#3d4a6b" stop-opacity="0" />
        <stop offset="0.42" stop-color="#5d6a8c" />
        <stop offset="0.8" stop-color="#9195b0" />
        <stop offset="1" stop-color="#c9b9b4" />
      </linearGradient>
      <linearGradient id="nt-lake" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#6e7592" />
        <stop offset="1" stop-color="#e9dfd6" />
      </linearGradient>
      <linearGradient id="nt-glow" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f4ecd8" stop-opacity="0.7" />
        <stop offset="1" stop-color="#f4ecd8" stop-opacity="0" />
      </linearGradient>
    </defs>
    <rect width="400" height="260" fill="url(#nt-sky)" />
    <g fill="#f6f0e2">
      <circle cx="40" cy="70" r="1.2" /><circle cx="86" cy="96" r="0.9" /><circle cx="128" cy="62" r="1.4" /><circle cx="170" cy="88" r="0.8" />
      <circle cx="206" cy="58" r="1.1" /><circle cx="250" cy="80" r="0.9" /><circle cx="352" cy="66" r="1.3" /><circle cx="378" cy="98" r="0.8" />
      <circle cx="60" cy="112" r="0.8" /><circle cx="226" cy="108" r="0.7" /><circle cx="330" cy="112" r="0.9" />
    </g>
    <path d="M300 64 a20 20 0 1 0 22 26 a16 16 0 1 1 -22 -26 Z" fill="#f6efdc" />
    <path d="M0 140 C50 126 100 132 150 136 C200 140 240 120 290 124 C340 128 370 118 400 116 V162 H0 Z" fill="#5d6683" opacity="0.75" />
    <path d="M0 152 C40 146 80 150 120 148 C170 145 220 152 270 149 C320 146 360 150 400 147 V164 H0 Z" fill="#4c5570" opacity="0.8" />
    <rect y="162" width="400" height="98" fill="url(#nt-lake)" />
    <rect x="296" y="162" width="28" height="80" fill="url(#nt-glow)" />
  </svg>
);

/** A green meadow in the morning: rolling hills, a few round trees and a path. */
const Meadow = () => (
  <svg class="b-scene" data-scene="meadow" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="md-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#eef0e2" stop-opacity="0" />
        <stop offset="0.5" stop-color="#e9eedb" />
        <stop offset="1" stop-color="#eef0dd" />
      </linearGradient>
    </defs>
    <rect width="400" height="260" fill="url(#md-sky)" />
    <circle cx="300" cy="96" r="22" fill="#fbf0d2" />
    <path d="M0 140 C60 112 120 118 180 128 C240 138 300 108 400 112 V260 H0 Z" fill="#c4cfa6" />
    <path d="M0 170 C70 146 140 150 210 162 C280 174 330 150 400 152 V260 H0 Z" fill="#a8b886" />
    <path d="M0 206 C80 186 160 192 240 200 C310 207 360 194 400 196 V260 H0 Z" fill="#8fa16e" />
    <path d="M196 260 C200 228 214 204 236 186" fill="none" stroke="#e8e0c6" stroke-width="10" stroke-linecap="round" opacity="0.8" />
    <g>
      <path d="M86 150 v18" stroke="#6b5d4c" stroke-width="2" /><circle cx="86" cy="140" r="14" fill="#7d8f5c" />
      <path d="M112 156 v14" stroke="#6b5d4c" stroke-width="2" /><circle cx="112" cy="148" r="10" fill="#6f8251" />
      <path d="M330 140 v16" stroke="#6b5d4c" stroke-width="2" /><circle cx="330" cy="130" r="12" fill="#7d8f5c" />
    </g>
    <g fill="#f4e6b8" opacity="0.9">
      <circle cx="60" cy="226" r="2" /><circle cx="140" cy="236" r="2" /><circle cx="290" cy="228" r="2" /><circle cx="350" cy="238" r="2" />
    </g>
  </svg>
);

/** Snowy mountains above a pine forest and a pale lake. */
const Mountains = () => (
  <svg class="b-scene" data-scene="mountains" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="mt-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#e8edf0" stop-opacity="0" />
        <stop offset="0.5" stop-color="#e3e9ec" />
        <stop offset="1" stop-color="#eee9df" />
      </linearGradient>
      <linearGradient id="mt-lake" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#c8d3d6" />
        <stop offset="1" stop-color="#f3eee5" />
      </linearGradient>
    </defs>
    <rect width="400" height="260" fill="url(#mt-sky)" />
    <path d="M20 160 L110 66 L150 104 L210 46 L290 130 L330 96 L400 150 V170 H20 Z" fill="#9aa6ae" />
    <path d="M110 66 L128 86 L118 84 L108 92 L98 80 Z M210 46 L234 72 L220 68 L208 78 L196 64 Z M330 96 L344 110 L334 108 L324 114 Z" fill="#f8f7f2" />
    <path d="M0 150 C60 140 120 146 200 150 C280 154 340 142 400 146 V172 H0 Z" fill="#7f8e84" />
    <g fill="#5f7266">
      <path d="M30 172 l10 -26 l10 26 Z" /><path d="M52 172 l8 -20 l8 20 Z" /><path d="M300 172 l10 -28 l10 28 Z" /><path d="M324 172 l8 -18 l8 18 Z" /><path d="M350 172 l9 -24 l9 24 Z" />
    </g>
    <rect y="172" width="400" height="88" fill="url(#mt-lake)" />
  </svg>
);

const BY_NAME = { sunrise: Lake, sunset: Sunset, night: Night, meadow: Meadow, mountains: Mountains };
/** The scene you rolled last (the sunrise lake at first). */
export function Scene() {
  const name = useStore(sceneChoice);
  const Pic = BY_NAME[name] || Lake;
  return <Pic />;
}
