package cc.meteoride.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must run before super.onCreate, which builds the bridge.
        registerPlugin(MeteoRideSharePlugin.class);
        super.onCreate(savedInstanceState);

        // The app was launched by a share or by opening a file.
        ingest(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // The app was already running, so nothing else will wake the web layer.
        if (ingest(intent)) MeteoRideSharePlugin.notifyRouteAvailable();
    }

    /** Parks any route carried by the intent in the shared inbox. */
    private boolean ingest(Intent intent) {
        if (intent == null) return false;
        boolean stored = false;
        for (Uri uri : routeUris(intent)) {
            stored |= MeteoRideShareStore.ingest(this, uri);
        }
        return stored;
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
