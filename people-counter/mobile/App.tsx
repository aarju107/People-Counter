import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { ApiError, countPeople, CountResult } from "./src/api/client";
import { Icon, IconName } from "./src/ui/Icon";
import { PhotoViewer } from "./src/ui/PhotoViewer";
import { colors as c, serif, softShadow } from "./src/ui/theme";

type Stage = "idle" | "preparing" | "counting";

export default function App() {
  return (
    <SafeAreaProvider>
      <PeopleCounter />
    </SafeAreaProvider>
  );
}

function PeopleCounter() {
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [result, setResult] = useState<CountResult | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [picking, setPicking] = useState<"camera" | "gallery" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [viewer, setViewer] = useState(false);
  const [original, setOriginal] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const locked = useRef(false);
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const entrance = useRef(new Animated.Value(1)).current;
  const scan = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const busy = stage !== "idle";
  const disabled = busy || picking !== null;

  useEffect(() => {
    mounted.current = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (mounted.current) setReduceMotion(value);
      })
      .catch(() => {});
    const listener = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    if (Platform.OS === "android") {
      ImagePicker.getPendingResultAsync()
        .then((pending) => {
          if (
            mounted.current &&
            pending &&
            "assets" in pending &&
            !pending.canceled &&
            pending.assets?.[0]
          )
            setPhoto(pending.assets[0]);
        })
        .catch(() => {});
    }
    return () => {
      mounted.current = false;
      request.current?.abort();
      listener.remove();
    };
  }, []);

  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
    if (reduceMotion) {
      entrance.setValue(1);
      return;
    }
    entrance.setValue(0);
    const animation = Animated.timing(entrance, {
      toValue: 1,
      duration: 260,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [photo?.uri, Boolean(result), reduceMotion, entrance]);

  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (!busy || reduceMotion) {
      scan.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scan, {
          toValue: 1,
          duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(scan, {
          toValue: 0,
          duration: 1800,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [busy, reduceMotion, scan]);

  async function choosePhoto(camera: boolean) {
    if (locked.current) return;
    locked.current = true;
    setPicking(camera ? "camera" : "gallery");
    setError(null);
    try {
      const permission = camera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        const actions = permission.canAskAgain
          ? [{ text: "OK" }]
          : [
              { text: "Not now", style: "cancel" as const },
              {
                text: "Open Settings",
                onPress: () => {
                  void Linking.openSettings().catch(() => {
                    if (mounted.current)
                      setError(
                        "Open your device Settings and allow photo or camera access.",
                      );
                  });
                },
              },
            ];
        Alert.alert(
          camera ? "Let’s open your camera" : "Let’s find your photo",
          permission.canAskAgain
            ? "Camera or photo access is needed to choose an image. Tap the button again when you’re ready to allow it."
            : "Access is turned off. You can enable it in your device Settings.",
          actions,
        );
        return;
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["images"],
        quality: 1,
        allowsEditing: false,
      };
      const selection = camera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (!selection.canceled && selection.assets[0] && mounted.current) {
        setPhoto(selection.assets[0]);
        setResult(null);
        setOriginal(false);
      }
    } catch {
      if (mounted.current)
        setError(
          camera
            ? "The camera could not open. Try choosing a photo from your gallery instead."
            : "The gallery could not open. Please try again.",
        );
    } finally {
      locked.current = false;
      if (mounted.current) setPicking(null);
    }
  }

  async function analyze() {
    if (!photo || locked.current) return;
    locked.current = true;
    const controller = new AbortController();
    request.current = controller;
    setStage("preparing");
    setError(null);
    let context: ReturnType<typeof ImageManipulator.manipulate> | undefined;
    let rendered:
      | Awaited<ReturnType<NonNullable<typeof context>["renderAsync"]>>
      | undefined;
    try {
      context = ImageManipulator.manipulate(photo.uri);
      if (photo.width > 1280) context.resize({ width: 1280 });
      rendered = await context.renderAsync();
      if (controller.signal.aborted) return;
      const prepared = await rendered.saveAsync({
        compress: 0.8,
        format: SaveFormat.JPEG,
      });
      if (controller.signal.aborted || !mounted.current) return;
      setStage("counting");
      const response = await countPeople(prepared.uri, controller.signal);
      if (mounted.current && !controller.signal.aborted) {
        setResult(response);
        setOriginal(false);
        AccessibilityInfo.announceForAccessibility(
          `${response.count} ${response.count === 1 ? "person" : "people"} detected. Your result is ready.`,
        );
      }
    } catch (caught) {
      if (mounted.current && !controller.signal.aborted) {
        setError(
          caught instanceof ApiError
            ? caught.message
            : "This photo could not be prepared. Please try a different image.",
        );
      }
    } finally {
      rendered?.release();
      context?.release();
      request.current = null;
      locked.current = false;
      if (mounted.current) setStage("idle");
    }
  }

  function reset() {
    setPhoto(null);
    setResult(null);
    setError(null);
    setOriginal(false);
    setViewer(false);
  }

  const annotated = useMemo(
    () => (result ? `data:image/jpeg;base64,${result.annotated_image}` : ""),
    [result],
  );
  const displayUri = result && !original ? annotated : (photo?.uri ?? "");
  const step = result ? 3 : photo ? 2 : 1;

  return (
    <SafeAreaView style={s.safe} edges={["top", "left", "right"]}>
      <StatusBar style="dark" />
      <View style={s.header}>
        <View style={s.wordmark}>
          <View style={s.logo}>
            <Icon name="scan" color={c.paper} size={22} />
          </View>
          <Text style={s.brand}>
            PeopleCounter<Text style={s.brandDot}>.</Text>
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="How PeopleCounter works"
          onPress={() => setHelp(true)}
          style={({ pressed }) => [s.help, pressed && s.pressed]}
        >
          <Icon name="help" size={19} color={c.muted} />
        </Pressable>
      </View>
      <ScrollView
        ref={scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={[
            s.content,
            {
              opacity: entrance,
              transform: [
                {
                  translateY: entrance.interpolate({
                    inputRange: [0, 1],
                    outputRange: [10, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={[s.heading, result && s.resultHeading]}>
            <Text style={s.eyebrow}>
              {result
                ? "THE RESULTS ARE IN"
                : "A LITTLE CLARITY GOES A LONG WAY"}
            </Text>
            <Text
              accessibilityRole="header"
              style={[
                s.title,
                width < 360 && s.smallTitle,
                result && s.resultTitle,
              ]}
            >
              {result ? "The count " : "Big group?"}
              <Text style={s.serifTitle}>
                {result ? "is in." : "\nSmall effort."}
              </Text>
            </Text>
            {!result && (
              <Text style={s.intro}>
                {
                  "Turn a group photo into a people count.\nJust choose, count, and see."
                }
              </Text>
            )}
          </View>
          <View
            style={s.steps}
            accessibilityLabel={`Step ${step} of 3: ${result ? "Review result" : photo ? "Count people" : "Choose photo"}`}
          >
            {["Choose photo", "Count people", "Review"].map((label, index) => (
              <React.Fragment key={label}>
                {index > 0 && (
                  <View style={[s.stepLine, step > index && s.stepLineDone]} />
                )}
                <View style={s.step}>
                  <View
                    style={[
                      s.stepDot,
                      step === index + 1 && s.stepActive,
                      step > index + 1 && s.stepDone,
                    ]}
                  >
                    {step > index + 1 ? (
                      <Icon name="check" size={12} color={c.green} />
                    ) : (
                      <Text
                        style={[
                          s.stepNumber,
                          step === index + 1 && s.stepNumberActive,
                        ]}
                      >
                        {index + 1}
                      </Text>
                    )}
                  </View>
                  <Text
                    style={[
                      s.stepLabel,
                      step === index + 1 && s.stepLabelActive,
                    ]}
                  >
                    {label}
                  </Text>
                </View>
              </React.Fragment>
            ))}
          </View>

          {result ? (
            <>
              <View
                style={s.resultSummary}
                accessible
                accessibilityLabel={`${result.count} ${result.count === 1 ? "person" : "people"} detected`}
                accessibilityLiveRegion="polite"
              >
                <View style={s.successPill}>
                  <Icon name="check" color={c.green} size={14} />
                  <Text style={s.successText}>COUNT COMPLETE</Text>
                </View>
                <View style={s.countRow}>
                  <Text style={s.count}>{result.count}</Text>
                  <View style={s.countDescription}>
                    <Text style={s.countNoun}>
                      {result.count === 1 ? "person" : "people"}
                    </Text>
                    <Text style={s.countDetected}>detected in your photo</Text>
                  </View>
                </View>
                <View style={s.summaryBottom}>
                  <View style={s.miniDot} />
                  <Text style={s.summaryText}>
                    {result.count === 0
                      ? "Try a clearer photo with people fully in frame."
                      : "Each highlighted box represents one detected person."}
                  </Text>
                </View>
              </View>
              <View style={s.sectionRow}>
                <Text style={s.sectionTitle}>A closer look</Text>
                <Text style={s.sectionMeta}>TAP PHOTO TO EXPLORE</Text>
              </View>
              <View style={s.segment} accessibilityRole="tablist">
                {[false, true].map((value) => (
                  <Pressable
                    key={String(value)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: original === value }}
                    onPress={() => setOriginal(value)}
                    style={[
                      s.segmentButton,
                      original === value && s.segmentSelected,
                    ]}
                  >
                    <Icon
                      name={value ? "gallery" : "scan"}
                      size={17}
                      color={original === value ? c.ink : c.muted}
                    />
                    <Text
                      style={[
                        s.segmentText,
                        original === value && s.segmentTextSelected,
                      ]}
                    >
                      {value ? "Original" : "Detections"}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${original ? "original" : "annotated"} photo fullscreen. Pinch to zoom.`}
                onPress={() => setViewer(true)}
                style={s.resultPhoto}
              >
                <Image
                  source={{ uri: displayUri }}
                  style={[
                    s.resultImage,
                    {
                      aspectRatio: Math.max(
                        0.65,
                        Math.min(1.5, result.image_width / result.image_height),
                      ),
                    },
                  ]}
                  resizeMode="contain"
                />
                <View style={s.expand}>
                  <Icon name="expand" color="white" size={17} />
                </View>
              </Pressable>
              <View style={s.metrics}>
                <View style={s.metric}>
                  <Text style={s.metricLabel}>MODEL TIME</Text>
                  <Text style={s.metricValue}>
                    {result.inference_ms < 1000
                      ? `${Math.round(result.inference_ms)} ms`
                      : `${(result.inference_ms / 1000).toFixed(2)} s`}
                  </Text>
                </View>
                <View style={s.metricDivider} />
                <View style={s.metric}>
                  <Text style={s.metricLabel}>IMAGE SIZE</Text>
                  <Text style={s.metricValue}>
                    {result.image_width} × {result.image_height}
                  </Text>
                </View>
              </View>
              <View style={s.note}>
                <View style={s.noteIcon}>
                  <Text style={s.noteI}>i</Text>
                </View>
                <Text style={s.noteText}>
                  A helpful estimate, not a perfect headcount. People who
                  overlap or are far away may be missed.
                </Text>
              </View>
            </>
          ) : (
            <>
              <View style={[s.photoCard, photo && s.photoCardSelected]}>
                <View style={s.photoCardHeader}>
                  <Text style={s.cardEyebrow}>
                    {photo ? "YOUR PHOTO" : "START WITH A PHOTO"}
                  </Text>
                  {photo ? (
                    <Pressable
                      disabled={disabled}
                      accessibilityRole="button"
                      accessibilityLabel="Remove selected photo"
                      onPress={reset}
                      style={[s.remove, disabled && s.disabled]}
                    >
                      <Icon name="close" size={14} color={c.muted} />
                    </Pressable>
                  ) : (
                    <View style={s.formatBadge}>
                      <Icon name="gallery" color={c.muted} size={14} />
                      <Text style={s.formatText}>ONE PHOTO. ONE COUNT.</Text>
                    </View>
                  )}
                </View>
                {photo ? (
                  <>
                    <Pressable
                      disabled={busy}
                      onPress={() => setViewer(true)}
                      accessibilityRole="button"
                      accessibilityLabel="Preview selected photo fullscreen"
                      style={s.selectedPhoto}
                    >
                      <Image
                        source={{ uri: photo.uri }}
                        style={s.selectedImage}
                        resizeMode="contain"
                      />
                      {!busy && (
                        <View style={s.expand}>
                          <Icon name="expand" color="white" size={17} />
                        </View>
                      )}
                      {busy && (
                        <View style={s.scanOverlay}>
                          <View style={s.scanBracket} />
                          {!reduceMotion && (
                            <Animated.View
                              style={[
                                s.scanBeam,
                                {
                                  transform: [
                                    {
                                      translateY: scan.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: [35, 230],
                                      }),
                                    },
                                  ],
                                },
                              ]}
                            />
                          )}
                          <View style={s.processingBadge}>
                            <ActivityIndicator size="small" color="white" />
                            <Text style={s.processingBadgeText}>
                              {stage === "preparing"
                                ? "Preparing photo"
                                : "Finding people"}
                            </Text>
                          </View>
                        </View>
                      )}
                    </Pressable>
                    <View style={s.photoInfo}>
                      <View style={s.photoReadyDot} />
                      <Text style={s.photoInfoText}>
                        {busy
                          ? "Your photo is being analyzed"
                          : "Looking good. Ready when you are."}
                      </Text>
                      <Text style={s.dimensions}>
                        {photo.width} × {photo.height}
                      </Text>
                    </View>
                  </>
                ) : (
                  <View style={s.emptyPhoto}>
                    <PeopleIllustration />
                    <Text style={s.emptyTitle}>
                      Bring your people into focus.
                    </Text>
                  </View>
                )}
              </View>

              {busy ? (
                <View style={s.progressCard} accessibilityLiveRegion="polite">
                  <View style={s.progressHeader}>
                    <Text style={s.progressTitle}>
                      {stage === "preparing"
                        ? "Making your photo ready…"
                        : "A moment. We’re counting…"}
                    </Text>
                    <Text style={s.elapsed}>{elapsed}s</Text>
                  </View>
                  <Text style={s.progressCopy}>
                    {elapsed >= 8
                      ? "Still working. You can cancel and try a smaller photo."
                      : "Sit tight while we find the people in your photo."}
                  </Text>
                  <View style={s.progressSteps}>
                    <View style={s.progressStage}>
                      <Icon
                        name={stage === "counting" ? "check" : "gallery"}
                        size={15}
                        color={c.green}
                      />
                      <Text style={s.progressStageText}>
                        {stage === "counting" ? "Photo ready" : "Preparing"}
                      </Text>
                    </View>
                    <View style={s.progressStageLine} />
                    <View style={s.progressStage}>
                      <Icon
                        name="scan"
                        size={15}
                        color={stage === "counting" ? c.accent : c.faint}
                      />
                      <Text
                        style={[
                          s.progressStageText,
                          stage !== "counting" && s.faint,
                        ]}
                      >
                        Detecting people
                      </Text>
                    </View>
                  </View>
                </View>
              ) : (
                <View style={s.sourceRow}>
                  <SourceButton
                    icon="camera"
                    label={photo ? "Retake photo" : "Take Photo"}
                    caption="Capture the moment"
                    loading={picking === "camera"}
                    disabled={disabled}
                    onPress={() => void choosePhoto(true)}
                  />
                  <SourceButton
                    icon="gallery"
                    label={photo ? "Change photo" : "Choose from Gallery"}
                    caption="Pick a photo you love"
                    loading={picking === "gallery"}
                    disabled={disabled}
                    onPress={() => void choosePhoto(false)}
                  />
                </View>
              )}

              {error && (
                <View
                  style={s.errorCard}
                  onLayout={({ nativeEvent }) =>
                    scroll.current?.scrollTo({
                      y: Math.max(0, nativeEvent.layout.y - 16),
                      animated: !reduceMotion,
                    })
                  }
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                >
                  <View style={s.errorTop}>
                    <View style={s.errorMark}>
                      <Text style={s.errorExclamation}>!</Text>
                    </View>
                    <Text style={s.errorTitle}>Let’s try that again</Text>
                  </View>
                  <Text style={s.errorText}>{error}</Text>
                  {photo && (
                    <Pressable
                      accessibilityRole="button"
                      disabled={disabled}
                      onPress={() => void analyze()}
                      style={s.retryButton}
                    >
                      <Icon name="retry" size={17} color={c.error} />
                      <Text style={s.retryText}>Retry this photo</Text>
                    </Pressable>
                  )}
                </View>
              )}

              {!busy && (
                <View style={s.tipCard}>
                  <View style={s.tipIcon}>
                    <Icon name="scan" size={21} color={c.accent} />
                  </View>
                  <View style={s.tipBody}>
                    <Text style={s.tipTitle}>
                      A little tip for a better count
                    </Text>
                    <Text style={s.tipCopy}>
                      Use a clear, well-lit photo with as much of each person in
                      frame as possible.
                    </Text>
                  </View>
                </View>
              )}
              <View style={s.privacy}>
                <View style={s.privacyDot} />
                <Text style={s.privacyText}>
                  Processed on your server. No photo history stored.
                </Text>
              </View>
            </>
          )}
        </Animated.View>
      </ScrollView>

      <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={s.footerContent}>
          {busy ? (
            <>
              <PrimaryButton
                label={
                  stage === "preparing"
                    ? "Preparing photo…"
                    : "Counting people…"
                }
                loading
                disabled
                onPress={() => {}}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel counting and keep photo"
                onPress={() => request.current?.abort()}
                style={s.cancel}
              >
                <Text style={s.cancelText}>Cancel and keep photo</Text>
              </Pressable>
            </>
          ) : (
            <>
              <PrimaryButton
                label={
                  result
                    ? "Try another photo"
                    : !photo
                      ? "Choose a photo"
                      : error
                        ? "Try counting again"
                        : "Count People"
                }
                icon={result ? "plus" : !photo ? "gallery" : "arrow"}
                disabled={disabled}
                onPress={
                  result
                    ? reset
                    : !photo
                      ? () => void choosePhoto(false)
                      : () => void analyze()
                }
              />
              <Text style={s.footerHint}>
                {result
                  ? "A new photo. A fresh perspective."
                  : photo
                    ? "Ready to turn this photo into a headcount."
                    : "Or take a new photo using your camera."}
              </Text>
            </>
          )}
        </View>
      </View>

      <PhotoViewer
        uri={displayUri}
        reduceMotion={reduceMotion}
        visible={viewer}
        onClose={() => setViewer(false)}
        label={
          result
            ? original
              ? "Original photo"
              : "Detected people"
            : "Your photo"
        }
      />
      <Modal
        visible={help}
        transparent
        animationType={reduceMotion ? "none" : "slide"}
        onRequestClose={() => setHelp(false)}
        statusBarTranslucent
      >
        <View style={s.modalBackdrop}>
          <Pressable
            accessibilityLabel="Close help"
            accessibilityRole="button"
            onPress={() => setHelp(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={s.helpSheet} accessibilityViewIsModal>
            <ScrollView
              showsVerticalScrollIndicator={false}
              bounces={false}
              contentContainerStyle={[
                s.helpSheetContent,
                { paddingBottom: Math.max(insets.bottom, 24) },
              ]}
            >
              <View style={s.sheetHandle} />
              <View style={s.sheetHeader}>
                <Text accessibilityRole="header" style={s.sheetTitle}>
                  A photo. A people count.
                </Text>
                <Pressable
                  accessibilityLabel="Close help"
                  accessibilityRole="button"
                  onPress={() => setHelp(false)}
                  style={s.help}
                >
                  <Icon name="close" size={18} />
                </Pressable>
              </View>
              <Text style={s.sheetIntro}>
                Three small steps to a clearer picture.
              </Text>
              {[
                [
                  "camera",
                  "Choose your moment",
                  "Take a new photo or pick one from your gallery.",
                ],
                [
                  "scan",
                  "Let us do the counting",
                  "We find people in the photo and mark them with boxes.",
                ],
                [
                  "check",
                  "Take a closer look",
                  "Compare the result with your original. Tap the photo to zoom in.",
                ],
              ].map(([icon, title, copy], index) => (
                <View key={title} style={s.helpStep}>
                  <View style={s.helpStepIcon}>
                    <Icon name={icon as IconName} color={c.accent} />
                  </View>
                  <View style={s.helpStepBody}>
                    <Text style={s.helpStepTitle}>
                      {index + 1}. {title}
                    </Text>
                    <Text style={s.helpStepCopy}>{copy}</Text>
                  </View>
                </View>
              ))}
              <View style={s.helpNote}>
                <Text style={s.helpNoteText}>
                  Counts are estimates. Clear photos and visible people give the
                  best results. Photos are processed on your configured server
                  and aren’t kept after processing.
                </Text>
              </View>
              <PrimaryButton
                label="Got it, let’s count"
                onPress={() => setHelp(false)}
                icon="arrow"
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function PrimaryButton({
  label,
  icon,
  onPress,
  disabled = false,
  loading = false,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.primary,
        disabled && !loading && s.primaryDisabled,
        pressed && s.primaryPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color="white" />
      ) : (
        icon && <Icon name={icon} color="white" size={20} />
      )}
      <Text style={s.primaryText}>{label}</Text>
    </Pressable>
  );
}

function SourceButton({
  icon,
  label,
  caption,
  loading,
  disabled,
  onPress,
}: {
  icon: IconName;
  label: string;
  caption: string;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.source,
        disabled && s.disabled,
        pressed && s.sourcePressed,
      ]}
    >
      <View style={s.sourceIcon}>
        {loading ? (
          <ActivityIndicator color={c.accent} />
        ) : (
          <Icon name={icon} color={c.accent} size={23} />
        )}
      </View>
      <Text style={s.sourceLabel}>{label}</Text>
      <Text style={s.sourceCaption}>{caption}</Text>
    </Pressable>
  );
}

function PeopleIllustration() {
  return (
    <View
      style={s.illustration}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <View style={s.artHalo} />
      <View style={s.artGround} />
      {[
        { left: 33, top: 38, scale: 0.83, color: "#A5B9A5", box: "#7A9A7A" },
        { left: 143, top: 30, scale: 0.92, color: "#C9AC94", box: "#BE9876" },
        { left: 86, top: 17, scale: 1.1, color: "#D96C45", box: "#D84A24" },
      ].map((person, index) => (
        <View
          key={index}
          style={[
            s.artPerson,
            {
              left: person.left,
              top: person.top,
              transform: [{ scale: person.scale }],
            },
          ]}
        >
          <View style={[s.artHead, { backgroundColor: person.color }]} />
          <View style={[s.artBody, { backgroundColor: person.color }]} />
          <View style={[s.artBox, { borderColor: person.box }]} />
        </View>
      ))}
      <View style={s.artTag}>
        <View style={s.artTagDot} />
        <Text style={s.artTagText}>People, in perspective.</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.canvas },
  header: {
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  wordmark: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: {
    width: 35,
    height: 35,
    borderRadius: 11,
    backgroundColor: c.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: { fontWeight: "800", fontSize: 19, letterSpacing: -0.7, color: c.ink },
  brandDot: { color: c.accent },
  help: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.paper,
  },
  scrollContent: { flexGrow: 1, paddingBottom: 24 },
  content: {
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    paddingHorizontal: 24,
    gap: 20,
  },
  heading: { marginTop: 19, gap: 12 },
  resultHeading: { marginTop: 8, gap: 9 },
  resultTitle: { fontSize: 34, lineHeight: 42 },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.9,
    fontWeight: "700",
    color: c.accent,
  },
  title: {
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: -1.5,
    fontWeight: "800",
    color: c.ink,
  },
  smallTitle: { fontSize: 35, lineHeight: 42 },
  serifTitle: {
    fontFamily: serif,
    fontWeight: "400",
    fontStyle: "italic",
    color: c.accent,
    letterSpacing: -1.5,
  },
  intro: { color: c.muted, fontSize: 14, lineHeight: 22 },
  steps: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 3,
    marginBottom: 1,
    gap: 7,
  },
  step: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  stepDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#E9EBE4",
    alignItems: "center",
    justifyContent: "center",
  },
  stepActive: { backgroundColor: c.accent },
  stepDone: { backgroundColor: "#DFEBDF" },
  stepNumber: { fontSize: 11, color: "#5C6756", fontWeight: "700" },
  stepNumberActive: { color: "white" },
  stepLabel: { fontSize: 11, color: c.muted, flexShrink: 1 },
  stepLabelActive: { color: c.ink, fontWeight: "700" },
  stepLine: { flex: 1, minWidth: 5, height: 1, backgroundColor: "#DCE0D6" },
  stepLineDone: { backgroundColor: "#A9C3AA" },
  photoCard: {
    backgroundColor: c.paper,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 22,
    overflow: "hidden",
    ...softShadow,
  },
  photoCardSelected: { borderColor: "#D5DFCE" },
  photoCardHeader: {
    paddingHorizontal: 17,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    minHeight: 49,
  },
  cardEyebrow: {
    color: "#57634F",
    letterSpacing: 1.5,
    fontWeight: "700",
    fontSize: 9,
  },
  formatBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexShrink: 1,
  },
  formatText: {
    fontSize: 11,
    letterSpacing: 0.5,
    fontWeight: "600",
    color: c.muted,
    flexShrink: 1,
  },
  emptyPhoto: {
    alignItems: "center",
    paddingBottom: 18,
    backgroundColor: "#FCFCF9",
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: c.ink,
    letterSpacing: -0.35,
    marginTop: 5,
    textAlign: "center",
    paddingHorizontal: 12,
  },
  illustration: { height: 140, width: 255, marginTop: 2, marginBottom: 4 },
  artHalo: {
    position: "absolute",
    width: 170,
    height: 125,
    top: 3,
    left: 43,
    borderRadius: 100,
    backgroundColor: "#F1EEE5",
  },
  artGround: {
    position: "absolute",
    width: 230,
    height: 1,
    backgroundColor: "#E4E6DC",
    left: 12,
    top: 126,
  },
  artPerson: { position: "absolute", width: 55, height: 97 },
  artHead: {
    position: "absolute",
    width: 24,
    height: 24,
    borderRadius: 12,
    top: 10,
    left: 16,
  },
  artBody: {
    position: "absolute",
    width: 42,
    height: 57,
    borderTopLeftRadius: 21,
    borderTopRightRadius: 21,
    borderBottomLeftRadius: 5,
    borderBottomRightRadius: 5,
    top: 39,
    left: 7,
  },
  artBox: {
    position: "absolute",
    width: 64,
    height: 110,
    borderWidth: 1.2,
    top: 0,
    left: -4,
    borderRadius: 6,
  },
  artTag: {
    position: "absolute",
    bottom: 3,
    left: 43,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  artTagDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: c.accent,
  },
  artTagText: { fontSize: 11, fontWeight: "600", color: "#58604F" },
  sourceRow: { flexDirection: "row", gap: 12 },
  source: {
    flex: 1,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.paper,
    borderRadius: 17,
    padding: 15,
    minHeight: 123,
  },
  sourcePressed: { backgroundColor: c.accentSoft, borderColor: "#EDC5B5" },
  sourceIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: c.accentSoft,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  sourceLabel: {
    fontSize: 13,
    color: c.ink,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  sourceCaption: { fontSize: 11, lineHeight: 16, color: c.muted, marginTop: 4 },
  tipCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 4,
    paddingTop: 1,
  },
  tipIcon: {
    width: 35,
    height: 35,
    borderRadius: 11,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#EFEDE5",
  },
  tipBody: { flex: 1, gap: 4 },
  tipTitle: { color: "#48513F", fontSize: 12, fontWeight: "700" },
  tipCopy: { color: c.muted, fontSize: 11, lineHeight: 18 },
  privacy: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 1,
    paddingHorizontal: 4,
  },
  privacyDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#7A9679",
  },
  privacyText: { fontSize: 11, color: c.muted, lineHeight: 15, flexShrink: 1 },
  footer: {
    backgroundColor: c.paper,
    borderTopWidth: 1,
    borderTopColor: c.line,
    paddingTop: 14,
    paddingHorizontal: 24,
  },
  footerContent: { width: "100%", maxWidth: 592, alignSelf: "center", gap: 10 },
  primary: {
    minHeight: 56,
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: c.accent,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  primaryDisabled: { backgroundColor: "#BDC3B6" },
  primaryPressed: { backgroundColor: "#B93B1A", transform: [{ scale: 0.985 }] },
  primaryText: {
    fontSize: 15,
    fontWeight: "700",
    color: "white",
    textAlign: "center",
    flexShrink: 1,
  },
  footerHint: {
    fontSize: 11,
    lineHeight: 15,
    textAlign: "center",
    color: c.muted,
  },
  remove: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: "#F3F4EF",
    marginVertical: -5,
  },
  selectedPhoto: {
    height: 290,
    backgroundColor: "#EEF0E9",
    overflow: "hidden",
  },
  selectedImage: { width: "100%", height: "100%" },
  expand: {
    position: "absolute",
    right: 12,
    bottom: 12,
    backgroundColor: "#26362CD9",
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  photoInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexWrap: "wrap",
  },
  photoReadyDot: {
    width: 5,
    height: 5,
    backgroundColor: c.green,
    borderRadius: 3,
  },
  photoInfoText: { flex: 1, fontSize: 11, color: "#53614C", minWidth: 100 },
  dimensions: { fontSize: 11, color: c.muted, fontVariant: ["tabular-nums"] },
  scanOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "#1B2B2459",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 20,
  },
  scanBracket: {
    position: "absolute",
    top: 28,
    left: 26,
    right: 26,
    bottom: 28,
    borderWidth: 1,
    borderRadius: 12,
    borderColor: "#FFFFFF99",
  },
  scanBeam: {
    position: "absolute",
    top: 0,
    left: 26,
    right: 26,
    height: 2,
    backgroundColor: "#FFD6BA",
  },
  processingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#1F332CEB",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 30,
  },
  processingBadgeText: { color: "white", fontSize: 11, fontWeight: "600" },
  progressCard: {
    backgroundColor: c.paper,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: c.line,
    padding: 18,
    gap: 10,
  },
  progressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  progressTitle: { color: c.ink, fontSize: 13, fontWeight: "700", flex: 1 },
  elapsed: { fontSize: 11, color: c.muted, fontVariant: ["tabular-nums"] },
  progressCopy: { fontSize: 11, lineHeight: 18, color: c.muted },
  progressSteps: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 8,
  },
  progressStage: { flexDirection: "row", alignItems: "center", gap: 6 },
  progressStageText: { fontSize: 11, color: "#46654D", fontWeight: "500" },
  progressStageLine: { flex: 1, height: 1, backgroundColor: c.line },
  faint: { color: c.faint },
  cancel: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 12, fontWeight: "600", color: c.muted },
  resultSummary: {
    backgroundColor: c.paper,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: c.line,
    padding: 22,
    ...softShadow,
  },
  successPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: c.greenSoft,
    borderRadius: 20,
  },
  successText: {
    color: c.green,
    fontSize: 11,
    letterSpacing: 1.2,
    fontWeight: "700",
  },
  countRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    paddingVertical: 13,
    flexWrap: "wrap",
  },
  count: {
    fontSize: 88,
    lineHeight: 100,
    letterSpacing: -5,
    color: c.accent,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  countDescription: { gap: 5, flexShrink: 1 },
  countNoun: {
    color: c.ink,
    fontSize: 23,
    fontWeight: "700",
    letterSpacing: -0.6,
  },
  countDetected: { fontSize: 11, color: c.muted },
  summaryBottom: {
    borderTopWidth: 1,
    borderTopColor: c.line,
    paddingTop: 13,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  miniDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: c.green },
  summaryText: { fontSize: 11, lineHeight: 16, color: c.muted, flex: 1 },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 17,
    letterSpacing: -0.5,
    color: c.ink,
    fontWeight: "700",
  },
  sectionMeta: {
    color: c.muted,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1,
    flexShrink: 1,
  },
  segment: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 14,
    backgroundColor: "#EAEDE4",
    marginTop: -6,
    marginBottom: -8,
  },
  segmentButton: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 10,
  },
  segmentSelected: {
    backgroundColor: "white",
    shadowColor: "#243121",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  segmentText: { color: c.muted, fontSize: 12 },
  segmentTextSelected: { color: c.ink, fontWeight: "700" },
  resultPhoto: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E2E6DA",
    overflow: "hidden",
    backgroundColor: "#EAEDE5",
  },
  resultImage: { width: "100%", maxHeight: 460 },
  metrics: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: c.line,
    paddingBottom: 20,
    marginTop: -3,
  },
  metric: { flex: 1, paddingHorizontal: 6, gap: 7 },
  metricLabel: {
    color: c.muted,
    fontSize: 11,
    letterSpacing: 1.2,
    fontWeight: "700",
  },
  metricValue: {
    color: c.ink,
    fontSize: 13,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  metricDivider: { width: 1, backgroundColor: c.line, marginRight: 18 },
  note: {
    flexDirection: "row",
    gap: 9,
    alignItems: "flex-start",
    marginTop: -6,
  },
  noteIcon: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderColor: "#98A18F",
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  noteI: {
    fontSize: 11,
    color: c.muted,
    fontFamily: serif,
    fontStyle: "italic",
  },
  noteText: { flex: 1, fontSize: 11, color: c.muted, lineHeight: 17 },
  errorCard: {
    backgroundColor: "#FFF1EC",
    borderWidth: 1,
    borderColor: "#F4D5C8",
    borderRadius: 16,
    padding: 16,
    gap: 9,
  },
  errorTop: { flexDirection: "row", alignItems: "center", gap: 7 },
  errorMark: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: c.error,
    alignItems: "center",
    justifyContent: "center",
  },
  errorExclamation: { fontSize: 11, color: c.error, fontWeight: "700" },
  errorTitle: { fontSize: 13, color: c.error, fontWeight: "700" },
  errorText: { color: "#8D4435", fontSize: 12, lineHeight: 19 },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    minHeight: 44,
    gap: 6,
  },
  retryText: { fontSize: 12, fontWeight: "700", color: c.error },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "#14211680",
    justifyContent: "flex-end",
  },
  helpSheet: {
    width: "100%",
    maxWidth: 640,
    maxHeight: "94%",
    alignSelf: "center",
    backgroundColor: c.canvas,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
  },
  helpSheetContent: { paddingHorizontal: 24, paddingTop: 12, gap: 18 },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: "#D9DED1",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 2,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  sheetTitle: {
    color: c.ink,
    fontSize: 21,
    fontWeight: "700",
    letterSpacing: -0.6,
    flex: 1,
  },
  sheetIntro: { color: c.muted, fontSize: 13, marginTop: -12 },
  helpStep: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  helpStepIcon: {
    width: 43,
    height: 43,
    borderRadius: 14,
    backgroundColor: c.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  helpStepBody: { flex: 1, gap: 5, paddingTop: 2 },
  helpStepTitle: { color: c.ink, fontWeight: "700", fontSize: 13 },
  helpStepCopy: { color: c.muted, fontSize: 12, lineHeight: 19 },
  helpNote: { backgroundColor: "#EBEEE4", padding: 14, borderRadius: 14 },
  helpNoteText: { color: "#5E6D53", fontSize: 11, lineHeight: 18 },
});
