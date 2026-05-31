#!/usr/bin/env ruby
# frozen_string_literal: true
#
# integrate-ios-target.rb — add the native plugins to the Capacitor App target.
#
# `npx cap add ios` generates ios/App/App.xcodeproj but does not know about our
# authored Swift/ObjC sources in ios/native/. This script copies them into the
# App project and registers them with the "App" target (sources + the polyfill
# resource), so the project builds with CoreMIDI + AVAudioSession support.
#
# Idempotent: safe to re-run after regenerating the iOS project.
#
# Usage:
#   ruby packages/iosbridge/scripts/integrate-ios-target.rb [path/to/App.xcodeproj]
#
require 'xcodeproj'
require 'fileutils'

REPO   = File.expand_path('../../../..', __FILE__)
PROJ   = ARGV[0] || File.join(REPO, 'ios/App/App.xcodeproj')
APP    = File.join(REPO, 'ios/App/App')              # the App source folder
NATIVE = File.join(REPO, 'ios/native')              # our authored sources

abort "Xcode project not found: #{PROJ} (run `npx cap add ios` first)" unless File.exist?(PROJ)
abort "Native sources not found: #{NATIVE}" unless File.directory?(NATIVE)

# --- 1. copy authored sources into the App project --------------------------
plugins_dir = File.join(APP, 'plugins')
FileUtils.mkdir_p(plugins_dir)

SOURCES = %w[
  NativeMIDI/NativeMIDIPlugin.swift
  NativeMIDI/NativeMIDIPlugin.m
  NativeAudioSession/NativeAudioSessionPlugin.swift
  NativeAudioSession/NativeAudioSessionPlugin.m
].freeze

SOURCES.each do |rel|
  FileUtils.cp(File.join(NATIVE, rel), File.join(plugins_dir, File.basename(rel)))
end

# The Web MIDI polyfill is a bundled resource read by NativeMIDIPlugin at launch.
FileUtils.cp(File.join(NATIVE, 'NativeMIDI/web-midi-polyfill.js'),
             File.join(APP, 'web-midi-polyfill.js'))

# --- 2. register with the Xcode "App" target --------------------------------
project   = Xcodeproj::Project.open(PROJ)
target    = project.targets.find { |t| t.name == 'App' } || abort('App target not found')
app_group = project.main_group.find_subpath('App', true)

plugins_group = app_group.find_subpath('plugins', true)
plugins_group.set_source_tree('<group>')
plugins_group.set_path('plugins')

source_basenames = SOURCES.map { |rel| File.basename(rel) }
source_basenames.each do |name|
  next if plugins_group.files.any? { |f| f.display_name == name }
  ref = plugins_group.new_reference(name)
  target.source_build_phase.add_file_reference(ref, true)
  puts "  + source  #{name}"
end

# polyfill as a Copy Bundle Resources entry on the App group
js = 'web-midi-polyfill.js'
unless app_group.files.any? { |f| f.display_name == js }
  ref = app_group.new_reference(js)
  target.resources_build_phase.add_file_reference(ref, true)
  puts "  + resource #{js}"
end

project.save
puts "Integrated native plugins into #{PROJ}"
