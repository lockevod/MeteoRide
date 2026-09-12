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
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;

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
    private static final List<String> ALLOWED_EXTENSIONS = Arrays.asList("gpx", "kml");
    private static final int MAX_BYTES = 25 * 1024 * 1024;
    private static final long MAX_AGE_MS = 24 * 60 * 60 * 1000L;

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
        // Timestamp prefix keeps arrival order and avoids collisions between shares.
        File dest = new File(inbox(ctx), System.currentTimeMillis() + "__" + sanitize(suggestedName));
        try (FileOutputStream out = new FileOutputStream(dest)) {
            out.write(data);
            return dest;
        } catch (IOException e) {
            Log.w(TAG, "could not store shared route: " + e.getMessage());
            return null;
        }
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
    private static String decode(byte[] data) {
        String text = new String(data, StandardCharsets.UTF_8);
        // U+FFFD means the bytes were not valid UTF-8 after all.
        return text.indexOf('\uFFFD') >= 0 ? new String(data, StandardCharsets.ISO_8859_1) : text;
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
