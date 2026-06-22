/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          base:     '#0A0A0A',  // page background
          sidebar:  '#0F0F0F',
          card:     '#111111',
          inset:    '#1A1A1A',  // input fields, nested
          row:      '#1A1A1A',  // hover state for list rows
        },
        border: {
          DEFAULT: 'rgba(255,255,255,0.06)',
          strong:  'rgba(255,255,255,0.10)',
          hover:   'rgba(255,255,255,0.18)',
        },
        text: {
          primary:   '#F1F0ED',
          secondary: '#8C8C8A',
          muted:     '#4A4A48',
        },
        accent: {
          DEFAULT: '#5B6AF0',
          hover:   '#6B7AFF',
          dim:     'rgba(91,106,240,0.10)',
        },
        success:      '#22C55E',
        warning:      '#F59E0B',
        gray:         '#6B7280',
        danger:       '#EF4444',
        mongo:        '#10B981',
        postgres:     '#3B82F6',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Slightly tighter scale than default
        xs:  ['11px', '14px'],
        sm:  ['13px', '18px'],
        base:['14px', '20px'],
        md:  ['15px', '22px'],
        lg:  ['17px', '24px'],
        xl:  ['20px', '28px'],
        '2xl':['24px', '32px'],
        '3xl':['30px', '38px'],
      },
      borderRadius: {
        sm:  '4px',
        DEFAULT: '6px',  // inputs, badges
        md:  '8px',
        lg:  '10px',     // cards
        xl:  '14px',     // modals
      },
      spacing: {
        // 4px base unit reinforced — Tailwind already uses 4px scale, this just adds named tokens
        '0.5': '2px',
        '1':   '4px',
        '1.5': '6px',
        '2':   '8px',
        '3':   '12px',
        '4':   '16px',
        '5':   '20px',
        '6':   '24px',
        '8':   '32px',
        '10':  '40px',
        '13':  '52px',  // topbar height
        '55':  '220px', // sidebar width
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        pulse: {
          '0%, 100%': { opacity: 1 },
          '50%':      { opacity: 0.4 },
        },
        fadeIn: {
          from: { opacity: 0 },
          to:   { opacity: 1 },
        },
      },
      animation: {
        'pulse-soft': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in':    'fadeIn 150ms ease-out',
      },
    },
  },
  plugins: [],
};
