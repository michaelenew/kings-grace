// Tiny DOM helpers. No framework, no build step.

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(node, ...children) {
  clear(node).append(...children.filter(Boolean));
  return node;
}

export function select(options, value, onchange, attrs = {}) {
  const node = el('select', { ...attrs, onchange: (e) => onchange(e.target.value) });
  for (const opt of options) {
    node.append(el('option', { value: opt.value, selected: String(opt.value) === String(value) }, opt.label));
  }
  return node;
}

export function number(value, min, max, onchange, attrs = {}) {
  return el('input', {
    type: 'number', value, min, max, ...attrs,
    oninput: (e) => onchange(Math.max(min, Math.min(max, Number(e.target.value) || min))),
  });
}
