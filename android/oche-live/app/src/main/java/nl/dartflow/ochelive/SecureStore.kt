package nl.dartflow.ochelive

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

/** One authenticated encrypted blob; no credentials in backups, logs, URLs or saved UI state. */
class SecureStore(context: Context) {
    private val prefs = context.getSharedPreferences("oche-private-v1", Context.MODE_PRIVATE)
    private val alias = "oche-installation-v1"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @Synchronized fun read(): JSONObject {
        val stored = prefs.getString("state", null) ?: return JSONObject()
        return try {
            val bytes = Base64.decode(stored, Base64.NO_WRAP)
            require(bytes.size > 28)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            cipher.updateAAD("DartFlow Oche Live v1".toByteArray())
            JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
        } catch (_: Exception) { prefs.edit().remove("state").commit(); JSONObject() }
    }
    @Synchronized fun write(state: JSONObject) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key()); cipher.updateAAD("DartFlow Oche Live v1".toByteArray())
        val encrypted = cipher.iv + cipher.doFinal(state.toString().toByteArray(Charsets.UTF_8))
        check(prefs.edit().putString("state", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit()) { "Beveiligde opslag is niet beschikbaar." }
    }
}
