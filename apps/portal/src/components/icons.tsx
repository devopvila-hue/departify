import type { SVGProps } from "react";
import type { ReactElement } from "react";

/**
 * Icon set — Sprint 59.
 *
 * Restrained, premium line icons sized to the sidebar's 16px grid.
 * No emoji, no decorative fills. Pure SVG so the bundle stays small
 * and the look stays consistent with the rest of the design language.
 */

export type IconProps = Omit<SVGProps<SVGSVGElement>, "viewBox" | "fill"> & {
  size?: number;
};

function IconBase({ size = 16, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ChatIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M4 5h16v11H8l-4 4z" />
    </IconBase>
  );
}

export function TasksIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M9 5l2 2 4-4" />
      <path d="M9 12l2 2 4-4" />
      <path d="M9 19l2 2 4-4" />
    </IconBase>
  );
}

export function DepartmentsIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M4 21V8l8-5 8 5v13" />
      <path d="M9 21v-7h6v7" />
    </IconBase>
  );
}

export function ConnectionsIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M9 7H5a3 3 0 000 6h4" />
      <path d="M15 17h4a3 3 0 000-6h-4" />
      <path d="M8 12h8" />
    </IconBase>
  );
}

export function ApprovalsIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12l3 3 5-6" />
    </IconBase>
  );
}

export function ResultsIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M5 19V9" />
      <path d="M12 19V5" />
      <path d="M19 19v-7" />
      <path d="M4 19h16" />
    </IconBase>
  );
}

export function CompanyIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M4 21h16" />
      <path d="M5 21V7l7-4 7 4v14" />
      <path d="M9 11h2M9 15h2M9 19h2" />
      <path d="M13 11h2M13 15h2M13 19h2" />
    </IconBase>
  );
}

export function SettingsIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 01-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 01-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 012.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 012.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </IconBase>
  );
}

export function SparkIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M12 3v6" />
      <path d="M12 15v6" />
      <path d="M3 12h6" />
      <path d="M15 12h6" />
      <path d="M5.6 5.6l4.2 4.2" />
      <path d="M14.2 14.2l4.2 4.2" />
      <path d="M18.4 5.6l-4.2 4.2" />
      <path d="M9.8 14.2l-4.2 4.2" />
    </IconBase>
  );
}

export function MenuIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </IconBase>
  );
}

export function CloseIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M5 5l14 14" />
      <path d="M19 5L5 19" />
    </IconBase>
  );
}

export function SendIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M4 12l16-8-6 16-2-7z" />
    </IconBase>
  );
}

export function PlusIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </IconBase>
  );
}

export function CheckIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M5 12l4 4 10-10" />
    </IconBase>
  );
}

export function ApprovalIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M5 12l4 4 10-10" />
    </IconBase>
  );
}

export function PlugIcon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M9 7H5a3 3 0 000 6h4" />
      <path d="M15 17h4a3 3 0 000-6h-4" />
      <path d="M8 12h8" />
    </IconBase>
  );
}
