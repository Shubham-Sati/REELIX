// Fonts the storyboard can pick (all Google Fonts, OFL). Loaded only when used.
import { FontName } from "./types";
export const loadFontFamily = (name: FontName = "Montserrat"): string => {
  switch (name) {
    case "Anton": return require("@remotion/google-fonts/Anton").loadFont("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily;
    case "BebasNeue": return require("@remotion/google-fonts/BebasNeue").loadFont("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily;
    case "Fraunces": return require("@remotion/google-fonts/Fraunces").loadFont("normal", { weights: ["900"], subsets: ["latin"] }).fontFamily;
    case "Caveat": return require("@remotion/google-fonts/Caveat").loadFont("normal", { weights: ["700"], subsets: ["latin"] }).fontFamily;
    case "BricolageGrotesque": return require("@remotion/google-fonts/BricolageGrotesque").loadFont("normal", { weights: ["800"], subsets: ["latin"] }).fontFamily;
    default: return require("@remotion/google-fonts/Montserrat").loadFont("normal", { weights: ["800", "900"], subsets: ["latin"] }).fontFamily;
  }
};
