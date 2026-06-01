//
//  IOSDefaultsPlugin.m
//  Strudel VibeLive iOS
//
//  Capacitor requires this Objective-C registration so the plugin is discovered
//  and its load() runs during registerPlugins(). This plugin exposes no JS
//  methods — it only seeds first-launch UI defaults via a document-start script.
//
#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(IOSDefaultsPlugin, "IOSDefaults",
)
