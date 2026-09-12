package cc.meteoride.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridges the shared-route inbox to the web layer.
 *
 * scripts/native.js calls {@code Capacitor.Plugins.MeteoRideShare.consumePending()}
 * at launch, whenever the app becomes active, and on the sharedRouteAvailable event.
 * The iOS plugin exposes the same two methods.
 */
@CapacitorPlugin(name = "MeteoRideShare")
public class MeteoRideSharePlugin extends Plugin {

    private static MeteoRideSharePlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
        super.handleOnDestroy();
    }

    /** Resolves with {@code {name, gpx}}, or an empty object once the inbox is drained. */
    @PluginMethod
    public void consumePending(PluginCall call) {
        MeteoRideShareStore.Pending pending = MeteoRideShareStore.next(getContext());
        JSObject result = new JSObject();
        if (pending != null) {
            result.put("name", pending.name);
            result.put("gpx", pending.text);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void pendingCount(PluginCall call) {
        JSObject result = new JSObject();
        result.put("count", MeteoRideShareStore.pendingCount(getContext()));
        call.resolve(result);
    }

    /**
     * Tells the web layer a route arrived while the app was already running. The
     * activity cannot reach the plugin instance any other way.
     */
    static void notifyRouteAvailable() {
        if (instance != null) instance.notifyListeners("sharedRouteAvailable", new JSObject());
    }
}
