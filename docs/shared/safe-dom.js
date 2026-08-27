(() => {
  'use strict';

  const SAFE_ATTRIBUTE = /^(?:aria-[a-z0-9-]+|data-[a-z0-9-]+|class|id|role|title|type|name|for)$/i;
  const TAG_NAME = /^[a-z][a-z0-9-]*$/i;

  function create(tagName, { className, text, attrs } = {}) {
    if (!TAG_NAME.test(tagName)) throw new TypeError('Unsafe element name');
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    if (attrs) {
      for (const [name, value] of Object.entries(attrs)) {
        if (!SAFE_ATTRIBUTE.test(name)) throw new TypeError(`Unsafe attribute: ${name}`);
        element.setAttribute(name, String(value));
      }
    }
    return element;
  }

  function replaceChildren(target, ...children) {
    target.replaceChildren(...children.filter(Boolean));
  }

  function listItems(items) {
    return items.map((item) => create('li', { text: item }));
  }

  function randomToken(length = 12) {
    if (!globalThis.crypto?.getRandomValues) {
      throw new Error('A secure random source is required for mandate identifiers');
    }
    const bytes = new Uint8Array(Math.ceil(length / 2));
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, length).toUpperCase();
  }

  globalThis.VerifyFirstSafeDom = Object.freeze({ create, replaceChildren, listItems, randomToken });
})();
