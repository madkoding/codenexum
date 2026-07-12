/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
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
      backgroundImage: {
        "gradient-panel": "linear-gradient(135deg, rgb(23 27 34) 0%, rgb(18 21 27) 100%)",
        "gradient-accent": "linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%)",
        "shimmer": "linear-gradient(90deg, transparent 0%, rgb(255 255 255 / 0.04) 50%, transparent 100%)",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(0)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.8s ease-in-out infinite",
        "fade-in": "fade-in 0.3s ease-out",
        "slide-in": "slide-in 0.2s ease-out",
      },
      transitionTimingFunction: {
        smooth: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
    },
  },
  plugins: [],
}