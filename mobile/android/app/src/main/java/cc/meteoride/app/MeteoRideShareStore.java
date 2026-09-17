package cc.meteoride.app;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Drop box for routes that arrive from outside the app: a GPX shared from another
 * app, or a .gpx/.kml opened from a file manager or a download.
 *
 * The web layer drains it through {@link MeteoRideSharePlugin}. Files are parked on
 * disk rather than kept in memory, because the content URI grant dies with the
 * intent and the process may be recreated before JavaScript asks for the route.
 */
final class MeteoRideShareStore {

    private static final String TAG = "MeteoRide";
    private static final String DIR = "incoming-routes";
    /** The intake ledger: routes received from an intent but not yet in the inbox. */
    private static final String LEDGER = "incoming-routes.pending";
    private static final Object LEDGER_LOCK = new Object();
    private static final List<String> ALLOWED_EXTENSIONS = Arrays.asList("gpx", "kml");
    private static final int MAX_BYTES = 25 * 1024 * 1024;
    private static final long MAX_AGE_MS = 24 * 60 * 60 * 1000L;
    // Two shares can land in the same millisecond; this tells their file names apart.
    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    private MeteoRideShareStore() {}

    /** A route waiting to be handed to the web layer. */
    static final class Pending {
        final String name;
        final String text;

        Pending(String name, String text) {
            this.name = name;
            this.text = text;
        }
    }

    // ---------------------------------------------------------------- writing

    /** Copies whatever the intent pointed at. Returns false if it was not a route. */
    static boolean ingest(Context ctx, Uri uri) {
        if (uri == null) return false;

        String name = displayName(ctx, uri);
        byte[] data;
        try (InputStream in = ctx.getContentResolver().openInputStream(uri)) {
            if (in == null) return false;
            data = readAll(in);
        } catch (IOException | SecurityException e) {
            Log.w(TAG, "could not read shared route: " + e.getMessage());
            return false;
        }

        // Plenty of apps share a GPX as application/octet-stream with no usable file
        // name, so fall back to looking at the content itself.
        if (!hasAllowedExtension(name) && !looksLikeRoute(data)) {
            Log.w(TAG, "ignoring shared item, not a route: " + name);
            return false;
        }
        return store(ctx, data, name) != null;
    }

    static File store(Context ctx, byte[] data, String suggestedName) {
        if (data == null || data.length == 0) return null;
        // Timestamp+sequence prefix keeps arrival order and avoids collisions between
        // shares that land in the same millisecond.
        String fileName = inboxFileName(System.currentTimeMillis(), SEQUENCE.incrementAndGet(), suggestedName);
        File dest = new File(inbox(ctx), fileName);
        // Written elsewhere and moved in whole: ingestion runs on its own thread, and
        // next() would otherwise read, and delete, a file still being written. The
        // cache and files directories share a volume, so the rename is atomic.
        File part = new File(ctx.getCacheDir(), fileName + ".part");
        try (FileOutputStream out = new FileOutputStream(part)) {
            out.write(data);
        } catch (IOException e) {
            Log.w(TAG, "could not store shared route: " + e.getMessage());
            if (!part.delete()) Log.w(TAG, "could not delete " + part.getName());
            return null;
        }
        if (!part.renameTo(dest)) {
            Log.w(TAG, "could not move shared route into the inbox");
            if (!part.delete()) Log.w(TAG, "could not delete " + part.getName());
            return null;
        }
        return dest;
    }

    // ------------------------------------------------------------ intake ledger

    /*
     * Reading a shared file takes as long as the provider takes, and until the bytes
     * are in the inbox the route exists nowhere durable: the content URI dies with the
     * intent and the process can be killed in between. The activity used to mark the
     * intent handled before that read even started, so a death mid-read lost the route
     * outright — and with `savedInstanceState` and FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY
     * both refusing to read an intent twice, not even reopening from Recents got it
     * back. The user had to go and share it again.
     *
     * So the URI is written here, durably, before anything is read, and removed once
     * the attempt is over. What is left in this file at launch is exactly what was
     * received and never delivered, and {@link MainActivity} retries it. A delivery
     * that finished is not in the file, so it is never delivered twice.
     */

    /**
     * Records URIs as received. Call before reading them, not after. Returns false if
     * the record could not be written — a full disk, a read-only volume — and the
     * caller must then not treat the intent as handled: with nothing durable to come
     * back to, the only remaining chance is the intent itself.
     */
    static boolean rememberIntake(Context ctx, List<Uri> uris) {
        if (uris.isEmpty()) return true;
        List<String> lines = new ArrayList<>();
        for (Uri uri : uris) lines.add(uri.toString());
        synchronized (LEDGER_LOCK) {
            return writeLedger(ctx, ledgerWith(readLedger(ctx), lines));
        }
    }

    /** Drops one URI, whether its delivery succeeded or failed. One attempt, no loop. */
    static void forgetIntake(Context ctx, Uri uri) {
        synchronized (LEDGER_LOCK) {
            String before = readLedger(ctx);
            String after = ledgerWithout(before, uri.toString());
            if (!after.equals(before)) writeLedger(ctx, after);
        }
    }

    /**
     * Whether this URI is still waiting. This is the claim a delivery stakes: the entry
     * is only removed once an attempt is over, so a second task carrying the same URI
     * finds it gone and skips. Called from the ingest thread, which is the only thread
     * that removes, so the check and the delivery that follows cannot be raced by
     * another delivery.
     */
    static boolean isPendingIntake(Context ctx, Uri uri) {
        synchronized (LEDGER_LOCK) {
            return ledgerLines(readLedger(ctx)).contains(uri.toString());
        }
    }

    /** What was received and never delivered. Empty on a clean launch. */
    static List<Uri> pendingIntake(Context ctx) {
        String content;
        synchronized (LEDGER_LOCK) {
            content = readLedger(ctx);
        }
        List<Uri> uris = new ArrayList<>();
        for (String line : ledgerLines(content)) uris.add(Uri.parse(line));
        return uris;
    }

    private static String readLedger(Context ctx) {
        File file = new File(ctx.getFilesDir(), LEDGER);
        if (!file.exists()) return "";
        try (InputStream in = new java.io.FileInputStream(file)) {
            return new String(readAll(in), StandardCharsets.UTF_8);
        } catch (IOException e) {
            Log.w(TAG, "could not read the intake ledger: " + e.getMessage());
            return "";
        }
    }

    /** True when the ledger on disk now says what it was asked to say. */
    private static boolean writeLedger(Context ctx, String content) {
        File file = new File(ctx.getFilesDir(), LEDGER);
        if (content.isEmpty()) {
            if (file.exists() && !file.delete()) {
                Log.w(TAG, "could not clear the intake ledger");
                return false;
            }
            return true;
        }
        // Same rename-into-place as store(): a half-written ledger would either lose a
        // pending route or resurrect a delivered one.
        File part = new File(ctx.getCacheDir(), LEDGER + ".part");
        try (FileOutputStream out = new FileOutputStream(part)) {
            out.write(content.getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            Log.w(TAG, "could not write the intake ledger: " + e.getMessage());
            if (!part.delete()) Log.w(TAG, "could not delete " + part.getName());
            return false;
        }
        if (!part.renameTo(file)) {
            Log.w(TAG, "could not move the intake ledger into place");
            if (!part.delete()) Log.w(TAG, "could not delete " + part.getName());
            return false;
        }
        return true;
    }

    /* The three below are pure so they can be tested without a Context. */

    static List<String> ledgerLines(String content) {
        List<String> lines = new ArrayList<>();
        for (String line : content.split("\n")) {
            String trimmed = line.trim();
            if (!trimmed.isEmpty()) lines.add(trimmed);
        }
        return lines;
    }

    /** Appends what is not already there: the same URI must not queue up twice. */
    static String ledgerWith(String content, List<String> add) {
        List<String> lines = ledgerLines(content);
        for (String line : add) {
            if (line != null && !line.trim().isEmpty() && !lines.contains(line)) lines.add(line);
        }
        return join(lines);
    }

    static String ledgerWithout(String content, String remove) {
        List<String> lines = ledgerLines(content);
        lines.remove(remove);
        return join(lines);
    }

    private static String join(List<String> lines) {
        if (lines.isEmpty()) return "";
        StringBuilder out = new StringBuilder();
        for (String line : lines) out.append(line).append('\n');
        return out.toString();
    }

    // ---------------------------------------------------------------- reading

    static int pendingCount(Context ctx) {
        File[] files = prune(inbox(ctx).listFiles());
        return files == null ? 0 : files.length;
    }

    /** A route shared while the web layer never got to run would sit here forever. */
    private static File[] prune(File[] files) {
        if (files == null) return null;
        long cutoff = System.currentTimeMillis() - MAX_AGE_MS;
        for (File file : files) {
            if (file.lastModified() < cutoff && !file.delete()) Log.w(TAG, "could not prune " + file.getName());
        }
        return Arrays.stream(files).filter(File::exists).toArray(File[]::new);
    }

    /** Returns the oldest pending route and removes it from the inbox. */
    static Pending next(Context ctx) {
        File[] files = prune(inbox(ctx).listFiles());
        if (files == null || files.length == 0) return null;
        Arrays.sort(files);

        for (File file : files) {
            byte[] data = null;
            try (InputStream in = new java.io.FileInputStream(file)) {
                data = readAll(in);
            } catch (IOException e) {
                Log.w(TAG, "could not read pending route: " + e.getMessage());
            }
            if (!file.delete()) Log.w(TAG, "could not delete " + file.getName());
            if (data == null || data.length == 0) continue;
            return new Pending(displayNameOf(file), decode(data));
        }
        return null;
    }

    // ---------------------------------------------------------------- helpers

    private static File inbox(Context ctx) {
        File dir = new File(ctx.getFilesDir(), DIR);
        if (!dir.exists() && !dir.mkdirs()) Log.w(TAG, "could not create " + dir);
        return dir;
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int read;
        while ((read = in.read(buf)) != -1) {
            out.write(buf, 0, read);
            if (out.size() > MAX_BYTES) throw new IOException("route larger than " + MAX_BYTES + " bytes");
        }
        return out.toByteArray();
    }

    private static String displayName(Context ctx, Uri uri) {
        String name = null;
        if ("content".equals(uri.getScheme())) {
            try (Cursor c = ctx.getContentResolver().query(uri, null, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (i >= 0) name = c.getString(i);
                }
            } catch (Exception e) {
                Log.w(TAG, "could not resolve display name: " + e.getMessage());
            }
        }
        if (name == null) name = uri.getLastPathSegment();
        return name == null ? "route.gpx" : name;
    }

    /** Strips the timestamp prefix added by {@link #store}. */
    private static String displayNameOf(File file) {
        String name = file.getName();
        int sep = name.indexOf("__");
        return sep < 0 ? name : name.substring(sep + 2);
    }

    private static boolean hasAllowedExtension(String name) {
        if (name == null) return false;
        int dot = name.lastIndexOf('.');
        return dot >= 0 && ALLOWED_EXTENSIONS.contains(name.substring(dot + 1).toLowerCase());
    }

    /** GPX is XML and normally UTF-8; some exporters still emit Latin-1. */
    static String decode(byte[] data) {
        try {
            return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(data))
                    .toString();
        } catch (CharacterCodingException e) {
            // Not valid UTF-8 after all.
            return new String(data, StandardCharsets.ISO_8859_1);
        }
    }

    /** Timestamp+sequence file name: unique across shares, sorts in arrival order. */
    static String inboxFileName(long millis, int sequence, String name) {
        return String.format(Locale.ROOT, "%013d-%04d__%s", millis, sequence % 10000, sanitize(name));
    }

    private static boolean looksLikeRoute(byte[] data) {
        int head = Math.min(data.length, 2048);
        String start = new String(data, 0, head, StandardCharsets.UTF_8).toLowerCase();
        return start.contains("<gpx") || start.contains("<kml");
    }

    private static String sanitize(String name) {
        String base = (name == null || name.isEmpty()) ? "route.gpx" : name;
        base = base.replaceAll("[^A-Za-z0-9._ -]", "-");
        if (!hasAllowedExtension(base)) base = base + ".gpx";
        return base.length() > 120 ? base.substring(base.length() - 120) : base;
    }
}
