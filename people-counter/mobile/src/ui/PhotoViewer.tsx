import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Icon } from "./Icon";

export function PhotoViewer({
  uri,
  visible,
  onClose,
  label,
  reduceMotion = false,
}: {
  uri: string;
  visible: boolean;
  onClose: () => void;
  label: string;
  reduceMotion?: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const bounds = useRef({ width, height });
  bounds.current = { width, height: Math.max(100, height - 180) };
  const zoom = useRef(new Animated.Value(1)).current;
  const offset = useRef(new Animated.ValueXY()).current;
  const scale = useRef(1);
  const position = useRef({ x: 0, y: 0 });
  const gesture = useRef({ distance: 0, scale: 1, x: 0, y: 0 });
  const [level, setLevel] = useState(1);
  function setZoom(value: number) {
    const next = Math.min(4, Math.max(1, value));
    scale.current = next;
    zoom.setValue(next);
    setLevel(next);
    position.current = { x: 0, y: 0 };
    offset.setValue(position.current);
  }
  useEffect(() => {
    if (visible) setZoom(1);
  }, [visible]);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (event) =>
        event.nativeEvent.touches.length > 1,
      onMoveShouldSetPanResponder: (event, state) =>
        event.nativeEvent.touches.length > 1 ||
        (scale.current > 1 && Math.abs(state.dx) + Math.abs(state.dy) > 5),
      onPanResponderGrant: (event) => {
        const touches = event.nativeEvent.touches;
        gesture.current = {
          scale: scale.current,
          x: position.current.x,
          y: position.current.y,
          distance:
            touches.length > 1
              ? Math.hypot(
                  touches[0].pageX - touches[1].pageX,
                  touches[0].pageY - touches[1].pageY,
                )
              : 0,
        };
      },
      onPanResponderMove: (event, state) => {
        const touches = event.nativeEvent.touches;
        if (touches.length > 1) {
          const distance = Math.hypot(
            touches[0].pageX - touches[1].pageX,
            touches[0].pageY - touches[1].pageY,
          );
          if (!gesture.current.distance) {
            gesture.current.distance = distance;
            gesture.current.scale = scale.current;
          }
          const next = Math.min(
            4,
            Math.max(
              1,
              (gesture.current.scale * distance) /
                Math.max(1, gesture.current.distance),
            ),
          );
          scale.current = next;
          zoom.setValue(next);
          offset.setValue({ x: 0, y: 0 });
          position.current = { x: 0, y: 0 };
        } else {
          const limitX = (bounds.current.width * (scale.current - 1)) / 2;
          const limitY = (bounds.current.height * (scale.current - 1)) / 2;
          position.current = {
            x: Math.min(
              limitX,
              Math.max(-limitX, gesture.current.x + state.dx),
            ),
            y: Math.min(
              limitY,
              Math.max(-limitY, gesture.current.y + state.dy),
            ),
          };
          offset.setValue(position.current);
        }
      },
      onPanResponderRelease: () => setLevel(scale.current),
      onPanResponderTerminate: () => setLevel(scale.current),
    }),
  ).current;
  return (
    <Modal
      visible={visible}
      animationType={reduceMotion ? "none" : "fade"}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <SafeAreaView style={s.safe} accessibilityViewIsModal>
        {visible && <StatusBar style="light" />}
        <View style={s.header}>
          <View>
            <Text style={s.title}>{label}</Text>
            <Text style={s.subtitle}>Pinch to zoom · drag to explore</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close photo viewer"
            onPress={onClose}
            style={s.control}
          >
            <Icon name="close" color="white" />
          </Pressable>
        </View>
        <View style={s.viewport} {...pan.panHandlers}>
          <Animated.Image
            accessibilityLabel={label}
            source={{ uri }}
            resizeMode="contain"
            style={[
              s.image,
              {
                transform: [
                  { translateX: offset.x },
                  { translateY: offset.y },
                  { scale: zoom },
                ],
              },
            ]}
          />
        </View>
        <View style={s.toolbar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Zoom out"
            accessibilityState={{ disabled: level <= 1 }}
            disabled={level <= 1}
            onPress={() => setZoom(scale.current - 0.5)}
            style={[s.control, level <= 1 && s.disabled]}
          >
            <Icon name="minus" color="white" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reset zoom"
            onPress={() => setZoom(1)}
            style={s.reset}
          >
            <Text style={s.zoom}>{Math.round(level * 100)}%</Text>
            <Text style={s.resetLabel}>Reset</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Zoom in"
            accessibilityState={{ disabled: level >= 4 }}
            disabled={level >= 4}
            onPress={() => setZoom(scale.current + 0.5)}
            style={[s.control, level >= 4 && s.disabled]}
          >
            <Icon name="plus" color="white" />
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#151C17" },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: { color: "white", fontWeight: "700", fontSize: 17 },
  subtitle: { color: "#BAC5BB", fontSize: 12, marginTop: 5 },
  control: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#2A342D",
    alignItems: "center",
    justifyContent: "center",
  },
  viewport: { flex: 1, overflow: "hidden" },
  image: { width: "100%", height: "100%" },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 28,
    padding: 20,
  },
  reset: {
    minWidth: 80,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  zoom: {
    fontSize: 16,
    color: "white",
    fontVariant: ["tabular-nums"],
    fontWeight: "600",
  },
  resetLabel: { color: "#BAC5BB", fontSize: 11, marginTop: 4 },
  disabled: { opacity: 0.35 },
});
