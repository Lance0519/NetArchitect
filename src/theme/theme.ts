/**
 * NetArchitect theme composition.
 *
 * Combines colors, typography, spacing, and other design tokens into
 * a single theme object. This is the single source of truth for all
 * design values in the application.
 */

import { lightColors, darkColors, type ColorToken } from './colors';
import { spacing, type SpacingToken } from './spacing';

export interface Theme {
  colors: Record<ColorToken, string>;
  spacing: Record<SpacingToken, string>;
  borderRadius: {
    card: string;
    control: string;
    pill: string;
  };
  fontSize: {
    display: string;
    title: string;
    heading: string;
    subheading: string;
    body: string;
    bodyTight: string;
    label: string;
    caption: string;
  };
  lineHeight: {
    display: string;
    title: string;
    heading: string;
    subheading: string;
    body: string;
    bodyTight: string;
    label: string;
    caption: string;
  };
  maxWidth: {
    read: string;
    form: string;
  };
  shadows: {
    card: string;
    raised: string;
  };
}

export const lightTheme: Theme = {
  colors: lightColors,
  spacing,
  borderRadius: {
    card: '12px',
    control: '10px',
    pill: '999px',
  },
  fontSize: {
    display: '28px',
    title: '22px',
    heading: '17px',
    subheading: '15px',
    body: '15px',
    bodyTight: '15px',
    label: '13px',
    caption: '12px',
  },
  lineHeight: {
    display: '34px',
    title: '28px',
    heading: '24px',
    subheading: '22px',
    body: '22px',
    bodyTight: '20px',
    label: '18px',
    caption: '16px',
  },
  maxWidth: {
    read: '680px',
    form: '560px',
  },
  shadows: {
    card: '0 1px 3px rgba(0, 0, 0, 0.08)',
    raised: '0 4px 12px rgba(0, 0, 0, 0.12)',
  },
};

export const darkTheme: Theme = {
  colors: darkColors,
  spacing,
  borderRadius: {
    card: '12px',
    control: '10px',
    pill: '999px',
  },
  fontSize: {
    display: '28px',
    title: '22px',
    heading: '17px',
    subheading: '15px',
    body: '15px',
    bodyTight: '15px',
    label: '13px',
    caption: '12px',
  },
  lineHeight: {
    display: '34px',
    title: '28px',
    heading: '24px',
    subheading: '22px',
    body: '22px',
    bodyTight: '20px',
    label: '18px',
    caption: '16px',
  },
  maxWidth: {
    read: '680px',
    form: '560px',
  },
  shadows: {
    card: '0 1px 3px rgba(0, 0, 0, 0.3)',
    raised: '0 4px 12px rgba(0, 0, 0, 0.4)',
  },
};
