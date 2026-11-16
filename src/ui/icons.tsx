const P: Record<string, string> = {
  play: "M7 4.5v15l12-7.5z",
  step: "M6 5v14M10 5.5v13l10-6.5z",
  stop: "M7 7h10v10H7z",
  x: "M6 6l12 12M18 6L6 18",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  indent: "M4 6h16M10 12h10M4 18h16M4 9.5l3 2.5-3 2.5",
  outdent: "M4 6h16M10 12h10M4 18h16M7 9.5L4 12l3 2.5",
  chevron: "M6 9l6 6 6-6",
  copy: "M9 9h10v10H9zM5 15V5h10",
  plus: "M12 5v14M5 12h14",
  file: "M7 3h7l5 5v13H7zM14 3v5h5",
  trash: "M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3",
  book: "M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3zM5 17a3 3 0 013-3h11",
  blocks: "M4 5h9v5H4zM8 14h12v5H8z",
  code: "M9 8l-4 4 4 4M15 8l4 4-4 4",
  terminal: "M5 7l4 4-4 4M12 16h7",
};

export function Icon({ name, size = 16, fill = false, className }: { name: keyof typeof P | string; size?: number; fill?: boolean; className?: string }) {
  const filled = fill || name === "play" || name === "stop";
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={filled ? 0 : 1.9} strokeLinecap="round" strokeLinejoin="round">
      {name === "step" ? (
        <>
          <path d="M6 5v14" fill="none" stroke="currentColor" strokeWidth="2.2" />
          <path d="M10 5.5v13l10-6.5z" fill="currentColor" stroke="none" />
        </>
      ) : (
        <path d={P[name]} />
      )}
    </svg>
  );
}

export function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <rect width="22" height="22" rx="6" fill="#5b57d1" />
      <rect x="5" y="5.5" width="8" height="4" rx="1.3" fill="#fff" />
      <rect x="8" y="12.5" width="9" height="4" rx="1.3" fill="#fff" opacity=".75" />
    </svg>
  );
}
