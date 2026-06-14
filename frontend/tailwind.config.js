/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      colors: {
        // 深邃紫金 — AIsChat 品牌色
        canvas: '#0C0A14',        // 最深底色（body）
        surface: '#151223',       // 卡片/侧栏
        elevated: '#1E1A30',      // 弹窗/悬浮层
        border:   '#2A2540',      // 分割线
        primary: {
          50:  '#F8F6FF',
          100: '#EDE9FE',
          200: '#DDD6FE',
          300: '#C4B5FD',
          400: '#A78BFA',         // 主色
          500: '#8B5CF6',
          600: '#7C3AED',
          700: '#6D28D9',
          800: '#5B21B6',
          900: '#4C1D95',
        },
        accent: {
          50:  '#FFF7ED',
          100: '#FFEDD5',
          200: '#FED7AA',
          300: '#FDBA74',
          400: '#FBBF24',         // 琥珀金（状态变更/通知）
          500: '#F59E0B',
          600: '#D97706',
          700: '#B45309',
        },
        mint: {
          400: '#34D399',         // 在线/活跃绿
          500: '#10B981',
        },
        rose: {
          400: '#FB7185',         // 勿扰/危险红
        },
      },
      animation: {
        'pulse-ring': 'pulseRing 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'shimmer': 'shimmer 2.5s ease-in-out infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        pulseRing: {
          '0%':   { boxShadow: '0 0 0 0 rgba(167, 139, 250, 0.4)' },
          '70%':  { boxShadow: '0 0 0 8px rgba(167, 139, 250, 0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(167, 139, 250, 0)' },
        },
        shimmer: {
          '0%, 100%': { opacity: '0.3' },
          '50%':      { opacity: '1' },
        },
        fadeIn: {
          '0%':   { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%':   { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
