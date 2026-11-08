import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1B0F0B",
        muted: "#6E5A4F",
        surface: "#FFFFFF",
        canvas: "#F7E9D2",
        line: "#E8D5BC",
        brand: {
          DEFAULT: "#D4261C",
          deep: "#A81B13",
          soft: "#FBE3D8",
        },
        copper: "#F2B632",
        search: "#F7E9D2",
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
