// Worker: full-resolution pixel pass plus PNG encoding, off the main thread.
import { parentPort } from "node:worker_threads";
import { process as runPipeline, histogram } from "../pixels.mjs";
import { encodePng } from "../png.mjs";

parentPort.on("message", (job) => {
  try {
    const t0 = performance.now();
    const { width, height, ops } = job;
    const pixels = new Uint8ClampedArray(job.buffer);
    const out = runPipeline(pixels, width, height, ops);
    const processMs = performance.now() - t0;

    const t1 = performance.now();
    const png = encodePng(out, width, height, ops.level ?? 6);
    const encodeMs = performance.now() - t1;

    parentPort.postMessage(
      {
        ok: true,
        png: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
        bytes: png.byteLength,
        processMs: +processMs.toFixed(1),
        encodeMs: +encodeMs.toFixed(1),
        histogram: ops.wantHistogram ? histogram(out) : null
      },
      []
    );
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err.message });
  }
});
