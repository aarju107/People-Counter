const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const result = {
  count: 2,
  detections: [],
  image_width: 800,
  image_height: 600,
  annotated_image: "jpeg-data",
  inference_ms: 42,
};
const compiledClient = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../src/api/client.ts"), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

function setup({ platform = "android", mode = "success", status = 200 } = {}) {
  const requests = [];
  class NativeFormData {
    constructor() {
      this.parts = [];
    }
    append(name, value) {
      this.parts.push([name, value]);
    }
  }
  const Form = platform === "web" ? FormData : NativeFormData;
  class XHR {
    constructor() {
      this.headers = {};
      this.status = status;
      this.statusText = "OK";
    }
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    }
    getAllResponseHeaders() {
      return "content-type: application/json";
    }
    send(body) {
      requests.push({ body, url: this.url, headers: this.headers, xhr: this });
      if (mode === "pending" || mode === "timeout") return;
      if (this.url.startsWith("data:")) {
        this.response = new Blob(["test image bytes"], { type: "image/jpeg" });
      } else {
        this.responseText = mode === "invalid" ? "{}" : JSON.stringify(result);
      }
      setTimeout(
        () => (mode === "offline" ? this.onerror() : this.onload()),
        0,
      );
    }
    abort() {
      this.aborted = true;
      this.onabort();
    }
  }
  const transport = { exports: {} };
  const context = {
    exports: transport.exports,
    module: transport,
    FormData: Form,
    XMLHttpRequest: XHR,
    Blob,
    FileReader: class {},
    AbortController,
    DOMException,
    setTimeout,
    clearTimeout,
    // A regression guard: native uploads must not use Expo's global fetch.
    fetch: () => {
      throw new Error("Unsupported FormDataPart implementation");
    },
  };
  vm.runInNewContext(
    fs.readFileSync(require.resolve("whatwg-fetch"), "utf8"),
    context,
  );
  const client = { exports: {} };
  vm.runInNewContext(compiledClient, {
    exports: client.exports,
    module: client,
    FormData: Form,
    AbortController,
    __DEV__: false,
    require: (name) =>
      name === "whatwg-fetch"
        ? transport.exports
        : name === "react-native"
          ? { Platform: { OS: platform } }
          : { API_BASE_URL: "http://192.168.1.100:8000" },
    setTimeout: (callback, delay) =>
      setTimeout(callback, mode === "timeout" && delay === 30_000 ? 5 : delay),
    clearTimeout,
  });
  return { ...client.exports, requests };
}

test("native upload preserves the URI file object and lets XHR set the boundary", async () => {
  const client = setup();
  assert.equal((await client.countPeople("file:///photo.jpg")).count, 2);
  const request = client.requests[0];
  assert.equal(request.url, "http://192.168.1.100:8000/api/v1/count");
  assert.equal(request.body.parts[0][0], "file");
  assert.equal(request.body.parts[0][1].uri, "file:///photo.jpg");
  assert.equal(request.body.parts[0][1].name, "people-counter.jpg");
  assert.equal(request.body.parts[0][1].type, "image/jpeg");
  assert.equal(request.headers["content-type"], undefined);
});

test("web upload converts the prepared URI into an actual image Blob", async () => {
  const client = setup({ platform: "web" });
  assert.equal(
    (await client.countPeople("data:image/jpeg;base64,dGVzdA==")).count,
    2,
  );
  const request = client.requests[1];
  assert.equal(request.body.get("file").name, "people-counter.jpg");
  assert.equal(request.body.get("file").type, "image/jpeg");
  assert.equal(await request.body.get("file").text(), "test image bytes");
  assert.equal(request.headers["content-type"], undefined);
});

test("canceling an in-flight count aborts the native request", async () => {
  const client = setup({ mode: "pending" });
  const controller = new AbortController();
  const promise = client.countPeople("file:///photo.jpg", controller.signal);
  controller.abort();
  await assert.rejects(promise, /Counting canceled/);
  assert.equal(client.requests[0].xhr.aborted, true);
});

test("an already canceled operation does not upload a photo", async () => {
  const client = setup();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    client.countPeople("file:///photo.jpg", controller.signal),
    /Counting canceled/,
  );
  assert.equal(client.requests.length, 0);
});

test("the external abort listener is removed after success", async () => {
  const client = setup();
  const controller = new AbortController();
  await client.countPeople("file:///photo.jpg", controller.signal);
  controller.abort();
  assert.equal(client.requests[0].xhr.aborted, undefined);
});

test("a timeout has its own message rather than looking like user cancellation", async () => {
  const client = setup({ mode: "timeout" });
  await assert.rejects(
    client.countPeople("file:///photo.jpg"),
    /longer than 30 seconds/,
  );
});

test("offline, oversized, server, and malformed responses remain actionable", async () => {
  for (const [options, message] of [
    [{ mode: "offline" }, /Cannot reach/],
    [{ status: 413 }, /too large/],
    [{ status: 500 }, /server could not analyze/],
    [{ mode: "invalid" }, /unexpected result/],
  ]) {
    await assert.rejects(
      setup(options).countPeople("file:///photo.jpg"),
      message,
    );
  }
});
