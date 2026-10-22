/** @type {import('tailwindcss').Config} */
// Design tokens. Colours are CSS variables (src/index.css) so light and dark are defined once;
// use the semantic names (bg, surface, fg, muted, accent, …), never raw palette colours.
const v = name => `rgb(var(--${name}) / <alpha-value>)`

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        'surface-2': v('surface-2'),
        'surface-3': v('surface-3'),
        border: v('border'),
        'border-strong': v('border-strong'),
        fg: v('fg'),
        muted: v('muted'),
        accent: v('accent'),
        'accent-hover': v('accent-hover'),
        'accent-fg': v('accent-fg'),
        'accent-text': v('accent-text'),
        'accent-subtle': v('accent-subtle'),
        focus: v('focus'),
        danger: v('danger'),
        'danger-bg': v('danger-bg'),
        warning: v('warning'),
        'warning-bg': v('warning-bg'),
        success: v('success'),
        'success-bg': v('success-bg'),
      },
      fontFamily: { sans: ['"Inter Variable"', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'] },
      fontSize: { base: ['15px', '24px'] },
      borderRadius: { DEFAULT: '6px', sm: '4px', md: '6px', lg: '10px' },
      keyframes: {
        indeterminate: { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(300%)' } },
        scan: { '0%': { transform: 'translateY(-100%)' }, '100%': { transform: 'translateY(100%)' } },
      },
      animation: { indeterminate: 'indeterminate 1.4s ease-in-out infinite', scan: 'scan 2.2s ease-in-out infinite' },
      boxShadow: {
        xs: '0 1px 2px 0 rgb(0 0 0 / 0.04)',
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.08)',
        md: '0 4px 12px -2px rgb(0 0 0 / 0.12)',
        lg: '0 16px 40px -8px rgb(0 0 0 / 0.25)',
      },
    },
  },
  plugins: [],
}
