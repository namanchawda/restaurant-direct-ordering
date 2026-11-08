import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#2A1A12",
        muted: "#7A6558",
        surface: "#FFFFFF",
        canvas: "#F6EFE6",
        line: "#EADCCF",
        brand: {
          DEFAULT: "#B5532D",
          deep: "#7A2E14",
          soft: "#F6E3D5",
        },
        copper: "#C99A4B",
        search: "#E9C77B",
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
