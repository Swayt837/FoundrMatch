/**
 * CoFound Premium Design System
 * "Glass / Luxe" - Dark cinematic Apple-like aesthetic
 */

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
  
  shadow: {
    subtle: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 4,
      elevation: 2,
    },
    medium: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 12,
      elevation: 4,
    },
    strong: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.35,
      shadowRadius: 24,
      elevation: 8,
    },
    goldGlow: {
      shadowColor: '#D4AF37',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.3,
      shadowRadius: 16,
      elevation: 6,
    },
  },
};

export type Theme = typeof theme;
