/**
 * The animated pictures of the first-run tutorial and the reading tip (design system TutorialDialog,
 * ReadingTip): the brand's own shapes (a drawn book, lines of text, the highlighter, the add-to-shelf
 * ring and check, a word card), no mascot. Plain SVG with CSS keyframes (`.art-*` in styles.css),
 * each picture looping every 4.8s. Every element is drawn in its finished place and the keyframes
 * only bring it in, so with reduced motion, on e-ink or with no animation at all each picture shows
 * its last frame. Book content stays English; the few labels come in from the caller.
 */
import type { ReactNode } from "react";

/** The drawn book's own colours (cover-board / cover-band / cover-ink); never a real cover, the same in every theme. */
const BOARD = "#ebe5d8";
const BAND = "#1e4a3a";
const COVER_INK = "#1b1a17";

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 320 200" className="tut-art art h-full w-full" role="img" aria-label={label}>
      {children}
    </svg>
  );
}

/** A drawn book: board, a fine frame, two lines of title and a band with an optional name. */
function Book({ x, y, w, h, name }: { x: number; y: number; w: number; h: number; name?: string }) {
  const band = 14;
  return (
    <g className="art-shadow">
      <rect x={x} y={y} width={w} height={h} rx="3" fill={BOARD} />
      <rect x={x + 4} y={y + 4} width={w - 8} height={h - band - 8} rx="1" fill="none" stroke={COVER_INK} opacity="0.35" />
      <rect x={x} y={y + h - band} width={w} height={band} fill={BAND} />
      {name ? (
        <text x={x + w / 2} y={y + h - band / 2 + 2.5} fontSize="6.5" textAnchor="middle" fill={BOARD} className="art-ui">
          {name}
        </text>
      ) : null}
      <rect x={x + 12} y={y + 26} width={w - 24} height="4" rx="2" className="fill-line" />
      <rect x={x + 12} y={y + 34} width={w - 32} height="4" rx="2" className="fill-line" />
    </g>
  );
}

/** A small brand-tint label that rises in at the end of a loop ("Own dictionary", "On your shelf"). */
function Tag({ x, y, w, text }: { x: number; y: number; w: number; text: string }) {
  return (
    <g className="art-tag">
      <rect x={x} y={y} width={w} height="20" rx="4" className="fill-accent-soft" />
      <text x={x + w / 2} y={y + 13.5} fontSize="10" textAnchor="middle" className="art-ui fill-accent">
        {text}
      </text>
    </g>
  );
}

/** A finger: a soft dot that comes in, presses and leaves. */
function Tap({ x, y }: { x: number; y: number }) {
  return (
    <g className="art-tap">
      <circle cx={x} cy={y} r="9" className="fill-ink" opacity="0.18" />
      <circle cx={x} cy={y} r="4.5" className="fill-ink" opacity="0.55" />
    </g>
  );
}

/** The add button: a plus, then a ring that fills, then an outlined check. */
function AddButton({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x - 11} y={y - 11} width="22" height="22" rx="4" className="art-plus fill-accent" />
      <path d={`M${x - 5} ${y}h10M${x} ${y - 5}v10`} className="art-plus stroke-accent-ink" strokeWidth="2" strokeLinecap="round" />
      <circle cx={x} cy={y} r="9" fill="none" className="art-ring stroke-accent" strokeWidth="3" strokeLinecap="round" transform={`rotate(-90 ${x} ${y})`} />
      <g className="art-check">
        <rect x={x - 11} y={y - 11} width="22" height="22" rx="4" className="fill-paper stroke-accent" />
        <path d={`M${x - 5} ${y}l3.5 3.5 6.5 -7`} fill="none" className="stroke-accent" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </g>
  );
}

/** 1. Every book has its own dictionary: a dictionary card slides out of the book. */
export function ArtWordList({ label, tag }: { label: string; tag: string }) {
  return (
    <Frame label={label}>
      <Book x={56} y={50} w={66} h={100} name="WONDER" />
      <g className="art-slide">
        <rect x="140" y="48" width="128" height="92" rx="8" className="art-shadow fill-card" />
        <rect x="152" y="60" width="44" height="9" rx="2" className="fill-mark" />
        <rect x="152" y="76" width="96" height="4" rx="2" className="fill-line" />
        <rect x="152" y="87" width="80" height="4" rx="2" className="fill-line" />
        <rect x="152" y="98" width="88" height="4" rx="2" className="fill-line" />
        <rect x="152" y="109" width="64" height="4" rx="2" className="fill-line" />
        <rect x="200" y="61" width="40" height="7" rx="2" className="fill-ink" opacity="0.75" />
      </g>
      <Tag x={196} y={152} w={70} text={tag} />
    </Frame>
  );
}

/** 2. Discover: a finger taps the plus on a cover, a ring fills, a check, "On your shelf". */
export function ArtDiscover({ label, tag }: { label: string; tag: string }) {
  return (
    <Frame label={label}>
      <Book x={52} y={44} w={60} h={90} />
      <Book x={130} y={44} w={60} h={90} />
      <Book x={208} y={44} w={60} h={90} />
      <AddButton x={178} y={112} />
      <Tap x={178} y={112} />
      <Tag x={124} y={156} w={70} text={tag} />
    </Frame>
  );
}

/** 3. Your own EPUB: the file flies into the book, "Matched". */
export function ArtEpub({ label, tag }: { label: string; tag: string }) {
  return (
    <Frame label={label}>
      <Book x={96} y={46} w={66} h={100} name="FLIPPED" />
      <g className="art-fly">
        <path d="M186 52h40l14 14v62a4 4 0 0 1-4 4h-50a4 4 0 0 1-4-4V56a4 4 0 0 1 4-4z" className="art-shadow fill-card" />
        <path d="M226 52v14h14" className="fill-sheet stroke-line" />
        <text x="211" y="104" fontSize="11" textAnchor="middle" className="art-ui fill-accent">
          EPUB
        </text>
      </g>
      <g className="art-check">
        <rect x="239" y="139" width="22" height="22" rx="4" className="fill-paper stroke-accent" />
        <path d="M245 150l3.5 3.5 6.5 -7" fill="none" className="stroke-accent" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <Tag x={150} y={158} w={58} text={tag} />
    </Frame>
  );
}

/** 4. Tap a word: the finger taps, a pale-green highlighter sweeps over it, the word card pops up. */
export function ArtTapWord({ label }: { label: string }) {
  return (
    <Frame label={label}>
      <rect x="40" y="34" width="240" height="4" rx="2" className="fill-line" />
      <rect x="40" y="48" width="220" height="4" rx="2" className="fill-line" />
      <rect x="128" y="58" width="52" height="14" rx="2" className="art-sweep fill-accent-soft" />
      <rect x="40" y="62" width="84" height="4" rx="2" className="fill-line" />
      <rect x="132" y="62" width="44" height="5" rx="2" className="fill-ink" opacity="0.8" />
      <rect x="186" y="62" width="94" height="4" rx="2" className="fill-line" />
      <rect x="132" y="70" width="44" height="1.5" className="fill-accent" />
      <Tap x={156} y={66} />
      <g className="art-pop2">
        <rect x="104" y="86" width="150" height="80" rx="10" className="art-shadow fill-card stroke-line" />
        <text x="118" y="108" fontSize="15" className="art-read fill-ink">
          harbor
        </text>
        <rect x="118" y="120" width="116" height="4" rx="2" className="fill-line" />
        <rect x="118" y="130" width="96" height="4" rx="2" className="fill-line" />
        <rect x="118" y="144" width="36" height="12" rx="3" className="fill-line" />
        <rect x="160" y="144" width="36" height="12" rx="3" className="fill-line" />
        <rect x="202" y="144" width="36" height="12" rx="3" className="fill-line" />
      </g>
    </Frame>
  );
}

/** Reading tip 1: a meaning still too hard — the card's ? opens, "Too difficult", a line is typed, thanks. */
export function ArtFeedbackHard({ label, tooHard, addMine, thanks }: { label: string; tooHard: string; addMine: string; thanks: string }) {
  return (
    <Frame label={label}>
      <rect x="60" y="26" width="200" height="148" rx="10" className="art-shadow fill-card stroke-line" />
      <text x="76" y="50" fontSize="15" className="art-read fill-ink">
        reluctant
      </text>
      <rect x="76" y="62" width="150" height="4" rx="2" className="fill-line" />
      <rect x="76" y="72" width="120" height="4" rx="2" className="fill-line" />
      <circle cx="236" cy="92" r="9" className="fill-paper stroke-accent" strokeWidth="1.5" />
      <text x="236" y="96" fontSize="11" textAnchor="middle" className="art-ui fill-accent">
        ?
      </text>
      <Tap x={236} y={92} />
      <g className="art-pop">
        <rect x="76" y="104" width="62" height="18" rx="4" className="fill-accent-soft stroke-accent" />
        <text x="107" y="116.5" fontSize="9" textAnchor="middle" className="art-ui fill-accent">
          {tooHard}
        </text>
        <rect x="144" y="104" width="62" height="18" rx="4" className="fill-paper stroke-edge" />
        <text x="175" y="116.5" fontSize="9" textAnchor="middle" className="art-ui fill-muted">
          {addMine}
        </text>
      </g>
      <rect x="76" y="130" width="168" height="22" rx="4" className="fill-paper stroke-edge" />
      <rect x="82" y="139" width="120" height="4" rx="2" className="art-type fill-ink" opacity="0.7" />
      <Tag x={166} y={158} w={70} text={thanks} />
    </Frame>
  );
}

/** Reading tip 2: a hard word with no mark — tap it anyway, "Meaning missing", thanks. */
export function ArtFeedbackMissing({ label, missing, addMine, thanks }: { label: string; missing: string; addMine: string; thanks: string }) {
  return (
    <Frame label={label}>
      <rect x="40" y="34" width="240" height="4" rx="2" className="fill-line" />
      <rect x="40" y="48" width="200" height="4" rx="2" className="fill-line" />
      <rect x="126" y="58" width="56" height="15" rx="3" fill="none" className="stroke-accent" strokeDasharray="3 2" />
      <rect x="40" y="62" width="80" height="4" rx="2" className="fill-line" />
      <rect x="130" y="62" width="48" height="5" rx="2" className="fill-ink" opacity="0.8" />
      <rect x="188" y="62" width="92" height="4" rx="2" className="fill-line" />
      <Tap x={154} y={66} />
      <g className="art-pop2">
        <rect x="70" y="88" width="180" height="84" rx="10" className="art-shadow fill-card stroke-line" />
        <rect x="84" y="100" width="62" height="18" rx="4" className="fill-accent-soft stroke-accent" />
        <text x="115" y="112.5" fontSize="9" textAnchor="middle" className="art-ui fill-accent">
          {missing}
        </text>
        <rect x="152" y="100" width="62" height="18" rx="4" className="fill-paper stroke-edge" />
        <text x="183" y="112.5" fontSize="9" textAnchor="middle" className="art-ui fill-muted">
          {addMine}
        </text>
        <rect x="84" y="126" width="152" height="20" rx="4" className="fill-paper stroke-edge" />
      </g>
      <Tag x={166} y={152} w={70} text={thanks} />
    </Frame>
  );
}
