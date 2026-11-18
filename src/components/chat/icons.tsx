const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export const MenuIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);
export const PlusIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const SendIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const StopIcon = () => (
  <svg {...base} aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
  </svg>
);
export const PencilIcon = () => (
  <svg {...base} width={16} height={16} aria-hidden="true">
    <path d="M4 20h4L19 9l-4-4L4 16v4z" />
  </svg>
);
export const TrashIcon = () => (
  <svg {...base} width={16} height={16} aria-hidden="true">
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
);
export const CloseIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
