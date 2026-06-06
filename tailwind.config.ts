import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#e6edf5",
        mist: "#96a3b6",
        pitch: "#07111d",
        panel: "#0d1825",
        line: "#1e3247",
        accent: "#8dd3c7",
        danger: "#ff8c6b",
        gold: "#f3cf7a",
      },
      boxShadow: {
        panel: "0 24px 60px rgba(0, 0, 0, 0.28)",
      },
      fontFamily: {
        sans: ['"Avenir Next"', '"Segoe UI"', "sans-serif"],
        display: ['"Iowan Old Style"', "Georgia", "serif"],
        mono: ['"SFMono-Regular"', '"Menlo"', "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;

