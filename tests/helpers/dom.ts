import { JSDOM } from 'jsdom';

/** Isolated DOM only: no resource loading, app bootstrap, location permission or live requests. */
export function installDom(url = 'https://fixture.test/?page=cameras') {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url, pretendToBeVisual: true });
  const before = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'PopStateEvent', 'FormData']) {
    before.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true, writable: true });
  }
  before.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true, writable: true });
  return { window: dom.window, document: dom.window.document, container: dom.window.document.getElementById('root')!,
    restore() {
      dom.window.close();
      for (const [key, descriptor] of before) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    } };
}
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export const settleDom = () => new Promise<void>(resolve => setImmediate(resolve));
