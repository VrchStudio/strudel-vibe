/*
 * web-midi-polyfill.iife.js — Strudel VibeLive iOS
 *
 * Self-contained, dependency-free Web MIDI API polyfill backed by CoreMIDI
 * through the Capacitor `NativeMIDI` plugin.
 *
 * WHY: WKWebView / Mobile Safari on iOS does not implement the Web MIDI API.
 * Strudel's MIDI stack (`@strudel/midi` → WebMidi.js) only needs one entry
 * point — `navigator.requestMIDIAccess()` — so by providing a faithful
 * implementation of that global the *entire* existing MIDI feature set
 * (input CC → slider mapping, and `.midi()` output) works unchanged.
 *
 * THIS FILE IS THE SINGLE SOURCE OF TRUTH. It is:
 *   - shipped in the JS workspace as `@strudel/iosbridge/web-midi-polyfill.iife.js`
 *   - copied to `ios/native/NativeMIDI/web-midi-polyfill.js` (via
 *     `pnpm ios:sync-polyfill`) and injected into the WKWebView at startup by
 *     `NativeMIDIPlugin.load()` — so no website/ or packages/ code is touched.
 *
 * The native plugin contract (Capacitor `NativeMIDI`):
 *   methods (all return Promises):
 *     requestAccess({ sysex })  -> { ports: Port[] }
 *     listPorts()               -> { ports: Port[] }
 *     send({ id, data, timestamp })   data = number[] of MIDI bytes
 *     openPort({ id }) / closePort({ id })
 *     showBluetoothCentral()    -> presents CABTMIDICentralViewController
 *   events:
 *     'statechange' -> { ports: Port[] }
 *     'midimessage' -> { id, data: number[], timeStamp }
 *   Port = { id, name, manufacturer, version, type: 'input'|'output', state }
 */
(function installNativeWebMIDI() {
  'use strict';

  var Cap = typeof window !== 'undefined' ? window.Capacitor : undefined;
  // Only activate inside the native iOS app. On web/desktop this is a no-op so
  // the branch stays a pure wrapper (real Web MIDI is used everywhere else).
  if (!Cap || (Cap.getPlatform && Cap.getPlatform() !== 'ios')) {
    return;
  }
  // Don't clobber a real implementation if one ever appears.
  if (navigator.requestMIDIAccess && navigator.__nativeMIDIInstalled) {
    return;
  }

  // Resolve the native plugin LAZILY. This polyfill is injected at document-start,
  // which is BEFORE Capacitor's full JS runtime loads — so neither
  // Cap.registerPlugin nor Cap.Plugins.NativeMIDI exists yet at this point. We
  // therefore only DEFINE navigator.requestMIDIAccess now and look up the plugin
  // when it is actually called (when the user enables MIDI), by which time the
  // Capacitor runtime is fully initialised. The resolved handle is cached.
  var _nativeMIDI = null;
  function getNativeMIDI() {
    if (_nativeMIDI) return _nativeMIDI;
    var c = window.Capacitor;
    if (!c) return null;
    if (typeof c.registerPlugin === 'function') {
      _nativeMIDI = c.registerPlugin('NativeMIDI');
    } else if (c.Plugins && c.Plugins.NativeMIDI) {
      _nativeMIDI = c.Plugins.NativeMIDI;
    }
    return _nativeMIDI;
  }

  // --- minimal EventTarget-backed MIDIPort/MIDIInput/MIDIOutput ---------------

  function MIDIPort(access, info) {
    this._access = access;
    this.id = String(info.id);
    this.manufacturer = info.manufacturer || '';
    this.name = info.name || '';
    this.version = info.version || '';
    this.type = info.type; // 'input' | 'output'
    this.state = info.state || 'connected'; // 'connected' | 'disconnected'
    this.connection = 'closed'; // 'open' | 'closed' | 'pending'
    this.onstatechange = null;
    this._listeners = {};
  }
  MIDIPort.prototype.addEventListener = function (type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  };
  MIDIPort.prototype.removeEventListener = function (type, fn) {
    var arr = this._listeners[type];
    if (!arr) return;
    var i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  };
  MIDIPort.prototype.dispatchEvent = function (event) {
    var arr = (this._listeners[event.type] || []).slice();
    for (var i = 0; i < arr.length; i++) {
      try {
        arr[i].call(this, event);
      } catch (e) {
        console.error('[iosbridge] listener error', e);
      }
    }
    var on = this['on' + event.type];
    if (typeof on === 'function') {
      try {
        on.call(this, event);
      } catch (e2) {
        console.error('[iosbridge] on-handler error', e2);
      }
    }
    return true;
  };
  MIDIPort.prototype.open = function () {
    var self = this;
    this.connection = 'pending';
    return getNativeMIDI().openPort({ id: this.id })
      .then(function () {
        self.connection = 'open';
        return self;
      })
      .catch(function () {
        // Treat as soft-open: CoreMIDI inputs are already connected by the
        // native side, so we still report 'open' to satisfy WebMidi.js.
        self.connection = 'open';
        return self;
      });
  };
  MIDIPort.prototype.close = function () {
    var self = this;
    return getNativeMIDI().closePort({ id: this.id })
      .catch(function () {})
      .then(function () {
        self.connection = 'closed';
        return self;
      });
  };

  function MIDIInput(access, info) {
    MIDIPort.call(this, access, info);
    this.onmidimessage = null;
  }
  MIDIInput.prototype = Object.create(MIDIPort.prototype);
  MIDIInput.prototype.constructor = MIDIInput;

  function MIDIOutput(access, info) {
    MIDIPort.call(this, access, info);
  }
  MIDIOutput.prototype = Object.create(MIDIPort.prototype);
  MIDIOutput.prototype.constructor = MIDIOutput;
  MIDIOutput.prototype.send = function (data, timestamp) {
    var bytes = data instanceof Uint8Array ? Array.prototype.slice.call(data) : data;
    // timestamp is a DOMHighResTimeStamp (ms, performance.now base) or 0/undefined
    return getNativeMIDI().send({ id: this.id, data: bytes, timestamp: timestamp || 0 }).catch(function (e) {
      console.error('[iosbridge] send failed', e);
    });
  };
  MIDIOutput.prototype.clear = function () {
    /* no-op: native side does not queue */
  };

  // --- MIDIAccess -------------------------------------------------------------

  function MIDIAccess(sysexEnabled) {
    this.inputs = new Map();
    this.outputs = new Map();
    this.sysexEnabled = !!sysexEnabled;
    this.onstatechange = null;
    this._listeners = {};
  }
  MIDIAccess.prototype.addEventListener = MIDIPort.prototype.addEventListener;
  MIDIAccess.prototype.removeEventListener = MIDIPort.prototype.removeEventListener;
  MIDIAccess.prototype.dispatchEvent = MIDIPort.prototype.dispatchEvent;

  MIDIAccess.prototype._upsertPort = function (info) {
    var map = info.type === 'input' ? this.inputs : this.outputs;
    var existing = map.get(String(info.id));
    if (existing) {
      existing.state = info.state || 'connected';
      return { port: existing, isNew: false };
    }
    var port = info.type === 'input' ? new MIDIInput(this, info) : new MIDIOutput(this, info);
    map.set(port.id, port);
    return { port: port, isNew: true };
  };

  MIDIAccess.prototype._syncPorts = function (ports) {
    var seen = {};
    for (var i = 0; i < ports.length; i++) {
      var info = ports[i];
      seen[info.type + ':' + info.id] = true;
      var res = this._upsertPort(info);
      if (res.isNew || res.port.state !== 'connected') {
        res.port.state = info.state || 'connected';
        this._emitStateChange(res.port);
      }
    }
    // Mark missing ports disconnected.
    var self = this;
    [this.inputs, this.outputs].forEach(function (map) {
      map.forEach(function (port) {
        if (!seen[port.type + ':' + port.id] && port.state !== 'disconnected') {
          port.state = 'disconnected';
          self._emitStateChange(port);
        }
      });
    });
  };

  MIDIAccess.prototype._emitStateChange = function (port) {
    var event = { type: 'statechange', port: port, target: this };
    // notify the port's own statechange handler
    var portEvent = { type: 'statechange', port: port, target: port };
    port.dispatchEvent(portEvent);
    // notify access-level handler (WebMidi.js listens here)
    this.dispatchEvent(event);
  };

  // --- wire native events -----------------------------------------------------

  function attach(access) {
    getNativeMIDI().addListener('statechange', function (payload) {
      access._syncPorts((payload && payload.ports) || []);
    });

    getNativeMIDI().addListener('midimessage', function (payload) {
      if (!payload) return;
      var input = access.inputs.get(String(payload.id));
      if (!input) return;
      // WebMidi.js's handler reads ONLY event.data (a Uint8Array) and
      // event.timeStamp. Deliver a PLAIN object — a real DOM Event won't let us
      // attach a `.data` property reliably (and its timeStamp is read-only), so
      // the consumer would see `undefined` and throw on `.slice()`.
      var event = {
        type: 'midimessage',
        target: input,
        currentTarget: input,
        data: new Uint8Array(payload.data || []),
        // performance.now()-based timestamp, matching the Web MIDI contract.
        timeStamp: typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(),
        receivedTime: payload.timeStamp,
      };
      input.dispatchEvent(event);
    });
  }

  // --- the polyfilled global --------------------------------------------------

  navigator.requestMIDIAccess = function requestMIDIAccess(options) {
    var sysex = !!(options && options.sysex);
    return getNativeMIDI().requestAccess({ sysex: sysex }).then(function (result) {
      var access = new MIDIAccess(sysex);
      attach(access);
      access._syncPorts((result && result.ports) || []);
      return access;
    });
  };
  navigator.__nativeMIDIInstalled = true;

  // Expose for debugging / manual Bluetooth pairing from the UI if desired.
  window.StrudelNativeMIDI = {
    getPlugin: getNativeMIDI,
    showBluetoothCentral: function () {
      return getNativeMIDI().showBluetoothCentral();
    },
  };

  console.log('[iosbridge] native Web MIDI polyfill installed (CoreMIDI)');
})();
