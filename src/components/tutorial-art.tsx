/**
 * The animated pictures of the first-run tutorial (tutorial-dialog.tsx). Plain SVG with CSS
 * keyframes (`.tut-*` in src/styles.css): small, no video file, the theme's own colours, and the
 * same on the oldest engines this site runs on. Every element is drawn in its finished place, and
 * the keyframes only bring it in, so with reduced motion (or no animation at all) each picture
 * shows its last frame.
 *
 * The guide is an original little owl. Book content stays English (a word and its meaning); the
 * few labels come in from the caller.
 */
import type { ReactNode } from "react";

function Owl({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} data-tut-owl>
      <g className="tut-bob">
        <path d="M-22 6 Q-30 -26 0 -30 Q30 -26 22 6 Q20 30 0 32 Q-20 30 -22 6Z" className="fill-accent" />
        <path d="M-13 8 Q0 -2 13 8 Q12 26 0 27 Q-12 26 -13 8Z" className="fill-paper" opacity="0.9" />
        <path d="M-18 -26 L-12 -38 L-6 -27Z M18 -26 L12 -38 L6 -27Z" className="fill-accent" />
        <circle cx="-9" cy="-11" r="8.5" className="fill-card" />
        <circle cx="9" cy="-11" r="8.5" className="fill-card" />
        <circle cx="-8" cy="-10" r="3.6" className="fill-ink" />
        <circle cx="10" cy="-10" r="3.6" className="fill-ink" />
        <g className="tut-blink">
          <rect x="-18" y="-20" width="18" height="18" rx="8" className="fill-accent" />
          <rect x="0" y="-20" width="18" height="18" rx="8" className="fill-accent" />
        </g>
        <path d="M-3 -2 L3 -2 L0 4Z" className="fill-amber-500" />
        <path d="M22 -2 Q36 -10 34 6 Q28 10 22 8Z" className="fill-accent tut-wave" />
      </g>
    </g>
  );
}

function Lines({ x, y, widths, gap = 9 }: { x: number; y: number; widths: number[]; gap?: number }) {
  return (
    <>
      {widths.map((w, i) => (
        <rect key={i} x={x} y={y + i * gap} width={w} height="3.5" rx="1.75" className="fill-ink" opacity="0.18" />
      ))}
    </>
  );
}

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 320 200" className="tut-art h-auto w-full" role="img" aria-label={label}>
      {children}
    </svg>
  );
}

/** 1. A book and its own word list: the dictionary slides in beside the book, a word lights up. */
export function ArtWordList({ label, tag }: { label: string; tag: string }) {
  return (
    <Frame label={label}>
      <ellipse cx="150" cy="168" rx="120" ry="10" className="fill-ink" opacity="0.06" />
      {/* The open book. */}
      <path d="M40 60 Q85 48 128 60 L128 158 Q85 146 40 158Z" className="fill-card stroke-line" strokeWidth="2" />
      <path d="M128 60 Q171 48 216 60 L216 158 Q171 146 128 158Z" className="fill-card stroke-line" strokeWidth="2" />
      <Lines x={52} y={72} widths={[60, 52, 64, 40, 58, 50, 62, 44]} />
      <Lines x={140} y={72} widths={[58, 64, 30, 60, 52, 62, 48, 56]} />
      <rect x="168" y="86.5" width="34" height="9" rx="3" className="fill-accent tut-pulse" opacity="0.35" />
      {/* Its own word list, sliding in. */}
      <g className="tut-slide">
        <rect x="232" y="64" width="58" height="80" rx="6" className="fill-accent" />
        <rect x="238" y="64" width="4" height="80" className="fill-ink" opacity="0.15" />
        <text x="263" y="110" textAnchor="middle" className="fill-paper" style={{ font: "700 26px Literata, Georgia, serif" }}>
          Aa
        </text>
        <rect x="226" y="150" width="70" height="20" rx="10" className="fill-paper stroke-accent" strokeWidth="1.5" />
        <text x="261" y="164" textAnchor="middle" className="fill-accent" style={{ font: "600 10px var(--font-sans)" }}>
          {tag}
        </text>
      </g>
      {/* The meaning, for that word. */}
      <g className="tut-pop">
        <path d="M150 22 h96 a8 8 0 0 1 8 8 v22 a8 8 0 0 1 -8 8 h-60 l-8 10 l-2 -10 h-26 a8 8 0 0 1 -8 -8 v-22 a8 8 0 0 1 8 -8z" className="fill-card stroke-accent" strokeWidth="1.5" />
        <text x="158" y="38" className="fill-ink" style={{ font: "700 12px Literata, Georgia, serif" }}>
          peered
        </text>
        <text x="158" y="52" className="fill-ink" opacity="0.7" style={{ font: "500 9.5px var(--font-sans)" }}>
          looked closely
        </text>
      </g>
      <Owl x={34} y={150} />
    </Frame>
  );
}

const COVERS = ["fill-accent", "fill-amber-600", "fill-sky-700", "fill-rose-700"];

/** 2. Discover: a finger taps the plus on a cover, and it turns into a tick. */
export function ArtDiscover({ label, tag }: { label: string; tag: string }) {
  return (
    <Frame label={label}>
      <rect x="96" y="10" width="128" height="182" rx="18" className="fill-card stroke-line" strokeWidth="2" />
      <rect x="140" y="17" width="40" height="5" rx="2.5" className="fill-line" />
      {[0, 1, 2, 3].map((i) => {
        const x = 110 + (i % 2) * 52;
        const y = 32 + Math.floor(i / 2) * 76;
        return (
          <g key={i}>
            <rect x={x} y={y} width="46" height="66" rx="4" className={COVERS[i]} />
            <rect x={x + 6} y={y + 26} width="34" height="3" rx="1.5" className="fill-paper" opacity="0.7" />
            <rect x={x + 10} y={y + 33} width="26" height="3" rx="1.5" className="fill-paper" opacity="0.5" />
          </g>
        );
      })}
      {/* The plus on the first cover, then the tick. */}
      <g className="tut-plus">
        <circle cx="148" cy="88" r="9" className="fill-card" />
        <path d="M148 83 v10 M143 88 h10" className="stroke-ink" strokeWidth="2" strokeLinecap="round" />
      </g>
      <g className="tut-check">
        <circle cx="148" cy="88" r="9" className="fill-accent" />
        <path d="M143.5 88 l3 3 l6 -6" className="stroke-paper" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g className="tut-tag">
        <rect x="232" y="76" width="74" height="22" rx="11" className="fill-accent" />
        <text x="269" y="91" textAnchor="middle" className="fill-paper" style={{ font: "600 10px var(--font-sans)" }}>
          {tag}
        </text>
      </g>
      {/* The finger. */}
      <g className="tut-finger">
        <path d="M150 100 q0 -8 6 -8 q6 0 6 8 v16 q8 -2 10 4 q6 -1 8 5 q6 0 6 8 v12 q0 14 -16 18 h-12 q-12 0 -18 -12 l-10 -18 q-2 -6 4 -8 q5 -1 9 5 z" className="fill-amber-100 stroke-ink" strokeWidth="1.6" strokeLinejoin="round" />
      </g>
      <Owl x={50} y={150} />
    </Frame>
  );
}

/** 3. An EPUB file flies into the book, a ring fills, and the pair is matched. */
export function ArtEpub({ label, tag }: { label: string; tag: string }) {
  return (
    <Frame label={label}>
      <ellipse cx="160" cy="170" rx="110" ry="9" className="fill-ink" opacity="0.06" />
      <rect x="70" y="44" width="78" height="114" rx="6" className="fill-sky-700" />
      <rect x="76" y="44" width="4" height="114" className="fill-ink" opacity="0.15" />
      <rect x="86" y="86" width="50" height="4" rx="2" className="fill-paper" opacity="0.7" />
      <rect x="92" y="96" width="38" height="4" rx="2" className="fill-paper" opacity="0.5" />
      <g className="tut-fly">
        <path d="M222 40 h40 l14 14 v52 a4 4 0 0 1 -4 4 h-50 a4 4 0 0 1 -4 -4 v-62 a4 4 0 0 1 4 -4z" className="fill-card stroke-ink" strokeWidth="1.8" />
        <path d="M262 40 v14 h14" className="fill-none stroke-ink" strokeWidth="1.8" />
        <rect x="226" y="76" width="44" height="16" rx="3" className="fill-accent" />
        <text x="248" y="88" textAnchor="middle" className="fill-paper" style={{ font: "700 10px var(--font-sans)" }}>
          EPUB
        </text>
      </g>
      <g transform="translate(109 101)">
        <circle r="22" className="fill-card" opacity="0.92" />
        <circle r="17" className="fill-none stroke-line" strokeWidth="4" />
        <circle r="17" className="fill-none stroke-accent tut-ring" strokeWidth="4" strokeLinecap="round" strokeDasharray="107" transform="rotate(-90)" />
        <path d="M-7 0 l5 5 l9 -10" className="fill-none stroke-accent tut-tick" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g className="tut-tag">
        <rect x="70" y="164" width="78" height="22" rx="11" className="fill-accent" />
        <text x="109" y="179" textAnchor="middle" className="fill-paper" style={{ font: "600 10px var(--font-sans)" }}>
          {tag}
        </text>
      </g>
      <Owl x={270} y={150} />
    </Frame>
  );
}

/** 4. A finger taps a word, and the word card slides up from the bottom. */
export function ArtTapWord({ label }: { label: string }) {
  return (
    <Frame label={label}>
      <rect x="70" y="8" width="180" height="186" rx="18" className="fill-card stroke-line" strokeWidth="2" />
      <Lines x={86} y={30} widths={[148, 136, 148, 120, 140]} gap={11} />
      <rect x="118" y="51" width="40" height="11" rx="3" className="fill-accent tut-pulse" opacity="0.3" />
      <rect x="118" y="60" width="40" height="2" className="fill-accent" />
      <g className="tut-finger2">
        <path d="M134 66 q0 -7 5 -7 q5 0 5 7 v13 q7 -2 9 3 q5 -1 7 4 q5 0 5 7 v10 q0 12 -14 15 h-10 q-10 0 -15 -10 l-9 -15 q-2 -5 3 -7 q4 -1 8 4 z" className="fill-amber-100 stroke-ink" strokeWidth="1.5" strokeLinejoin="round" />
      </g>
      <g className="tut-sheet">
        <path d="M72 120 q0 -14 14 -14 h148 q14 0 14 14 v56 q0 16 -16 16 h-144 q-16 0 -16 -16z" className="fill-paper stroke-line" strokeWidth="1.5" />
        <rect x="146" y="112" width="28" height="4" rx="2" className="fill-line" />
        <text x="88" y="140" className="fill-ink" style={{ font: "700 17px Literata, Georgia, serif" }}>
          peered
        </text>
        <text x="152" y="140" className="fill-ink" opacity="0.55" style={{ font: "500 10px var(--font-sans)" }}>
          /pɪəd/
        </text>
        <text x="88" y="160" className="fill-ink" style={{ font: "500 10.5px var(--font-sans)" }}>
          Looked closely, as if it was
        </text>
        <text x="88" y="174" className="fill-ink" style={{ font: "500 10.5px var(--font-sans)" }}>
          hard to see.
        </text>
        <path d="M226 128 a5 5 0 0 1 10 0 q0 6 -5 10 q-5 -4 -5 -10z" className="fill-none stroke-accent" strokeWidth="1.6" />
      </g>
      <Owl x={34} y={60} />
    </Frame>
  );
}

/** Feedback tip, 1: on the word card, the ? opens the choices and "too difficult" is sent. */
export function ArtFeedbackHard({ label, tooHard, addMine, thanks }: { label: string; tooHard: string; addMine: string; thanks: string }) {
  return (
    <Frame label={label}>
      <rect x="64" y="8" width="192" height="164" rx="16" className="fill-card stroke-line" strokeWidth="2" />
      <text x="80" y="36" className="fill-ink" style={{ font: "700 17px Literata, Georgia, serif" }}>
        peered
      </text>
      <Lines x={80} y={48} widths={[150, 118]} gap={10} />
      <rect x="80" y="76" width="160" height="1.5" className="fill-line" />
      <circle cx="232" cy="92" r="10" className="fill-paper stroke-accent tut-pulse" strokeWidth="2" />
      <text x="232" y="96.5" textAnchor="middle" className="fill-accent" style={{ font: "700 12px var(--font-sans)" }}>
        ?
      </text>
      <g className="tut-pop">
        <rect x="76" y="108" width="168" height="56" rx="10" className="fill-paper stroke-line" strokeWidth="1.5" />
        <rect x="86" y="116" width="72" height="20" rx="6" className="fill-card stroke-line" strokeWidth="1.2" />
        <text x="122" y="130" textAnchor="middle" className="fill-ink" style={{ font: "600 9.5px var(--font-sans)" }}>
          {tooHard}
        </text>
        <rect x="86" y="140" width="148" height="18" rx="6" className="fill-none stroke-accent" strokeWidth="1.2" strokeDasharray="3 3" />
        <text x="160" y="152.5" textAnchor="middle" className="fill-accent" style={{ font: "600 9px var(--font-sans)" }}>
          {addMine}
        </text>
      </g>
      <g className="tut-late">
        <rect x="86" y="116" width="72" height="20" rx="6" className="fill-accent" />
        <text x="122" y="130" textAnchor="middle" className="fill-paper" style={{ font: "600 9.5px var(--font-sans)" }}>
          {tooHard}
        </text>
      </g>
      <g className="tut-finger3">
        <path d="M118 132 q0 -7 5 -7 q5 0 5 7 v13 q7 -2 9 3 q5 -1 7 4 q5 0 5 7 v10 q0 12 -14 15 h-10 q-10 0 -15 -10 l-9 -15 q-2 -5 3 -7 q4 -1 8 4 z" className="fill-amber-100 stroke-ink" strokeWidth="1.5" strokeLinejoin="round" />
      </g>
      <g className="tut-thanks">
        <rect x="186" y="176" width="110" height="20" rx="10" className="fill-emerald-600" />
        <text x="241" y="190" textAnchor="middle" className="fill-white" style={{ font: "600 9px var(--font-sans)" }}>
          {thanks}
        </text>
      </g>
      <Owl x={34} y={150} />
    </Frame>
  );
}

/**
 * Feedback tip, 2: an unmarked word is tapped; on its card the ? button offers "meaning missing",
 * which is pressed, with "add my meaning" under it, as on the real card (word-feedback.tsx).
 */
export function ArtFeedbackMissing({ label, missing, addMine, thanks }: { label: string; missing: string; addMine: string; thanks: string }) {
  return (
    <Frame label={label}>
      <rect x="70" y="8" width="180" height="186" rx="18" className="fill-card stroke-line" strokeWidth="2" />
      <Lines x={86} y={26} widths={[148, 136, 148, 120]} gap={11} />
      {/* The word is not underlined: nobody marked it. */}
      <rect x="128" y="47" width="44" height="11" rx="3" className="fill-none stroke-accent tut-pulse" strokeWidth="1.2" strokeDasharray="3 2" />
      <g className="tut-finger2">
        <path d="M144 62 q0 -7 5 -7 q5 0 5 7 v13 q7 -2 9 3 q5 -1 7 4 q5 0 5 7 v10 q0 12 -14 15 h-10 q-10 0 -15 -10 l-9 -15 q-2 -5 3 -7 q4 -1 8 4 z" className="fill-amber-100 stroke-ink" strokeWidth="1.5" strokeLinejoin="round" />
      </g>
      <g className="tut-sheet">
        <path d="M72 106 q0 -14 14 -14 h148 q14 0 14 14 v72 q0 16 -16 16 h-144 q-16 0 -16 -16z" className="fill-paper stroke-line" strokeWidth="1.5" />
        <rect x="146" y="98" width="28" height="4" rx="2" className="fill-line" />
        <text x="88" y="122" className="fill-ink" style={{ font: "700 16px Literata, Georgia, serif" }}>
          harbor
        </text>
        <circle cx="224" cy="117" r="8" className="fill-card stroke-accent" strokeWidth="1.6" />
        <text x="224" y="121" textAnchor="middle" className="fill-accent" style={{ font: "700 10px var(--font-sans)" }}>
          ?
        </text>
        <rect x="86" y="134" width="86" height="20" rx="6" className="fill-card stroke-line" strokeWidth="1.2" />
        <text x="129" y="148" textAnchor="middle" className="fill-ink" style={{ font: "600 9.5px var(--font-sans)" }}>
          {missing}
        </text>
        <rect x="86" y="160" width="148" height="18" rx="6" className="fill-none stroke-accent" strokeWidth="1.2" strokeDasharray="3 3" />
        <text x="160" y="172.5" textAnchor="middle" className="fill-accent" style={{ font: "600 9px var(--font-sans)" }}>
          {addMine}
        </text>
      </g>
      <g className="tut-late">
        <rect x="86" y="134" width="86" height="20" rx="6" className="fill-accent" />
        <text x="129" y="148" textAnchor="middle" className="fill-paper" style={{ font: "600 9.5px var(--font-sans)" }}>
          {missing}
        </text>
      </g>
      <g className="tut-thanks">
        <rect x="186" y="176" width="110" height="20" rx="10" className="fill-emerald-600" />
        <text x="241" y="190" textAnchor="middle" className="fill-white" style={{ font: "600 9px var(--font-sans)" }}>
          {thanks}
        </text>
      </g>
      <Owl x={286} y={150} />
    </Frame>
  );
}
