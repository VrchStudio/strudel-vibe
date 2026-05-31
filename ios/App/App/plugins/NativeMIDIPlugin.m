//
//  NativeMIDIPlugin.m
//  Strudel VibeLive iOS
//
//  Capacitor requires this Objective-C registration so the plugin and its
//  methods/events are discoverable from JavaScript. Keep method names in sync
//  with NativeMIDIPlugin.swift and packages/iosbridge/web-midi-polyfill.iife.js.
//
#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(NativeMIDIPlugin, "NativeMIDI",
    CAP_PLUGIN_METHOD(requestAccess, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(listPorts, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(send, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(openPort, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(closePort, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(showBluetoothCentral, CAPPluginReturnPromise);
)
