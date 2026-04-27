/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        vista: {
          accent: "#E06C00",
          "accent-light": "#FFA142",
          cyan: "#32D74B",
          green: "#00C7BE",
          orange: "#FFD60A",
          red: "#FF453A",
          purple: "#6C63FF",
          bg: "#121316",
          bg2: "#1A1B1F",
          bg3: "#202227",
          bg4: "#26282E",
          input: "#15161A",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
