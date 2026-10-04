import React, { useState } from 'react';

export const CAMPAIGN = {
  programme: 'KWARA X10',
  strapline: 'People · Places · Possibilities',
  tagline: 'Listen Better. Know the Communities. Act on Evidence.',
  headline: 'Make Kwara X10 Better',
  subhead: 'Community Engagement and Intelligence Network',
  candidate: 'Kwara X10',
  candidateNote: 'Vision for Kwara State',
  party: 'PDP Kwara State',
  period: 'October 2026',
  motto: 'Stronger People · Brighter Kwara',
};

/**
 * The KWARA X10 crest. Drawn rather than loaded so the app always has a mark,
 * even before the official artwork is dropped into /public/brand/.
 * If public/brand/logo.svg exists it is used in preference to this.
 */
export function Crest({ size = 44, withText = false }) {
  const [useFile, setUseFile] = useState(true);

  if (useFile) {
    return (
      <img
        src="/brand/pdp-logo.png" alt="Peoples Democratic Party — Kwara X10" height={size}
        className="brand-logo-circle"
        style={{ height: size, width: size, display: 'block' }}
        onError={() => setUseFile(false)}
      />
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="KWARA X10">
      <defs>
        <linearGradient id="crestGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffb3b7" />
          <stop offset="45%" stopColor="#e31b23" />
          <stop offset="100%" stopColor="#b5121b" />
        </linearGradient>
        <linearGradient id="crestGreen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0E4A2B" />
          <stop offset="100%" stopColor="#062E1A" />
        </linearGradient>
      </defs>

      {/* shield */}
      <path d="M50 4 L90 18 V50 C90 72 72 88 50 96 C28 88 10 72 10 50 V18 Z"
            fill="url(#crestGreen)" stroke="url(#crestGold)" strokeWidth="3" />
      <path d="M50 11 L83 22 V50 C83 68 68 82 50 89 C32 82 17 68 17 50 V22 Z"
            fill="none" stroke="url(#crestGold)" strokeWidth="1" opacity=".55" />

      {/* KWARA */}
      <text x="50" y="45" textAnchor="middle" fill="#ffffff"
            style={{ font: '700 14px Georgia, serif', letterSpacing: '1px' }}>KWARA</text>
      {/* 10X */}
      <text x="50" y="68" textAnchor="middle" fill="url(#crestGold)"
            style={{ font: '800 23px Georgia, serif', letterSpacing: '0.5px' }}>X10</text>
      <rect x="30" y="50" width="40" height="1.4" fill="url(#crestGold)" opacity=".8" />
    </svg>
  );
}

/**
 * Candidate portrait. The supplied transparent-style portrait is stored in
 * the brand folder and used on the login hero.
 * and it appears automatically; until then a labelled placeholder is shown so
 * no layout depends on the file being present.
 */
export function CandidatePortrait({ className = '' }) { return <img src="/brand/kwara-map.png" alt="Map of Kwara State" className={'portrait kwara-map ' + className} />; }
/** Gold rule with a centred diamond, echoing the cover's dividers. */
export function GoldRule({ width = 90 }) {
  return (
    <div className="gold-rule" style={{ width }}>
      <span className="gold-rule-line" />
      <span className="gold-rule-diamond" />
      <span className="gold-rule-line" />
    </div>
  );
}
