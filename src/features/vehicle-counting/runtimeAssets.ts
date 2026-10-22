// Vite emits the pinned runtime binary; load this module only when counting is requested.
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
export { wasmUrl };
