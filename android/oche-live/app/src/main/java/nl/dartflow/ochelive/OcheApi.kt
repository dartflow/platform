package nl.dartflow.ochelive

import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

class ApiFailure(val status: Int, val retryAfterMs: Long = 0, val code: String = "") : Exception("Schermverbinding mislukt ($status)")
class OcheApi(private val origin: String = BuildConfig.API_ORIGIN) {
    init { require(origin.startsWith("https://")) }
    @Volatile private var serverOffsetMs: Long = 0
    fun serverNow(): Long = System.currentTimeMillis() + serverOffsetMs
    suspend fun call(path: String, body: JSONObject? = null, token: String? = null, installation: JSONObject? = null): JSONObject = withContext(Dispatchers.IO) {
        require(path.startsWith("/") && !path.contains("://"))
        val connection = URL("$origin/api/oche/v1$path").openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 8_000; connection.readTimeout = 8_000
            connection.requestMethod = if (body != null) "POST" else "GET"
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Cache-Control", "no-store")
            token?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
            installation?.let { connection.setRequestProperty("Authorization", "OcheInstall ${it.getString("installationId")}.${it.getString("installationSecret")}") }
            if (body != null) {
                connection.doOutput = true; connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val serverDate = connection.getHeaderFieldDate("Date", -1L)
            if (serverDate > 0) serverOffsetMs = serverDate - System.currentTimeMillis()
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            // Projection limits are enforced again here, before JSON allocation.
            val bytes = stream?.use { input ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (output.size() <= 2_000_000) { val read = input.read(buffer, 0, minOf(buffer.size, 2_000_001 - output.size())); if (read < 0) break; output.write(buffer, 0, read) }
                output.toByteArray()
            } ?: ByteArray(0)
            if (bytes.size > 2_000_000) throw ApiFailure(502)
            val json = runCatching { JSONObject(String(bytes, Charsets.UTF_8)) }.getOrDefault(JSONObject())
            if (status !in 200..299) throw ApiFailure(status, (connection.getHeaderField("Retry-After")?.toLongOrNull() ?: 0) * 1000, json.optString("code"))
            json
        } finally { connection.disconnect() }
    }
}
