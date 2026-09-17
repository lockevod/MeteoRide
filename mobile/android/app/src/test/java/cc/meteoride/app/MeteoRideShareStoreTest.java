package cc.meteoride.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;

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

    // ---------------------------------------------------------------- intake ledger

    /*
     * The ledger is what makes a share survive the process dying mid-read, and the two
     * ways it can be wrong are opposite: lose an entry and the route is gone for good,
     * keep one that was delivered and the route arrives twice on the next launch.
     */

    @Test
    public void ledger_recordsWhatWasReceived() {
        String ledger = MeteoRideShareStore.ledgerWith("", Collections.singletonList("content://x/1"));

        assertEquals(Collections.singletonList("content://x/1"), MeteoRideShareStore.ledgerLines(ledger));
    }

    @Test
    public void ledger_keepsArrivalOrderAcrossSeveralShares() {
        String ledger = MeteoRideShareStore.ledgerWith("", Arrays.asList("content://x/1", "content://x/2"));
        ledger = MeteoRideShareStore.ledgerWith(ledger, Collections.singletonList("content://x/3"));

        assertEquals(
                Arrays.asList("content://x/1", "content://x/2", "content://x/3"),
                MeteoRideShareStore.ledgerLines(ledger));
    }

    @Test
    public void ledger_doesNotQueueTheSameUriTwice() {
        String ledger = MeteoRideShareStore.ledgerWith("", Collections.singletonList("content://x/1"));
        ledger = MeteoRideShareStore.ledgerWith(ledger, Collections.singletonList("content://x/1"));

        assertEquals(1, MeteoRideShareStore.ledgerLines(ledger).size());
    }

    @Test
    public void ledger_forgettingOneLeavesTheOthersAlone() {
        String ledger = MeteoRideShareStore.ledgerWith(
                "", Arrays.asList("content://x/1", "content://x/2", "content://x/3"));

        String after = MeteoRideShareStore.ledgerWithout(ledger, "content://x/2");

        assertEquals(
                Arrays.asList("content://x/1", "content://x/3"),
                MeteoRideShareStore.ledgerLines(after));
    }

    @Test
    public void ledger_isEmptyOnceTheLastDeliveryIsDone() {
        String ledger = MeteoRideShareStore.ledgerWith("", Collections.singletonList("content://x/1"));

        // An empty ledger is what a clean launch must see: nothing to retry, nothing
        // delivered twice.
        assertEquals("", MeteoRideShareStore.ledgerWithout(ledger, "content://x/1"));
        assertTrue(MeteoRideShareStore.ledgerLines("").isEmpty());
    }

    @Test
    public void ledger_forgettingSomethingNotThereChangesNothing() {
        String ledger = MeteoRideShareStore.ledgerWith("", Collections.singletonList("content://x/1"));

        assertEquals(ledger, MeteoRideShareStore.ledgerWithout(ledger, "content://x/9"));
    }

    /**
     * The property {@code MainActivity.deliver} stands on: once an attempt is over, the
     * entry is gone, so a second task carrying the same URI finds nothing to claim and
     * skips it. That is what stops the retry queued in {@code onCreate} and the intent
     * ingested right after it from importing the same route twice.
     *
     * This covers the ledger primitive, not the wiring: {@code isPendingIntake} and
     * {@code deliver} both need a {@code Context}, and there is no Robolectric here, so
     * the call site itself is only verified by reading. See docs/HANDOFF.md §10.
     */
    @Test
    public void ledger_aDeliveredUriCanNoLongerBeClaimed() {
        String ledger = MeteoRideShareStore.ledgerWith(
                "", Arrays.asList("content://x/1", "content://x/2"));
        assertTrue(MeteoRideShareStore.ledgerLines(ledger).contains("content://x/1"));

        String afterDelivery = MeteoRideShareStore.ledgerWithout(ledger, "content://x/1");

        assertTrue(!MeteoRideShareStore.ledgerLines(afterDelivery).contains("content://x/1"));
        assertTrue(MeteoRideShareStore.ledgerLines(afterDelivery).contains("content://x/2"));
    }

    @Test
    public void ledger_ignoresBlankLinesLeftByAnInterruptedWrite() {
        assertEquals(
                Collections.singletonList("content://x/1"),
                MeteoRideShareStore.ledgerLines("\n  \ncontent://x/1\n\n"));
    }
}
