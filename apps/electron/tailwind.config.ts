/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/renderer/**/*.{ts,tsx}"],
  theme: {
    screens: {
      xs: "480px",
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
    },
    extend: {
      colors: {
        bg: "#0b0d10",
        panel: "#12151b",
        panel2: "#171b22",
        text: "#e6e9ef",
        muted: "#8b92a8",
        accent: "#3b82f6",
        accent2: "#60a5fa",
        good: "#22c55e",
        warn: "#f59e0b",
        bad: "#ef4444",
      },
      boxShadow: {
        card: "0 1px 3px 0 rgb(0 0 0 / 0.3), 0 1px 2px -1px rgb(0 0 0 / 0.2)",
        "card-hover": "0 8px 24px -4px rgb(0 0 0 / 0.4), 0 4px 8px -2px rgb(59 130 246 / 0.1)",
        sidebar: "4px 0 24px -8px rgb(0 0 0 / 0.5)",
        topbar: "0 1px 0 0 rgb(255 255 255 / 0.05)",
      },
      keyframes: {
        "slide-in": { from: { transform: "translateX(-100%)" }, to: { transform: "translateX(0)" } },
      },
      animation: {
        "slide-in": "slide-in 0.2s ease-out",
      },
    },
  },
  plugins: [],
}
