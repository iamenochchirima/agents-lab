/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "var(--border)",
        input: "var(--border-strong)",
        ring: "var(--accent)",
        background: "var(--bg)",
        foreground: "var(--text-1)",
        primary: {
          DEFAULT: "var(--accent)",
          foreground: "var(--on-accent)",
        },
        secondary: {
          DEFAULT: "var(--surface-2)",
          foreground: "var(--text-1)",
        },
        destructive: {
          DEFAULT: "var(--danger)",
          foreground: "var(--on-accent)",
        },
        muted: {
          DEFAULT: "var(--surface-2)",
          foreground: "var(--text-2)",
        },
        accent: {
          DEFAULT: "var(--accent-soft)",
          foreground: "var(--accent)",
        },
        popover: {
          DEFAULT: "var(--surface)",
          foreground: "var(--text-1)",
        },
        card: {
          DEFAULT: "var(--surface)",
          foreground: "var(--text-1)",
        },
        canvas: "var(--bg)",
        surface: {
          DEFAULT: "var(--surface)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
        },
        line: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
        },
        ink: {
          1: "var(--text-1)",
          2: "var(--text-2)",
          3: "var(--text-3)",
        },
        brand: {
          DEFAULT: "var(--accent)",
          strong: "var(--accent-strong)",
          soft: "var(--accent-soft)",
          2: "var(--accent-2)",
        },
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
        info: "var(--info)",
        chart: {
          1: "var(--chart-1)",
          2: "var(--chart-2)",
          3: "var(--chart-3)",
          4: "var(--chart-4)",
          5: "var(--chart-5)",
          6: "var(--chart-6)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        xl: "20px",
        lg: "14px",
        md: "10px",
        sm: "6px",
        pill: "999px",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        pop: "var(--shadow-pop)",
      },
      keyframes: {
        "live-pulse": {
          "0%": { transform: "scale(1)", opacity: "0.7" },
          "70%": { transform: "scale(1.9)", opacity: "0" },
          "100%": { transform: "scale(1.9)", opacity: "0" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
      },
      animation: {
        "live-pulse": "live-pulse 2s ease-out infinite",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
