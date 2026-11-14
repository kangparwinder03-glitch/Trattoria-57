package uk.trattoria57.printtest

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Bundle
import android.speech.tts.TextToSpeech
import java.util.Locale

/** Says new orders out loud on this phone (or the Bluetooth speaker it's paired to): a chime, then "New order, Table 4". */
object Speaker {
    private var tts: TextToSpeech? = null
    @Volatile private var ready = false
    private val waiting = mutableListOf<String>()

    fun on(prefs: android.content.SharedPreferences, st: String) = prefs.getBoolean("speak_$st", false)

    private fun ensure(ctx: Context) {
        if (tts != null) return
        tts = TextToSpeech(ctx.applicationContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.language = if ((tts?.isLanguageAvailable(Locale.UK) ?: -1) >= 0) Locale.UK else Locale.getDefault()
                tts?.setSpeechRate(0.95f)
                tts?.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                ready = true
                synchronized(waiting) { waiting.forEach { speakNow(it) }; waiting.clear() }
            } else Hub.log("⚠ This phone can't speak (no text-to-speech voice installed)")
        }
    }

    private fun speakNow(text: String) {
        val p = Bundle().apply { putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC) }
        tts?.speak(text, TextToSpeech.QUEUE_ADD, p, "t57-" + System.nanoTime())
    }

    /** Words for a ticket label: "Tables 1+2" → "Tables 1 and 2", "Pickup #25" → "Pickup number 25". */
    fun words(label: String, training: Boolean): String {
        val l = label.replace("+", " and ").replace("#", "number ").trim()
        val what = if (l.lowercase().startsWith("pickup") || l.lowercase().startsWith("takeaway") || l.lowercase().startsWith("bar walk")) "New $l" else "New order, $l"
        return (if (training) "Training. " else "") + what
    }

    fun say(ctx: Context, text: String) {
        try {
            ToneGenerator(AudioManager.STREAM_MUSIC, 90).apply {
                startTone(ToneGenerator.TONE_PROP_BEEP2, 450)
                Thread { Thread.sleep(700); release() }.start()
            }
        } catch (_: Exception) {}
        ensure(ctx)
        if (ready) speakNow(text) else synchronized(waiting) { waiting.add(text) }
    }
}
