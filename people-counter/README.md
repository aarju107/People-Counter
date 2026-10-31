# PeopleCounter

Take or select a photo in an Expo mobile app, upload it to FastAPI, and see the number of people plus an annotated JPEG. The server uses pretrained COCO **YOLOv8n** (`yolov8n.pt`) and detects only class **0: person**.

## Prerequisites

- Windows PowerShell, Python **3.11** (on PATH), and Node.js **22.13+ LTS**. Node 18+ is the baseline requirement in the brief, but Expo SDK 58 requires the newer Node runtime.
- Expo Go on an Android or iOS phone, compatible with Expo SDK 58.
- Phone and PC on the same Wi-Fi, with internet access for dependency installation and the first model download.
- A CPU is sufficient. The first backend startup downloads the model and may take longer than later startups. Wait for `Application startup complete` before counting.

## Start the backend (PowerShell terminal 1)

From the `people-counter` folder:

```powershell
cd .\backend
python -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

If PowerShell blocks activation, allow it for this terminal only and retry:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\venv\Scripts\Activate.ps1
```

Use the Python 3.11 installation when multiple Python versions are installed. The dependency `ultralytics-opencv-headless` is Ultralytics' headless distribution: it provides the same `ultralytics.YOLO` API without pulling in the GUI OpenCV package. Do not install `opencv-python` alongside `opencv-python-headless`. CPU-only Windows installs can reduce download size with:

```powershell
pip install torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
```

Health and interactive API documentation:

```powershell
Invoke-RestMethod http://localhost:8000/health
Start-Process http://localhost:8000/docs
```

Health returns `{"status":"ok","model_loaded":true}` once startup succeeds. Model loading happens once per process in FastAPI's lifespan. Inference runs in a threadpool with a lock protecting the shared YOLO predictor.

## Connect the phone

Find the PC's Wi-Fi adapter **IPv4 Address**:

```powershell
ipconfig
```

For example, if it is `192.168.1.100`, use `http://192.168.1.100:8000`. A physical phone cannot reach your PC using `localhost`. The Android emulator uses `http://10.0.2.2:8000`; an iOS simulator on a Mac uses that Mac's reachable server address.

Allow Python/port **8000** through Windows Defender Firewall on your private network. If needed, run the following in an **Administrator PowerShell**:

```powershell
New-NetFirewallRule -DisplayName "PeopleCounter API" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8000 -Profile Private
```

Open `http://YOUR_PC_LAN_IP:8000/health` in the phone's browser to verify connectivity. If it fails, check firewall rules, VPNs, Wi-Fi client isolation, and that Uvicorn binds to `0.0.0.0`.

## Start the mobile app (PowerShell terminal 2)

From the `people-counter` folder:

```powershell
cd .\mobile
Copy-Item .env.example .env
# Replace this example with the IPv4 address shown by ipconfig:
Set-Content .env 'EXPO_PUBLIC_API_URL=http://192.168.1.100:8000'
npm install
npx expo start
```

Scan the QR code using Expo Go on Android, or the Camera app on iOS. Grant camera/photo access when prompted. Select **Take Photo** or **Choose from Gallery**, review the preview, then tap **Count People**. **Try another** resets the result. Images are resized to at most 1280 pixels wide without upscaling and encoded as JPEG at 80% quality before upload. Server results use coordinates in the orientation-corrected image's pixel space.

Restart Expo after changing `.env` (use `npx expo start --clear` if necessary). `src/config.ts` reads `EXPO_PUBLIC_API_URL`; these values are public app configuration, so never put secrets there. Native HTTP access is intended for LAN development; use HTTPS for deployments. Custom native builds may need platform transport settings for local HTTP.

The upload client explicitly imports React Native's WHATWG/XHR fetch transport from `whatwg-fetch`. Expo SDK 58's default global `expo/fetch` rejects the React Native `{ uri, name, type }` multipart file object used by this app. The explicit import keeps uploads compatible even if the global fetch opt-out is not applied. `EXPO_PUBLIC_USE_RN_FETCH=1` is also set in the environment examples and EAS profiles. Fully reload the app after changing environment settings.

Native packages were selected with Expo's compatibility resolver. To reinstall/update compatible versions:

```powershell
npx expo install react react-native expo-image-picker expo-image-manipulator expo-status-bar react-native-safe-area-context
npx expo install typescript @types/react --dev
npm run typecheck
npx expo install --check
```

## Interface and interaction

The mobile app includes a persistent primary action, camera/gallery selection, photo replacement and removal, and an in-memory preview. Counting has separate preparation and detection states, elapsed time, and a cancel action that keeps the selected photo. Results include the count, actual model time and image size, original/detection comparison, and a fullscreen viewer with pinch, pan, zoom buttons, and reset. Errors keep the photo available for retry and scroll into view. Help is available from the header. Transitions honor the device's reduced-motion setting, and controls include accessibility labels.

For a browser preview of the same interface, run this from `mobile`:

```powershell
npx expo start --web
```

The browser uses a real Blob upload; Android and iOS keep the native URI multipart format. These UI changes and the browser preview dependencies do not require rebuilding an existing development APK.

## Android development build

The `development` profile in `mobile/eas.json` includes `expo-dev-client` and creates an installable Android APK. From `mobile`, sign in to your Expo account and start a cloud build:

```powershell
npx eas-cli@latest login
npx eas-cli@latest build --platform android --profile development
```

On the first run, follow the prompts to create/link the EAS project and generate Android signing credentials. Install the APK from the build's download link, then start Metro from `mobile`:

```powershell
npx expo start --dev-client --lan
```

Open the installed PeopleCounter development app and scan the Metro QR code. Keep the phone and PC on the same Wi-Fi and run the backend separately. The API URL comes from `mobile/.env`. JavaScript edits reload through Metro; changes to native dependencies require another development build. See [Expo's development build guide](https://docs.expo.dev/tutorial/eas/configure-development-build/).

## Tests (PowerShell)

In `backend`, with the virtual environment activated:

```powershell
pytest
```

The suite generates images in memory. API tests isolate inference while exercising validation, image decoding, EXIF rotation, annotation, confidence boundaries, CORS, and clean error responses. The integration test starts the real YOLOv8 model and performs inference on a generated blank image, downloading weights on the first run. For API-only tests without downloading weights:

```powershell
pytest -m "not integration"
```

Mobile validation in `mobile`:

```powershell
npm run typecheck
npm test
npx expo install --check
npx expo export --platform all --output-dir dist
```

Camera, permissions, LAN uploads, and result display should also be checked on Android and iOS devices.

Verified with Python 3.11.9 and Node 24.18.0: **26 backend tests and 7 client regression tests passed**, including real YOLOv8 inference, native URI uploads, browser Blob uploads, cancellation, timeouts, and actionable errors. TypeScript checks passed, and Android, iOS, and web bundles exported successfully. The updated UI was visually checked at 390 × 844 and 320 × 568, including a real gallery-to-result request, comparison, fullscreen zoom/reset, and scrollable help. Native-device visual checks and Docker were not run for this redesign. `npm audit` reports 12 upstream Expo toolchain advisories (1 low, 9 moderate, 2 high); the suggested major Expo downgrade was not applied.

This workspace also has a local Python 3.11 runtime with the backend dependencies installed at `..\..\.tools\python311\python.exe` (relative to `backend`). It can run the backend immediately without changing your system Python:

```powershell
cd C:\Users\aarju\Desktop\Assignment\people-counter\backend
..\..\.tools\python311\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

For a fresh checkout, follow the virtual environment setup above; the `.tools` runtime is local verification tooling and is not part of the project source.

## API

`POST /api/v1/count` expects a multipart field named `file`. Accepts JPEG, PNG, or WebP with matching file contents and MIME type, up to **10 MiB (10,485,760 bytes)**. Images above 25 million pixels are rejected before decoding. The optional `conf` query parameter accepts **0.1–0.9**, default **0.4**. Uploaded images are processed in memory and are not saved by the application.

Use `curl.exe` explicitly because Windows PowerShell may alias `curl` to a different command:

```powershell
curl.exe -X POST "http://localhost:8000/api/v1/count?conf=0.4" -F "file=@C:\Users\aarju\Pictures\group.jpg;type=image/jpeg"
```

The JSON response contains `count`, `detections` (`x1`, `y1`, `x2`, `y2`, `confidence`), `image_width`, `image_height`, `annotated_image` (base64 JPEG without a data-URL prefix), and `inference_ms` (model prediction time, excluding queue wait, decoding, and annotation). Annotation includes boxes and a `People: N` label.

Errors use JSON `detail`: 400 for unsupported/corrupt images, 413 for oversized files, 422 for missing input or invalid confidence, and 500 for processing failures. Full exceptions are logged on the server, never returned to the client. Counts are estimates and can miss occluded or distant people.

## Backend configuration

Copy `backend/.env.example` to `backend/.env`. Settings are loaded by `pydantic-settings` from the backend working directory:

| Setting | Default | Purpose |
| --- | --- | --- |
| `MODEL_PATH` | `yolov8n.pt` | Local weights path or auto-download model name |
| `CONFIDENCE_THRESHOLD` | `0.4` | Default detection confidence |
| `CORS_ORIGINS` | `["*"]` | JSON array of allowed browser origins |
| `MAX_UPLOAD_BYTES` | `10485760` | Maximum uploaded file size |
| `MAX_IMAGE_PIXELS` | `25000000` | Decoded-image safety limit |

For deployment, use HTTPS, restrict CORS, and add request limits/authentication appropriate to your environment. Model weights, local environment files, and generated outputs are ignored by Git. Review Ultralytics' license before distributing a commercial product.

## Docker (optional)

From `backend`, with Docker Desktop running:

```powershell
docker build -t people-counter-backend .
docker run --rm -p 8000:8000 --env-file .env people-counter-backend
```

The image uses Python 3.11 slim, headless OpenCV, `libgl1`, and `libglib2.0-0`, and runs as a non-root user. The model downloads on first container startup; restarting a newly created container downloads it again unless a model is supplied through a mounted volume.

## Project files

```text
people-counter/
  .gitignore
  README.md
  backend/
    .dockerignore
    .env.example
    Dockerfile
    requirements.txt
    pytest.ini
    app/
      __init__.py
      main.py
      config.py
      schemas.py
      api/
        __init__.py
        routes.py
      services/
        __init__.py
        detector.py
    tests/
      test_api.py
  mobile/
    .gitignore
    .easignore
    .env.example
    app.json
    eas.json
    package.json
    package-lock.json
    tsconfig.json
    index.ts
    App.tsx
    src/
      config.ts
      api/
        client.ts
      types/
        whatwg-fetch.d.ts
      ui/
        theme.ts
        Icon.tsx
        PhotoViewer.tsx
    tests/
      client.test.cjs
```

References: [Expo ImagePicker](https://docs.expo.dev/versions/latest/sdk/imagepicker/), [Expo ImageManipulator](https://docs.expo.dev/versions/latest/sdk/imagemanipulator/), [Ultralytics installation](https://docs.ultralytics.com/quickstart/).
