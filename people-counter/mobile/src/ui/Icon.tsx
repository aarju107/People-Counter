import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "./theme";

export type IconName =
  | "scan"
  | "camera"
  | "gallery"
  | "arrow"
  | "close"
  | "check"
  | "expand"
  | "help"
  | "retry"
  | "plus"
  | "minus";

/** Small native shapes keep icons crisp without an icon font or native dependency. */
export function Icon({
  name,
  color = colors.ink,
  size = 24,
}: {
  name: IconName;
  color?: string;
  size?: number;
}) {
  const stroke = { borderColor: color };
  return (
    <View
      pointerEvents="none"
      accessible={false}
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{ width: 24, height: 24, transform: [{ scale: size / 24 }] }}
      >
        {name === "scan" || name === "expand" ? (
          <>
            {(["tl", "tr", "bl", "br"] as const).map((corner) => (
              <View key={corner} style={[s.corner, s[corner], stroke]} />
            ))}
            {name === "scan" && (
              <View style={[s.scanLine, { backgroundColor: color }]} />
            )}
          </>
        ) : name === "camera" ? (
          <>
            <View style={[s.camera, stroke]} />
            <View style={[s.cameraTop, stroke]} />
            <View style={[s.lens, stroke]} />
          </>
        ) : name === "gallery" ? (
          <>
            <View style={[s.gallery, stroke]} />
            <View style={[s.sun, { backgroundColor: color }]} />
            <View style={[s.mountain, stroke]} />
          </>
        ) : name === "check" ? (
          <View style={[s.check, stroke]} />
        ) : name === "close" ? (
          <>
            <View
              style={[
                s.bar,
                { backgroundColor: color, transform: [{ rotate: "45deg" }] },
              ]}
            />
            <View
              style={[
                s.bar,
                { backgroundColor: color, transform: [{ rotate: "-45deg" }] },
              ]}
            />
          </>
        ) : name === "plus" || name === "minus" ? (
          <>
            <View style={[s.bar, { backgroundColor: color }]} />
            {name === "plus" && (
              <View
                style={[
                  s.bar,
                  { backgroundColor: color, transform: [{ rotate: "90deg" }] },
                ]}
              />
            )}
          </>
        ) : name === "arrow" ? (
          <>
            <View style={[s.bar, { backgroundColor: color }]} />
            <View style={[s.arrowHead, stroke]} />
          </>
        ) : (
          <Text style={[s.glyph, { color }]}>
            {name === "help" ? "?" : "↻"}
          </Text>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  corner: {
    position: "absolute",
    width: 7,
    height: 7,
    borderWidth: 2,
    borderRadius: 1,
  },
  tl: { left: 2, top: 2, borderRightWidth: 0, borderBottomWidth: 0 },
  tr: { right: 2, top: 2, borderLeftWidth: 0, borderBottomWidth: 0 },
  bl: { left: 2, bottom: 2, borderRightWidth: 0, borderTopWidth: 0 },
  br: { right: 2, bottom: 2, borderLeftWidth: 0, borderTopWidth: 0 },
  scanLine: {
    position: "absolute",
    height: 2,
    width: 12,
    top: 11,
    left: 6,
    borderRadius: 1,
  },
  camera: {
    position: "absolute",
    left: 2,
    right: 2,
    top: 7,
    height: 15,
    borderWidth: 1.7,
    borderRadius: 4,
  },
  cameraTop: {
    position: "absolute",
    left: 8,
    top: 3,
    width: 8,
    height: 5,
    borderWidth: 1.7,
    borderBottomWidth: 0,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  lens: {
    position: "absolute",
    width: 8,
    height: 8,
    borderWidth: 1.7,
    borderRadius: 4,
    top: 10,
    left: 8,
  },
  gallery: {
    position: "absolute",
    left: 3,
    top: 3,
    width: 18,
    height: 18,
    borderWidth: 1.7,
    borderRadius: 4,
  },
  sun: {
    position: "absolute",
    width: 4,
    height: 4,
    borderRadius: 2,
    top: 7,
    left: 12,
  },
  mountain: {
    position: "absolute",
    width: 10,
    height: 10,
    left: 6,
    top: 12,
    borderTopWidth: 1.7,
    borderLeftWidth: 1.7,
    transform: [{ rotate: "45deg" }],
  },
  check: {
    position: "absolute",
    width: 7,
    height: 13,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    top: 3,
    left: 9,
    transform: [{ rotate: "42deg" }],
  },
  bar: {
    position: "absolute",
    height: 2,
    width: 16,
    borderRadius: 2,
    top: 11,
    left: 4,
  },
  arrowHead: {
    position: "absolute",
    width: 8,
    height: 8,
    borderTopWidth: 2,
    borderRightWidth: 2,
    top: 8,
    right: 4,
    transform: [{ rotate: "45deg" }],
  },
  glyph: {
    fontSize: 23,
    fontWeight: "500",
    lineHeight: 26,
    textAlign: "center",
  },
});
