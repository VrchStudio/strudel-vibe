import { RangeSetBuilder, StateEffect, StateField, Prec } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';

export const setMiniLocations = StateEffect.define();
export const showMiniLocations = StateEffect.define();
export const updateMiniLocations = (view, locations) => {
  view.dispatch({ effects: setMiniLocations.of(locations) });
};
export const highlightMiniLocations = (view, atTime, haps) => {
  view.dispatch({ effects: showMiniLocations.of({ atTime, haps }) });
};

const miniLocations = StateField.define({
  create() {
    return Decoration.none;
  },
  update(locations, tr) {
    if (tr.docChanged) {
      locations = locations.map(tr.changes);
    }

    for (let e of tr.effects) {
      if (e.is(setMiniLocations)) {
        // this is called on eval, with the mini locations obtained from the transpiler
        // codemirror will automatically remap the marks when the document is edited
        // create a mark for each mini location, adding the range to the spec to find it later
        const marks = e.value
          .filter(([from]) => from < tr.newDoc.length)
          .map(([from, to]) => [from, Math.min(to, tr.newDoc.length)])
          .map(
            (range) =>
              Decoration.mark({
                id: range.join(':'),
                // this green is only to verify that the decoration moves when the document is edited
                // it will be removed later, so the mark is not visible by default
                attributes: { style: `background-color: #00CA2880` },
              }).range(...range), // -> Decoration
          );

        locations = Decoration.set(marks, true); // -> DecorationSet === RangeSet<Decoration>
      }
    }

    return locations;
  },
});

const visibleMiniLocations = StateField.define({
  create() {
    return { atTime: 0, haps: new Map(), connectors: [] };
  },
  update(visible, tr) {
    for (let e of tr.effects) {
      if (e.is(showMiniLocations)) {
        // this is called every frame to show the locations that are currently active
        // we can NOT create new marks because the context.locations haven't changed since eval time
        // this is why we need to find a way to update the existing decorations, showing the ones that have an active range
        const haps = new Map();
        const connectorMap = new Map();
        for (let hap of e.value.haps) {
          if (!hap.context?.locations || !hap.whole) {
            continue;
          }
          const uniqueIds = [];
          for (let { start, end } of hap.context.locations) {
            let id = `${start}:${end}`;
            if (!haps.has(id) || haps.get(id).whole.begin.lt(hap.whole.begin)) {
              haps.set(id, hap);
            }
            if (!uniqueIds.includes(id)) {
              uniqueIds.push(id);
            }
          }
          for (let i = 0; i < uniqueIds.length - 1; i++) {
            const key = `${uniqueIds[i]}->${uniqueIds[i + 1]}`;
            const existing = connectorMap.get(key);
            if (!existing || existing.hap.whole.begin.lt(hap.whole.begin)) {
              connectorMap.set(key, { fromId: uniqueIds[i], toId: uniqueIds[i + 1], hap });
            }
          }
        }
        visible = {
          atTime: e.value.atTime,
          haps,
          connectors: Array.from(connectorMap.values()).map(({ fromId, toId }) => ({ fromId, toId })),
        };
      }
    }

    return visible;
  },
});

// // Derive the set of decorations from the miniLocations and visibleLocations
const miniLocationHighlights = EditorView.decorations.compute([miniLocations, visibleMiniLocations], (state) => {
  const iterator = state.field(miniLocations).iter();
  const { haps } = state.field(visibleMiniLocations);
  const builder = new RangeSetBuilder();

  while (iterator.value) {
    const {
      from,
      to,
      value: {
        spec: { id },
      },
    } = iterator;

    if (haps.has(id)) {
      const hap = haps.get(id);
      const color = hap.value?.color ?? 'var(--foreground)';
      const style = hap.value?.markcss || `outline: solid 2px ${color}`;
      // Get explicit channels for color values
      /* 
      const swatch = document.createElement('div');
      swatch.style.color = color;
      document.body.appendChild(swatch);
      let channels = getComputedStyle(swatch)
        .color.match(/^rgba?\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})(?:,\s*(\d*(?:\.\d+)?))?\)$/)
        .slice(1)
        .map((c) => parseFloat(c || 1));
      document.body.removeChild(swatch);

      // Get percentage of event
      const percent = 1 - (atTime - hap.whole.begin) / hap.whole.duration;
      channels[3] *= percent;
      */

      builder.add(
        from,
        to,
        Decoration.mark({
          // attributes: { style: `outline: solid 2px rgba(${channels.join(', ')})` },
          attributes: { style, 'data-mini-highlight-id': id },
        }),
      );
    }

    iterator.next();
  }

  return builder.finish();
});

const escapeSelector = (value) => {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
};

const canUseDOM = typeof document !== 'undefined';

const highlightConnectorPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view;
      this.svg = null;
      this.raf = null;
      this.onScroll = null;
      if (!canUseDOM) {
        return;
      }
      this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.svg.setAttribute('class', 'cm-highlight-connectors');
      Object.assign(this.svg.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: `${view.scrollDOM.scrollWidth}px`,
        height: `${view.scrollDOM.scrollHeight}px`,
        pointerEvents: 'none',
        overflow: 'visible',
        zIndex: '2',
      });
      this.svg.setAttribute('preserveAspectRatio', 'none');
      view.scrollDOM.style.position = view.scrollDOM.style.position || 'relative';
      view.scrollDOM.appendChild(this.svg);
      this.onScroll = () => {
        if (this.raf != null) {
          return;
        }
        this.raf = requestAnimationFrame(() => {
          this.raf = null;
          this.draw();
        });
      };
      view.scrollDOM.addEventListener('scroll', this.onScroll);
      this.draw();
    }

    update(update) {
      if (!canUseDOM || !this.svg) {
        return;
      }
      const prev = update.startState.field(visibleMiniLocations, false);
      const next = update.state.field(visibleMiniLocations, false);
      if (prev !== next || update.docChanged || update.viewportChanged || update.geometryChanged) {
        this.draw();
      }
    }

    destroy() {
      if (!canUseDOM || !this.svg) {
        return;
      }
      this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
      if (this.raf != null) {
        cancelAnimationFrame(this.raf);
      }
      this.svg.remove();
    }

    findNode(id) {
      if (!canUseDOM) {
        return null;
      }
      const selector = `[data-mini-highlight-id="${escapeSelector(id)}"]`;
      return this.view.dom.querySelector(selector);
    }

    draw() {
      if (!canUseDOM || !this.svg) {
        return;
      }
      const state = this.view.state.field(visibleMiniLocations, false);
      if (!state) {
        this.svg.replaceChildren();
        return;
      }
      const { connectors } = state;
      const scrollDOM = this.view.scrollDOM;
      const scrollRect = scrollDOM.getBoundingClientRect();
      const scrollLeft = scrollDOM.scrollLeft;
      const scrollTop = scrollDOM.scrollTop;
      const width = scrollDOM.scrollWidth;
      const height = scrollDOM.scrollHeight;
      this.svg.setAttribute('width', width);
      this.svg.setAttribute('height', height);
      this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      this.svg.style.width = `${width}px`;
      this.svg.style.height = `${height}px`;
      const fragment = document.createDocumentFragment();
      for (let { fromId, toId } of connectors) {
        const fromNode = this.findNode(fromId);
        const toNode = this.findNode(toId);
        if (!fromNode || !toNode) {
          continue;
        }
        const fromRect = fromNode.getBoundingClientRect();
        const toRect = toNode.getBoundingClientRect();
        const x1 = fromRect.right - scrollRect.left + scrollLeft;
        const y1 = fromRect.bottom - scrollRect.top + scrollTop;
        const x2 = toRect.left - scrollRect.left + scrollLeft;
        const y2 = toRect.top - scrollRect.top + scrollTop;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        const targetStyle = getComputedStyle(toNode);
        let stroke = targetStyle.outlineColor;
        if (!stroke || stroke === 'invert' || stroke === 'transparent' || stroke === 'rgba(0, 0, 0, 0)') {
          const sourceStyle = getComputedStyle(fromNode);
          stroke = sourceStyle.outlineColor;
        }
        if (!stroke || stroke === 'invert' || stroke === 'transparent' || stroke === 'rgba(0, 0, 0, 0)') {
          stroke = 'var(--foreground)';
        }
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', stroke);
        line.setAttribute('stroke-width', '1.5');
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('stroke-opacity', '0.85');
        fragment.appendChild(line);
      }
      this.svg.replaceChildren(fragment);
    }
  },
);

export const highlightExtension = [miniLocations, visibleMiniLocations, miniLocationHighlights, highlightConnectorPlugin];

export const isPatternHighlightingEnabled = (on, config) => {
  on &&
    config &&
    setTimeout(() => {
      updateMiniLocations(config.editor, config.miniLocations);
    }, 100);
  return on ? Prec.highest(highlightExtension) : [];
};
