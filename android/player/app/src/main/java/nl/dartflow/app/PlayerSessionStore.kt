package nl.dartflow.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

/** Tokens/PKCE are one AES-GCM blob protected by a non-exportable Android Keystore key.
 * Player PINs are never saved here. An uncertain non-sensitive command is bound to account/origin
 * and retained encrypted for an explicit retry. Android backup is disabled in the manifest. */
class PlayerSessionStore(context: Context, slot: String = "session") {
    private val prefs = context.getSharedPreferences(if (slot == "session") "dartflow-player-private-v1" else "dartflow-player-$slot-private-v1", Context.MODE_PRIVATE)
    private val alias = "dartflow-player-$slot-v1"
    private val aad = "DartFlow Speler $slot v1:${context.packageName}".toByteArray()
    private val sessionSlot = slot == "session"
    private val maxBytes = if (slot in listOf("play", "match-queue", "training-queue")) 2_000_000 else 100_000
    companion object { private val storageLock = Any() }
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun read(): JSONObject = synchronized(storageLock) {
        val value = prefs.getString("session", null) ?: return@synchronized JSONObject()
        try {
            val bytes = Base64.decode(value, Base64.NO_WRAP)
            require(bytes.size > 28 && bytes.size <= maxBytes)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            cipher.updateAAD(aad)
            JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
        } catch (_: Exception) { prefs.edit().remove("session").commit(); JSONObject() }
    }
    fun write(value: JSONObject) = synchronized(storageLock) {
        // A background token rotation preserves the latest login while UI state is saved.
        val latest = if (sessionSlot) read() else JSONObject()
        val merged = JSONObject(value.toString())
        if (sessionSlot && latest.text("userId").isNotBlank() && latest.text("userId") == merged.text("userId") && latest.text("accessToken") != merged.text("accessToken") && latest.optLong("expiresAt") > merged.optLong("expiresAt")) listOf("accessToken", "refreshToken", "expiresAt").forEach { key -> if (latest.has(key)) merged.put(key, latest.get(key)) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key()); cipher.updateAAD(aad)
        val plain = merged.toString().toByteArray(Charsets.UTF_8)
        require(plain.size + 28 <= maxBytes) { "De beveiligde opslag is vol. Synchroniseer eerst je wachtende invoer." }
        val encrypted = cipher.iv + cipher.doFinal(plain)
        check(prefs.edit().putString("session", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit()) { "Beveiligde sessieopslag is niet beschikbaar." }
    }
    fun update(transform: (JSONObject) -> JSONObject) = synchronized(storageLock) { write(transform(read())) }
    fun clear() = synchronized(storageLock) { check(prefs.edit().clear().commit()) { "Afmelden kon niet worden opgeslagen." } }
}
