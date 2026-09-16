//  Drop-in replacement for ios/App/App/AppDelegate.swift.
//
//  This is the file Capacitor 8.5.2 generates, plus the import and two calls the
//  ride watch needs, each marked below. Copy it over the generated one. If a future
//  Capacitor version generates something different, do not copy it wholesale —
//  apply the marked pieces to whatever the new template says.
//
//  Do NOT add this file to the Xcode target: it would collide with the real one.

import UIKit
import Capacitor
// ADDED: the background runner's own module, for the two calls below.
import CapacitorBackgroundRunner

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // ADDED: the ride watch runs in @capacitor/background-runner, which registers
        // its BGTaskScheduler task here. It has to happen before the app finishes
        // launching — the plugin cannot do it from its own initialiser, and iOS
        // refuses a registration that arrives later. Without this the task is never
        // scheduled and no alert ever fires, with nothing said about it.
        BackgroundRunnerPlugin.registerBackgroundTask()
        // ADDED: handles the case where the app was launched *by* an event rather
        // than by the user. Returns immediately when launchOptions is nil.
        BackgroundRunnerPlugin.handleApplicationDidFinishLaunching(launchOptions: launchOptions)

        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
