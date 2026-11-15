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
class PlayerSessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("dartflow-player-private-v1", Context.MODE_PRIVATE)
    private val alias = "dartflow-player-session-v1"
    private val aad = "DartFlow Speler session v1:${context.packageName}".toByteArray()
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @Synchronized fun read(): JSONObject {
        val value = prefs.getString("session", null) ?: return JSONObject()
        return try {
            val bytes = Base64.decode(value, Base64.NO_WRAP)
            require(bytes.size > 28 && bytes.size <= 100_000)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            cipher.updateAAD(aad)
            JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
        } catch (_: Exception) { prefs.edit().remove("session").commit(); JSONObject() }
    }
    @Synchronized fun write(value: JSONObject) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key()); cipher.updateAAD(aad)
        val encrypted = cipher.iv + cipher.doFinal(value.toString().toByteArray(Charsets.UTF_8))
        check(prefs.edit().putString("session", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit()) { "Beveiligde sessieopslag is niet beschikbaar." }
    }
    @Synchronized fun clear() { check(prefs.edit().clear().commit()) { "Afmelden kon niet worden opgeslagen." } }
}
