//
//  IOSDefaultsPlugin.swift
//  Strudel VibeLive iOS
//
//  Seeds first-launch UI defaults that better fit the iPhone (a vertical,
//  touch-first screen) than the web/desktop defaults. It writes directly into
//  the web app's persisted settings store BEFORE the page loads, and only for
//  keys that are still unset — so it never overrides a choice the user makes
//  later, and the website/ code stays untouched (pure wrapper).
//
//  How it works:
//    - Strudel persists settings with @nanostores/persistent under the prefix
//      'strudel-settings'. Each setting is stored at key `prefix + name` with a
//      raw (identity-encoded) string value. So `panelPosition` lives at
//      localStorage['strudel-settingspanelPosition'].
//    - This plugin's load() runs during Capacitor's registerPlugins(), which
//      happens before the WebView navigates (loadWebView()). Adding a
//      WKUserScript at .atDocumentStart therefore runs before the web app reads
//      its settings on first launch.
//
//  To add another iOS default: add one entry to `firstLaunchDefaults`.
//
//  Add this file (and IOSDefaultsPlugin.m) to the App target. The
//  integrate-ios-target.rb script does this automatically. See docs/ios-setup.md.
//
import Foundation
import Capacitor
import WebKit

@objc(IOSDefaultsPlugin)
public class IOSDefaultsPlugin: CAPPlugin {

    /// Persistence prefix used by Strudel's settingsMap (see website/src/settings.mjs).
    private static let settingsPrefix = "strudel-settings"

    /// First-launch UI defaults, keyed by the setting name (NOT the storage key).
    /// Values are raw strings, matching @nanostores/persistent's identity encoding.
    ///
    /// panelPosition = 'bottom' fits the iPhone's vertical screen better than the
    /// web default of 'right'.
    private static let firstLaunchDefaults: [String: String] = [
        "panelPosition": "bottom",
    ]

    public override func load() {
        seedFirstLaunchDefaults()
    }

    private func seedFirstLaunchDefaults() {
        guard let userContentController = bridge?.webView?.configuration.userContentController else {
            CAPLog.print("[IOSDefaults] no userContentController; cannot seed defaults")
            return
        }
        guard !Self.firstLaunchDefaults.isEmpty else { return }

        // Build a JS object of { storageKey: value } and seed each only if unset.
        var pairs: [String] = []
        for (name, value) in Self.firstLaunchDefaults {
            let storageKey = Self.settingsPrefix + name
            pairs.append("\(jsString(storageKey)): \(jsString(value))")
        }
        let defaultsLiteral = "{ \(pairs.joined(separator: ", ")) }"

        let js = """
        (function () {
          try {
            var defaults = \(defaultsLiteral);
            for (var k in defaults) {
              if (localStorage.getItem(k) == null) { localStorage.setItem(k, defaults[k]); }
            }
          } catch (e) {}
        })();
        """

        let script = WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        userContentController.addUserScript(script)
    }

    /// JSON-encode a string so it is safe to embed in the generated JS source.
    private func jsString(_ value: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: [value], options: [])) ?? Data()
        let arrayLiteral = String(data: data, encoding: .utf8) ?? "[\"\"]"
        // Strip the surrounding [ ] to get just the quoted string.
        return String(arrayLiteral.dropFirst().dropLast())
    }
}
