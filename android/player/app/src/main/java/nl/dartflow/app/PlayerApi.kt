package nl.dartflow.app

import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

class PlayerApiFailure(val status: Int, val code: String, val feedback: String, val retryAfterMs: Long = 0) : Exception(feedback)

/** No cookies, redirects, HTTP caching or request/response logging. */
class PlayerApi(val origin: String = BuildConfig.API_ORIGIN) {
    var identityProvider: (() -> PlayerRequestIdentity?)? = null
    var bearerProvider: (suspend (PlayerRequestIdentity) -> String?)? = null
    var unauthorized: (suspend (PlayerRequestAuthorization) -> Unit)? = null
    @Volatile private var serverOffsetMs = 0L
    init {
        val uri = URI(origin)
        require(uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null && uri.path in listOf("", "/"))
        require(uri.scheme == "https" || (BuildConfig.DEBUG && uri.scheme == "http" && uri.host in listOf("127.0.0.1", "localhost")))
    }
    fun serverNow() = System.currentTimeMillis() + serverOffsetMs
    suspend fun call(path: String, body: JSONObject? = null, method: String = if (body == null) "GET" else "POST", anonymous: Boolean = false): JSONObject {
        require(path.startsWith('/') && !path.startsWith("//") && !path.contains("://") && !path.contains("..") && !path.contains('#'))
        val url = "${origin.trimEnd('/')}/api/player/v1$path"
        if (anonymous) return request(url, method, body, null)
        return withPlayerRequestAuthorization(
            currentIdentity = { identityProvider?.invoke() },
            bearer = { identity -> bearerProvider?.invoke(identity) },
            unauthorized = unauthorized,
            request = { token -> request(url, method, body, token) },
        )
    }
    suspend fun authCall(auth: JSONObject, path: String, body: JSONObject? = null, token: String? = null, method: String = "POST"): JSONObject {
        val authUrl = auth.optString("url").trimEnd('/')
        val uri = URI(authUrl)
        require(uri.scheme == "https" && uri.host != null && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null && uri.path in listOf("", "/"))
        require(path.startsWith('/') && !path.contains("..") && !path.contains("://"))
        val key = auth.optString("publishableKey")
        require(key.isNotBlank() && key.length <= 8192)
        // Only the public project key is obtained from capabilities, never a service-role key.
        require(!key.startsWith("sb_secret_"))
        return request("$authUrl/auth/v1$path", method, body, token, key, authRequest = true)
    }
    private suspend fun request(url: String, method: String, body: JSONObject?, token: String?, apiKey: String? = null, authRequest: Boolean = false): JSONObject = withContext(Dispatchers.IO) {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 10_000; connection.readTimeout = 12_000
            connection.useCaches = false
            connection.requestMethod = method
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Cache-Control", "no-store")
            token?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
            apiKey?.let { connection.setRequestProperty("apikey", it) }
            if (body != null) {
                val bytes = body.toString().toByteArray(Charsets.UTF_8)
                require(bytes.size <= 196_608) { "Deze invoer is te groot." }
                connection.doOutput = true
                connection.setFixedLengthStreamingMode(bytes.size)
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(bytes) }
            }
            val status = connection.responseCode
            val date = connection.getHeaderFieldDate("Date", -1L)
            if (date > 0) serverOffsetMs = (date - System.currentTimeMillis()).coerceIn(-300_000, 300_000)
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val bytes = stream?.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (output.size() <= 2_000_000) {
                    val count = input.read(buffer, 0, minOf(buffer.size, 2_000_001 - output.size()))
                    if (count < 0) break
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            } ?: ByteArray(0)
            if (bytes.size > 2_000_000) throw PlayerApiFailure(502, "response_size", "De servergegevens zijn te groot. Probeer opnieuw.")
            val result = runCatching { JSONObject(String(bytes, Charsets.UTF_8)) }.getOrDefault(JSONObject())
            if (status !in 200..299) {
                // Provider payloads can contain credentials/addresses. Do not surface them.
                val feedback = if (authRequest) when (status) {
                    400, 401, 403, 422 -> "De inlogcode is onjuist of verlopen. Vraag zo nodig een nieuwe code aan."
                    429 -> "Te veel pogingen. Wacht even voordat je opnieuw probeert."
                    else -> "Inloggen is tijdelijk niet beschikbaar. Probeer opnieuw."
                } else result.optString("error", result.optString("message")).takeIf { it.length in 1..300 && !it.any { c -> c.code < 32 } }
                    ?: when (status) { 401 -> "Log opnieuw in om verder te gaan."; 409 -> "De gegevens zijn gewijzigd. De actuele stand wordt opgehaald."; 429 -> "Wacht even voordat je opnieuw probeert."; else -> "De server is tijdelijk niet bereikbaar." }
                throw PlayerApiFailure(status, result.optString("code", "http_error"), feedback, (connection.getHeaderField("Retry-After")?.toLongOrNull()?.coerceIn(0, 3600) ?: 0) * 1000)
            }
            if (bytes.isNotEmpty() && result.length() == 0 && String(bytes, Charsets.UTF_8).trim() != "{}") throw IOException("Ongeldige servergegevens.")
            result
        } finally { connection.disconnect() }
    }
}
