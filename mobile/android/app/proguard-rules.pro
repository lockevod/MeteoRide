# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Background runner (ride alerts). Its JS engine is native code that calls back into these
# classes through JNI by class and method name, and its AAR ships an empty proguard.txt, so
# R8 would rename them and the runner would die only in a minified release.
-keep class io.ionic.android_js_engine.** { *; }
-keep class io.ionic.backgroundrunner.** { *; }

# Capacitor reads each plugin's permissions from its annotations at run time. R8's full mode
# stripped what that reflection needs: the minified release reported notifications as not
# granted while the unminified build said granted. Keeping the core whole fixed it.
-keepattributes *Annotation*,AnnotationDefault,Signature,InnerClasses,EnclosingMethod
-keep class com.getcapacitor.** { *; }
-keep @interface com.getcapacitor.** { *; }
