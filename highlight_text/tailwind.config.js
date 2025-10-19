/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./web/**/*.{html,js}",
    "./web/index.html"
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 自定义颜色可以在这里添加
      },
      animation: {
        'blink-caret': 'blink-caret 0.75s step-end infinite'
      },
      keyframes: {
        'blink-caret': {
          'from, to': { borderColor: 'transparent' },
          '50%': { borderColor: 'orange' }
        }
      }
    },
  },
  plugins: [],
}
