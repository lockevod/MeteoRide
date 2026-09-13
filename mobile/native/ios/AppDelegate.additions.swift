// Reference snippet — apply to ios/App/App/AppDelegate.swift.
//
// The ride watch runs in @capacitor/background-runner, which needs to register its
// BGTaskScheduler task before the app finishes launching; the plugin cannot do that
// from its own initialiser. Two lines, plus the import.

import CapacitorBackgroundRunner   // next to `import Capacitor`

// Inside application(_:didFinishLaunchingWithOptions:), before `return true`:
//
//     BackgroundRunnerPlugin.registerBackgroundTask()
//     BackgroundRunnerPlugin.handleApplicationDidFinishLaunching(launchOptions: launchOptions)
