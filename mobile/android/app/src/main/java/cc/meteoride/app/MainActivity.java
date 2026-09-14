package cc.meteoride.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends BridgeActivity {

    /** Marks an intent whose route has already been taken, so it is not read twice. */
    private static final String EXTRA_HANDLED = "cc.meteoride.app.ROUTE_HANDLED";

    /**
     * Reading a shared file can stall (a cloud-backed provider, a slow stream), so it
     * never runs on the main thread. One thread keeps one file in memory at a time.
     */
    private static final ExecutorService INGEST = Executors.newSingleThreadExecutor();

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must run before super.onCreate, which builds the bridge.
        registerPlugin(MeteoRideSharePlugin.class);
        super.onCreate(savedInstanceState);

        // The app was launched by a share or by opening a file. Only on a genuine
        // launch: a rotation or a restore recreates the activity with the same intent,
        // and reading it again would load the route a second time.
        if (savedInstanceState == null) ingest(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        ingest(intent);
    }

    /**
     * Parks any route carried by the intent in the shared inbox, off the main thread,
     * then tells the web layer. It always tells: on a launch the first drain may have
     * run before the file landed, and the plugin holds the event until JS listens.
     */
    private void ingest(Intent intent) {
        if (intent == null || intent.getBooleanExtra(EXTRA_HANDLED, false)) return;
        // Reopening the task from Recent Apps relaunches onCreate(null) with this same
        // flag and the original intent: not a genuine new share, so do not re-import it.
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        intent.putExtra(EXTRA_HANDLED, true);
        List<Uri> uris = routeUris(intent);
        if (uris.isEmpty()) return;
        Context app = getApplicationContext();
        INGEST.execute(() -> {
            boolean stored = false;
            for (Uri uri : uris) {
                stored |= MeteoRideShareStore.ingest(app, uri);
            }
            if (stored) MeteoRideSharePlugin.notifyRouteAvailable();
        });
    }

    private List<Uri> routeUris(Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri uri = extraStream(intent);
            return uri == null ? Collections.emptyList() : Collections.singletonList(uri);
        }
        if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            List<Uri> uris = extraStreams(intent);
            return uris == null ? Collections.emptyList() : uris;
        }
        if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
            // meteoride:// only brings the app to the front; it carries no route.
            if ("meteoride".equals(intent.getData().getScheme())) return Collections.emptyList();
            return Collections.singletonList(intent.getData());
        }
        return Collections.emptyList();
    }

    @SuppressWarnings("deprecation")
    private Uri extraStream(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        }
        return intent.getParcelableExtra(Intent.EXTRA_STREAM);
    }

    @SuppressWarnings("deprecation")
    private List<Uri> extraStreams(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class);
        }
        ArrayList<Uri> uris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
        return uris == null ? Collections.emptyList() : uris;
    }
}
