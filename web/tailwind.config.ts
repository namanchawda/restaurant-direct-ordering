import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#241D1B",
        muted: "#665B56",
        surface: "#FFFFFF",
        canvas: "#FAF9F7",
        line: "#E9E5E1",
        brand: {
          DEFAULT: "#783B35",
          deep: "#572923",
          soft: "#F4E9E6",
        },
        saffron: "#B77820",
      },
      spacing: {
        "18": "4.5rem",
        "22": "5.5rem",
        "30": "7.5rem",
      },
      borderRadius: {
        card: "1.25rem",
        panel: "1.75rem",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Arial", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      maxWidth: {
        page: "76rem",
      },
    },
  },
  plugins: [],
};

export default config;
