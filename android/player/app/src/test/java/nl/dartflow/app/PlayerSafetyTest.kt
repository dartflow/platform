package nl.dartflow.app

import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PlayerSafetyTest {
    @Test fun acceptanceFailsClosedAndUsesServerVersion() {
        assertFalse(canUseCommunity(JSONObject()))
        assertFalse(canUseCommunity(JSONObject("{\"requiresAcceptance\":true}")))
        assertTrue(canUseCommunity(JSONObject("{\"requiresAcceptance\":false,\"acceptedVersion\":\"2026-11-18\"}")))
    }

    @Test fun reportsRetainOnlyExplicitTargetAndTrimReason() {
        val result = playerReportBody(PlayerReportTarget("reply", "reply-1", "Not sent", "club", "club-1"), "privacy", "  Dit bevat privégegevens.  ")
        assertEquals("reply", result.getString("targetType"))
        assertEquals("reply-1", result.getString("targetId"))
        assertEquals("club", result.getString("scopeKind"))
        assertEquals("club-1", result.getString("scopeId"))
        assertEquals("Dit bevat privégegevens.", result.getString("reason"))
        assertFalse(result.has("label"))
    }

    @Test fun reportsDeletionAndReviewPasswordsCannotBeStoredAsPendingOperations() {
        val commands = listOf(
            NativePlayerCommand.create("/safety/report", JSONObject().put("reason", "Sensitive report")),
            NativePlayerCommand.create("/account/deletion", JSONObject().put("confirmation", "VERWIJDEREN")),
            NativePlayerCommand.create("/auth/review", JSONObject().put("password", "synthetic-test-only")),
        )
        commands.forEach { command ->
            assertTrue(command.sensitive)
            assertThrows(IllegalStateException::class.java) { command.forStorage("p1", "https://dartflow.nl") }
            assertFalse(command.toString().contains("Sensitive report"))
            assertFalse(command.toString().contains("synthetic-test-only"))
        }
    }

    @Test fun paddedAndInterleavedLuminanceCopiesOnlyVisiblePixels() {
        assertArrayEquals(byteArrayOf(1, 2, 3, 4), PlayerQrDecoder.packedLuminance(byteArrayOf(1, 2, 99, 99, 3, 4), 2, 2, 4, 1))
        assertArrayEquals(byteArrayOf(1, 2, 3, 4), PlayerQrDecoder.packedLuminance(byteArrayOf(1, 88, 2, 88, 88, 3, 88, 4), 2, 2, 5, 2))
        assertNull(PlayerQrDecoder.packedLuminance(byteArrayOf(1), 2, 2, 2, 1))
        assertNull(PlayerQrDecoder.packedLuminance(byteArrayOf(1, 2, 3, 4), 2, 2, 1, 1))
        assertNull(PlayerQrDecoder.packedLuminance(ByteArray(0), Int.MAX_VALUE, Int.MAX_VALUE, Int.MAX_VALUE, 2))
    }

    @Test fun clockwiseRotationPreservesNonSquarePixels() {
        assertArrayEquals(byteArrayOf(5, 3, 1, 6, 4, 2), PlayerQrDecoder.rotateClockwise(byteArrayOf(1, 2, 3, 4, 5, 6), 2, 3))
    }

    @Test fun localQrDecodesBoardUrlEveryRotationAndInverted() {
        val url = "https://dartflow.nl/baan/synthetic-board"
        val matrix = QRCodeWriter().encode(url, BarcodeFormat.QR_CODE, 240, 240)
        var pixels = ByteArray(240 * 240) { i -> if (matrix.get(i % 240, i / 240)) 0 else 255.toByte() }
        repeat(4) {
            assertEquals(url, PlayerQrDecoder.decode(pixels, 240, 240))
            assertEquals(url, PlayerQrDecoder.decode(ByteArray(pixels.size) { i -> (255 - (pixels[i].toInt() and 255)).toByte() }, 240, 240))
            pixels = PlayerQrDecoder.rotateClockwise(pixels, 240, 240)
        }
    }

    @Test fun blankCorruptAndOversizedFramesDoNotProduceAResult() {
        assertNull(PlayerQrDecoder.decode(ByteArray(400) { 255.toByte() }, 20, 20))
        assertNull(PlayerQrDecoder.decode(ByteArray(0), 0, 0))
        assertNull(PlayerQrDecoder.decode(ByteArray(0), Int.MAX_VALUE, Int.MAX_VALUE))
        assertNull(PlayerQrDecoder.decode(ByteArray(4), 3, 3))
    }
}
