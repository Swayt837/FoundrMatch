/**
 * CoFoundr Premium Design System
 * "Glass / Luxe" - Dark cinematic Apple-like aesthetic
 */
import { Platform, ViewStyle } from 'react-native';

interface ElevationSpec {
  /** Vertical offset in px. */
  y: number;
  /** Native shadowRadius; the web blur radius is twice this, which matches visually. */
  radius: number;
  opacity: number;
  /** Android elevation. */
  android: number;
  /** Shadow colour as "r, g, b". Defaults to black. */
  rgb?: string;
}

/**
 * Build a platform-appropriate shadow.
 *
 * Web gets `boxShadow` — the `shadow*` props are deprecated there and produced a
 * console warning on every screen — while native keeps the original
 * `shadow*`/`elevation` values so the rendering is unchanged.
 */
function elevation({ y, radius, opacity, android, rgb = '0, 0, 0' }: ElevationSpec): ViewStyle {
  if (Platform.OS === 'web') {
    return { boxShadow: `0px ${y}px ${radius * 2}px rgba(${rgb}, ${opacity})` };
  }
  return {
    shadowColor: `rgb(${rgb})`,
    shadowOffset: { width: 0, height: y },
    shadowOpacity: opacity,
    shadowRadius: radius,
    elevation: android,
  };
}

export const theme = {
  colors: {
    // Surfaces
    surface: '#09090B',
    surfaceSecondary: '#18181B',
    surfaceTertiary: '#27272A',
    surfaceInverse: '#FAFAFA',
    
    // Text
    text: '#FAFAFA',
    textSecondary: '#A1A1AA',
    textTertiary: '#D4D4D8',
    textInverse: '#09090B',
    
    // Brand - Antique Gold
    brand: '#D4AF37',
    brandOn: '#09090B',
    brandSecondary: '#382C1E',
    brandSecondaryOn: '#D4AF37',
    brandTertiary: '#261F17',
    brandTertiaryOn: '#FDE5C5',
    
    // Semantic
    success: '#2D4C3B',
    successOn: '#86EFAC',
    warning: '#5A3A1D',
    warningOn: '#FDE047',
    error: '#5C1D24',
    errorOn: '#FDA4AF',
    info: '#1E3146',
    infoOn: '#93C5FD',
    
    // Borders
    border: '#27272A',
    borderStrong: '#3F3F46',
    divider: '#18181B',
    
    // Overlays
    overlay: 'rgba(9, 9, 11, 0.7)',
    scrim: 'rgba(9, 9, 11, 0.85)',
  },
  
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
    xxxl: 48,
    xxxxl: 64,
  },
  
  radius: {
    sm: 6,
    md: 12,
    lg: 20,
    xl: 28,
    pill: 999,
  },
  
  typography: {
    displayLarge: {
      fontSize: 40,
      lineHeight: 44,
      fontWeight: '500' as const,
      letterSpacing: -0.8,
    },
    display: {
      fontSize: 32,
      lineHeight: 36,
      fontWeight: '500' as const,
      letterSpacing: -0.6,
    },
    title1: {
      fontSize: 28,
      lineHeight: 32,
      fontWeight: '500' as const,
      letterSpacing: -0.4,
    },
    title2: {
      fontSize: 24,
      lineHeight: 28,
      fontWeight: '500' as const,
      letterSpacing: -0.3,
    },
    title3: {
      fontSize: 20,
      lineHeight: 24,
      fontWeight: '500' as const,
      letterSpacing: -0.2,
    },
    headline: {
      fontSize: 16,
      lineHeight: 20,
      fontWeight: '500' as const,
      letterSpacing: -0.1,
    },
    body: {
      fontSize: 16,
      lineHeight: 22,
      fontWeight: '400' as const,
      letterSpacing: 0,
    },
    callout: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '400' as const,
    },
    subhead: {
      fontSize: 14,
      lineHeight: 18,
      fontWeight: '400' as const,
    },
    footnote: {
      fontSize: 13,
      lineHeight: 16,
      fontWeight: '400' as const,
    },
    caption: {
      fontSize: 12,
      lineHeight: 14,
      fontWeight: '400' as const,
      letterSpacing: 0.1,
    },
    micro: {
      fontSize: 11,
      lineHeight: 13,
      fontWeight: '500' as const,
      letterSpacing: 0.2,
      textTransform: 'uppercase' as const,
    },
  },
  
  /**
   * Elevation helpers.
   *
   * React Native 0.75+ and react-native-web deprecated the `shadow*` style props
   * in favour of `boxShadow`, which was the source of the console warning present
   * since iteration 4. Native platforms keep using `shadow*`/`elevation`, so the
   * helpers are platform-split rather than swapped outright.
   */
  shadow: {
    subtle: elevation({ y: 2, radius: 4, opacity: 0.15, android: 2 }),
    medium: elevation({ y: 4, radius: 12, opacity: 0.25, android: 4 }),
    strong: elevation({ y: 8, radius: 24, opacity: 0.35, android: 8 }),
    // Antique gold #D4AF37
    goldGlow: elevation({ y: 0, radius: 16, opacity: 0.3, android: 6, rgb: '212, 175, 55' }),
  },
};

export type Theme = typeof theme;
