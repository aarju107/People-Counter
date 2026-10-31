import { fetch } from "whatwg-fetch";
import { Platform } from "react-native";
import { API_BASE_URL } from "../config";

export interface CountResult {
  count: number;
  detections: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    confidence: number;
  }[];
  image_width: number;
  image_height: number;
  annotated_image: string;
  inference_ms: number;
}

export class ApiError extends Error {}

export async function countPeople(
  uri: string,
  signal?: AbortSignal,
): Promise<CountResult> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const form = new FormData();
    if (Platform.OS === "web") {
      const photo = await fetch(uri, { signal: controller.signal });
      if (!photo.ok)
        throw new ApiError(
          "This photo could not be opened. Please choose it again.",
        );
      form.append("file", await photo.blob(), "people-counter.jpg");
    } else {
      // Import React Native's WHATWG/XHR transport explicitly: Expo's replacement
      // global fetch rejects native URI parts before sending the request.
      form.append("file", {
        uri,
        name: "people-counter.jpg",
        type: "image/jpeg",
      } as unknown as Blob);
    }
    const response = await fetch(`${API_BASE_URL}/api/v1/count`, {
      method: "POST",
      body: form,
      signal: controller.signal,
      // Do not set Content-Type: fetch must add the multipart boundary.
    });
    if (!response.ok) {
      if (response.status === 413)
        throw new ApiError(
          "This photo is too large. Please choose a smaller photo.",
        );
      if (response.status >= 500)
        throw new ApiError(
          "The server could not analyze this photo. Please try again shortly.",
        );
      let detail: unknown;
      try {
        detail = (await response.json()).detail;
      } catch {
        /* Use the friendly fallback below. */
      }
      throw new ApiError(
        typeof detail === "string"
          ? detail
          : "The photo could not be accepted. Please choose a JPEG, PNG, or WebP image.",
      );
    }
    const result = (await response.json()) as CountResult;
    if (
      !Number.isInteger(result.count) ||
      result.count < 0 ||
      typeof result.annotated_image !== "string" ||
      !result.annotated_image ||
      !(result.image_width > 0) ||
      !(result.image_height > 0)
    ) {
      throw new ApiError(
        "The server returned an unexpected result. Please try again.",
      );
    }
    return result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (__DEV__)
      console.warn("PeopleCounter upload failed", API_BASE_URL, error);
    if (signal?.aborted)
      throw new ApiError(
        "Counting canceled. Your photo is ready to try again.",
      );
    if (controller.signal.aborted)
      throw new ApiError(
        "The request took longer than 30 seconds. Check the server and try again.",
      );
    const diagnostics = __DEV__
      ? `\nServer: ${API_BASE_URL}\nDetails: ${error instanceof Error ? error.message : String(error)}`
      : "";
    throw new ApiError(
      `Cannot reach PeopleCounter. Check your Wi-Fi connection and make sure the server is running at the configured LAN address.${diagnostics}`,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
