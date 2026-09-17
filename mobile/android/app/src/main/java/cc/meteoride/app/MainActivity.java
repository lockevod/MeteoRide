package cc.meteoride.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "MeteoRide";

    /** Marks an intent whose route has already been taken, so it is not read twice. */
    private static final String EXTRA_HANDLED = "cc.meteoride.app.ROUTE_HANDLED";

    /**
     * Reads received and not yet finished. The web layer asks, because a launch that
     * carried a route must not be treated as a launch that carried nothing: that is
     * what decides whether the map jumps to the phone's position, and asking for the
     * location permission on a launch where the user just opened a route is wrong.
     */
    private static final AtomicInteger INCOMING = new AtomicInteger();

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

        // Anything received on an earlier run and never delivered — the process died
        // while the file was still being read — is retried. It runs on every launch,
        // because a restore and a reopen from Recents are how the user gets back here.
        // It is safe to run alongside the intent below even though both can name the
        // same URI: whichever reaches `deliver` first claims the ledger entry, and the
        // other finds it gone. Do not rely on the order of these two lines for that.
        retryIntake(getApplicationContext());

        // The app was launched by a share or by opening a file. Only on a genuine
        // launch: a restore recreates the activity with the same intent, and reading it
        // again would load the route a second time. What a restore needs is above, and
        // it comes from the ledger rather than from the intent. (Rotation does not
        // recreate this activity at all — the manifest declares `configChanges` for
        // orientation and screenSize and locks `screenOrientation` to portrait.)
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
        // Anything that reopen should recover is in the ledger, not in this intent.
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        List<Uri> uris = routeUris(intent);
        if (uris.isEmpty()) return;
        Context app = getApplicationContext();
        // On the main thread on purpose, and before the executor is handed anything:
        // this is the durable record that the route arrived, and it has to exist before
        // the first byte is read. It is a few hundred bytes appended to a small file,
        // and the executor may be busy with a large route for seconds — recording it
        // there instead would leave exactly the window this closes.
        keepAccess(intent, uris);
        boolean recorded = MeteoRideShareStore.rememberIntake(app, uris);
        // Only once the record is really on disk. Marking the intent handled after a
        // write that failed — a full disk, a read-only volume — would throw away the
        // one remaining copy of the route: `deliver` skips anything the ledger does not
        // hold, so an unrecorded URI is never delivered and, marked handled, never
        // retried from the intent either. Left unmarked, a rotation or a reopen still
        // has a chance at it.
        if (recorded) intent.putExtra(EXTRA_HANDLED, true);
        else Log.w(TAG, "the intake ledger could not be written; leaving the intent unhandled");
        submit(app, uris);
    }

    /** Runs a delivery on the ingest thread, counted so the web layer can see it coming. */
    private static void submit(Context app, List<Uri> uris) {
        INCOMING.incrementAndGet();
        INGEST.execute(() -> {
            try {
                deliver(app, uris);
            } finally {
                INCOMING.decrementAndGet();
            }
        });
    }

    /** Reads received and not yet finished; read by the plugin, from any thread. */
    static int incomingCount() {
        return INCOMING.get();
    }

    /** Retries what an earlier run received and never delivered. */
    private static void retryIntake(Context app) {
        INCOMING.incrementAndGet();
        INGEST.execute(() -> {
            try {
                // Read here rather than at the call site so this picks up anything the
                // main thread recorded in between. Delivering it twice is not a worry:
                // `deliver` claims each entry, and whatever this sees that another task
                // already delivered is no longer in the ledger.
                List<Uri> pending = MeteoRideShareStore.pendingIntake(app);
                if (!pending.isEmpty()) deliver(app, pending);
            } finally {
                INCOMING.decrementAndGet();
            }
        });
    }

    /**
     * One attempt per URI, and the ledger entry goes either way. A grant that died with
     * the process cannot be revived by trying again, and a URI left in the ledger would
     * be retried on every single launch for ever.
     *
     * The ledger entry is also the claim. Two tasks can carry the same URI — the retry
     * queued in `onCreate` and the intent ingested right after it, in either order —
     * and only the one that gets here while the entry still stands delivers it. This
     * runs on the single ingest thread, which is also the only thread that removes
     * entries, so check and removal cannot interleave with another delivery.
     */
    private static void deliver(Context app, List<Uri> uris) {
        boolean stored = false;
        for (Uri uri : uris) {
            // Not in the ledger: either another task delivered it already, or it was
            // never recorded because the write failed. Reading it here would be the
            // second delivery in the first case, so the intent path is what covers the
            // second — see `ingest`, which leaves such an intent unhandled.
            if (!MeteoRideShareStore.isPendingIntake(app, uri)) continue;
            try {
                stored |= MeteoRideShareStore.ingest(app, uri);
            } catch (RuntimeException e) {
                // `openInputStream` throws unchecked on a provider that no longer maps
                // the path (`IllegalArgumentException`) or a dead binder, and a stale
                // URI retried from the ledger is exactly how that happens. Escaping
                // here would reach the default handler and crash the app on the launch
                // that was meant to recover the user's route.
                Log.w(TAG, "could not deliver a shared route: " + e);
            } finally {
                MeteoRideShareStore.forgetIntake(app, uri);
            }
        }
        if (stored) MeteoRideSharePlugin.notifyRouteAvailable();
    }

    /**
     * Asks to keep reading the URI past this intent, which is what makes the retry
     * worth attempting at all. Only a provider that offered a persistable grant can
     * give one — a plain share sheet does not — so failure is the normal case and is
     * not worth a log line per share.
     */
    private void keepAccess(Intent intent, List<Uri> uris) {
        if ((intent.getFlags() & Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION) == 0) return;
        for (Uri uri : uris) {
            try {
                getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (SecurityException e) {
                // The provider changed its mind between the flag and the call.
            }
        }
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
