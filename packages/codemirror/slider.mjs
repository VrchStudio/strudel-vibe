import { ref, pure } from '@strudel/core';
import { WidgetType, ViewPlugin, Decoration } from '@codemirror/view';
import { StateEffect } from '@codemirror/state';

export let sliderValues = {};
const getSliderID = (from) => `slider_${from}`;
const sliderControls = new Map();
const sliderControlListeners = new Set();

function asNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeRangeValue(value, min = 0, max = 1) {
  if (min === max) {
    return 0;
  }
  return (value - min) / (max - min);
}

function clamp(value, min, max) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Math.min(high, Math.max(low, value));
}

function decimalPlaces(value) {
  const str = String(value);
  if (str.includes('e-')) {
    return Number(str.split('e-')[1]);
  }
  return str.includes('.') ? str.split('.')[1].length : 0;
}

function quantize(value, min, step) {
  const stepValue = Number(step);
  if (!Number.isFinite(stepValue) || stepValue <= 0) {
    return value;
  }
  const places = Math.min(12, Math.max(decimalPlaces(stepValue), decimalPlaces(min)));
  return Number((Math.round((value - min) / stepValue) * stepValue + min).toFixed(places));
}

function emitSliderControlsChange() {
  const controls = getSliderControls();
  sliderControlListeners.forEach((listener) => listener(controls));
}

function emitSliderChange(control, source) {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(
    new CustomEvent('strudel:slider-change', {
      detail: {
        id: control.id,
        name: control.name,
        value: control.value,
        normalized: normalizeRangeValue(control.value, control.min, control.max),
        source,
      },
    }),
  );
}

function registerSliderControl(control) {
  const previous = sliderControls.get(control.id);
  const next = {
    ...previous,
    ...control,
    value: sliderValues[control.id] ?? control.value,
  };
  sliderControls.set(control.id, next);
  emitSliderControlsChange();
  return next;
}

function unregisterSliderControl(id, input) {
  const control = sliderControls.get(id);
  if (!control || (input && control.input !== input)) {
    return;
  }
  sliderControls.delete(id);
  emitSliderControlsChange();
}

export function getSliderControls() {
  return Array.from(sliderControls.values())
    .sort((a, b) => a.from - b.from)
    .map(({ input, ...control }) => ({ ...control }));
}

export function subscribeSliderControls(listener) {
  sliderControlListeners.add(listener);
  listener(getSliderControls());
  return () => sliderControlListeners.delete(listener);
}

export function setSliderRuntimeValue(id, value, options = {}) {
  const { source = 'external', updateDom = true } = options;
  const control = sliderControls.get(id);
  const min = asNumber(control?.min, 0);
  const max = asNumber(control?.max, 1);
  const step = control?.step;
  const next = quantize(clamp(asNumber(value, sliderValues[id] ?? min), min, max), min, step);

  sliderValues[id] = next;

  if (control) {
    control.value = next;
    if (updateDom && control.input) {
      control.input.value = String(next);
    }
    emitSliderChange(control, source);
  }

  return next;
}

export class SliderWidget extends WidgetType {
  constructor(value, min, max, from, to, step, view, name) {
    super();
    this.value = value;
    this.min = min;
    this.max = max;
    this.from = from;
    this.originalFrom = from;
    this.to = to;
    this.step = step;
    this.view = view;
    this.name = name;
    this.id = getSliderID(this.originalFrom);
  }

  eq() {
    return false;
  }

  toDOM() {
    let wrap = document.createElement('span');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.className = 'cm-slider'; // inline-flex items-center
    let slider = wrap.appendChild(document.createElement('input'));
    slider.type = 'range';
    slider.min = this.min;
    slider.max = this.max;
    slider.step = this.step ?? (this.max - this.min) / 1000;
    slider.originalValue = this.value;
    // to make sure the code stays in sync, let's save the original value
    // becuase .value automatically clamps values so it'll desync with the code
    slider.value = slider.originalValue;
    slider.from = this.from;
    slider.originalFrom = this.originalFrom;
    slider.to = this.to;
    slider.dataset.sliderId = this.id;
    if (this.name) {
      slider.dataset.sliderName = this.name;
      slider.title = this.name;
    }
    slider.style = 'width:64px;margin-right:4px;transform:translateY(4px)';
    this.slider = slider;
    const control = registerSliderControl({
      id: this.id,
      name: this.name,
      value: Number(slider.value),
      min: Number(slider.min),
      max: Number(slider.max),
      step: Number(slider.step),
      from: this.originalFrom,
      input: slider,
    });
    slider.value = String(control.value);
    slider.addEventListener('input', (e) => {
      const next = e.target.value;
      let insert = next;
      //let insert = next.toFixed(2);
      const to = slider.from + slider.originalValue.length;
      let change = { from: slider.from, to, insert };
      slider.originalValue = insert;
      slider.value = insert;
      this.view.dispatch({ changes: change });
      setSliderRuntimeValue(this.id, Number(next), { source: 'mouse', updateDom: false });
    });
    return wrap;
  }

  destroy() {
    unregisterSliderControl(this.id, this.slider);
  }

  ignoreEvent(e) {
    return true;
  }
}

export const setSliderWidgets = StateEffect.define();

export const updateSliderWidgets = (view, widgets) => {
  view.dispatch({ effects: setSliderWidgets.of(widgets) });
};

function getSliders(widgetConfigs, view) {
  return widgetConfigs
    .filter((w) => w.type === 'slider')
    .map(({ from, to, value, min, max, step, name }) => {
      return Decoration.widget({
        widget: new SliderWidget(value, min, max, from, to, step, view, name),
        side: 0,
      }).range(from /* , to */);
    });
}

export const sliderPlugin = ViewPlugin.fromClass(
  class {
    decorations; //: DecorationSet

    constructor(view /* : EditorView */) {
      this.decorations = Decoration.set([]);
    }

    update(update /* : ViewUpdate */) {
      update.transactions.forEach((tr) => {
        if (tr.docChanged) {
          this.decorations = this.decorations.map(tr.changes);
          const iterator = this.decorations.iter();
          while (iterator.value) {
            // when the widgets are moved, we need to tell the dom node the current position
            // this is important because the updateSliderValue function has to work with the dom node
            if (iterator.value?.widget?.slider) {
              iterator.value.widget.slider.from = iterator.from;
              iterator.value.widget.slider.to = iterator.to;
            }
            iterator.next();
          }
        }
        for (let e of tr.effects) {
          if (e.is(setSliderWidgets)) {
            this.decorations = Decoration.set(getSliders(e.value, update.view));
          }
        }
      });
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

/**
 * Displays a slider widget to allow the user manipulate a value
 *
 * @name slider
 * @param {number|string} value Initial value, or a MIDI-targetable slider name when the next argument is a number
 * @param {number} min Minimum value - optional, defaults to 0
 * @param {number} max Maximum value - optional, defaults to 1
 * @param {number} step Step size - optional
 */
export let slider = (value, namedValue) => {
  console.warn('slider will only work when the transpiler is used... passing value as is');
  return pure(typeof value === 'string' ? namedValue : value);
};
// function transpiled from slider = (value, min, max)
export let sliderWithID = (id, nameOrValue, valueOrMin, minOrMax, maxOrStep) => {
  let value = nameOrValue;
  let min = valueOrMin;
  let max = minOrMax;
  if (typeof nameOrValue === 'string' || nameOrValue === null) {
    value = valueOrMin;
    min = minOrMax;
    max = maxOrStep;
  }
  sliderValues[id] = value; // sync state at eval time (code -> state)
  return ref(() => sliderValues[id]); // use state at query time
};
// update state when sliders are moved
if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    if (e.data.type === 'cm-slider') {
      if (sliderValues[e.data.id] !== undefined) {
        // update state when slider is moved
        setSliderRuntimeValue(e.data.id, e.data.value, { source: e.data.source ?? 'message' });
      } else {
        console.warn(`slider with id "${e.data.id}" is not registered. Only ${Object.keys(sliderValues)}`);
      }
    }
  });
}
