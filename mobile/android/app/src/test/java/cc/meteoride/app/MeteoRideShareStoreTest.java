package cc.meteoride.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;

import org.junit.Test;

/**
 * Local JVM tests for the two pure helpers in {@link MeteoRideShareStore}: no
 * {@link android.content.Context} involved, so these run without Robolectric.
 */
public class MeteoRideShareStoreTest {

    // ---------------------------------------------------------------- decode

    @Test
    public void decode_keepsValidUtf8ThatContainsTheReplacementCharacter() {
        String text = "Montjuïc �"; // U+FFFD here is a legitimate character, not mojibake.
        byte[] data = text.getBytes(StandardCharsets.UTF_8);

        assertEquals(text, MeteoRideShareStore.decode(data));
    }

    @Test
    public void decode_fallsBackToLatin1ForBytesThatAreNotValidUtf8() {
        // 0xEF starts a 3-byte UTF-8 sequence with no continuation bytes: malformed.
        byte[] data = {0x4D, 0x6F, (byte) 0xEF};

        assertEquals("Moï", MeteoRideShareStore.decode(data));
    }

    // ---------------------------------------------------------------- inboxFileName

    @Test
    public void inboxFileName_differsBetweenSharesInTheSameMillisecond() {
        String first = MeteoRideShareStore.inboxFileName(1000, 1, "Etapa á.gpx");
        String second = MeteoRideShareStore.inboxFileName(1000, 2, "Etapa ñ.gpx");

        assertNotEquals(first, second);
        assertTrue(first.startsWith("0000000001000-0001__"));
        assertTrue(second.startsWith("0000000001000-0002__"));
    }

    @Test
    public void inboxFileName_ordersLexicographicallyByMillisThenSequence() {
        String a = MeteoRideShareStore.inboxFileName(1000, 9, "a.gpx");
        String b = MeteoRideShareStore.inboxFileName(1000, 10, "a.gpx");
        String c = MeteoRideShareStore.inboxFileName(1001, 1, "a.gpx");

        assertTrue(a.compareTo(b) < 0);
        assertTrue(b.compareTo(c) < 0);
    }
}
