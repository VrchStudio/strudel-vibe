//
//  NativeAudioSessionPlugin.m
//  Strudel VibeLive iOS
//
#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(NativeAudioSessionPlugin, "NativeAudioSession",
    CAP_PLUGIN_METHOD(configure, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(activate, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(deactivate, CAPPluginReturnPromise);
)
