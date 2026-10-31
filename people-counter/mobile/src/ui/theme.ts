import { Platform } from "react-native";

export const colors = {
  canvas: "#F7F6F2",
  paper: "#FFFFFF",
  ink: "#242923",
  muted: "#687065",
  faint: "#959B91",
  line: "#E5E7DF",
  accent: "#C84924",
  accentSoft: "#FFF0E8",
  green: "#367256",
  greenSoft: "#EDF5EE",
  dark: "#242D26",
  error: "#A33325",
};

export const serif = Platform.select({
  ios: "Georgia",
  android: "serif",
  default: "Georgia",
});

export const softShadow = {
  shadowColor: "#263126",
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.05,
  shadowRadius: 18,
  elevation: 2,
};
