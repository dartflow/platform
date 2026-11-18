package nl.dartflow.app

import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer

/** CPU-only QR decoder. Camera frames and decoded text are never uploaded or persisted. */
internal object PlayerQrDecoder {
    fun packedLuminance(bytes: ByteArray, width: Int, height: Int, rowStride: Int, pixelStride: Int): ByteArray? {
        if (width <= 0 || height <= 0 || width.toLong() * height > 4_000_000 || pixelStride <= 0 || rowStride < (width - 1L) * pixelStride + 1) return null
        if ((height - 1L) * rowStride + (width - 1L) * pixelStride >= bytes.size) return null
        return ByteArray(width * height).also { result -> for (y in 0 until height) for (x in 0 until width) result[y * width + x] = bytes[y * rowStride + x * pixelStride] }
    }

    fun rotateClockwise(input: ByteArray, width: Int, height: Int): ByteArray {
        require(input.size == width * height)
        return ByteArray(input.size).also { output -> for (y in 0 until height) for (x in 0 until width) output[x * height + height - 1 - y] = input[y * width + x] }
    }

    fun decode(input: ByteArray, width: Int, height: Int): String? {
        if (width <= 0 || height <= 0 || input.size.toLong() != width.toLong() * height || input.size > 4_000_000) return null
        val reader = MultiFormatReader().apply { setHints(mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE), DecodeHintType.TRY_HARDER to true)) }
        var data = input; var w = width; var h = height
        repeat(4) {
            val source = PlanarYUVLuminanceSource(data, w, h, 0, 0, w, h, false)
            for (image in listOf(source, source.invert())) {
                val text = runCatching { reader.decodeWithState(BinaryBitmap(HybridBinarizer(image))).text }.getOrNull()
                reader.reset()
                if (!text.isNullOrBlank() && text.length <= 4096) return text
            }
            data = rotateClockwise(data, w, h)
            val previous = w; w = h; h = previous
        }
        return null
    }
}
