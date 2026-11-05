"""Text-to-speech engines behind one small interface: engine.synth(text, out_path_without_ext) -> written path.

piper   offline, neural, default. Voice files live in <skill>/voices/.
system  offline, pyttsx3 (Windows SAPI5 / macOS NSSpeech / Linux espeak).
edge    ONLINE (sends the text to Microsoft). Opt-in only; voiceover.py also needs --allow-online.
"""
import asyncio, sys, wave
from pathlib import Path

ENGINES = ("piper", "system", "edge")
DEFAULT_EDGE_VOICE = "en-GB-SoniaNeural"


class PiperEngine:
    name, ext = "piper", ".wav"

    def __init__(self, voice, voices_dir):
        from piper import PiperVoice
        model = Path(voices_dir) / f"{voice}.onnx"
        if not model.exists():
            raise RuntimeError(f"Piper voice not found: {model}. Run setup_voice.py (or --voice with a downloaded voice).")
        self.voice = PiperVoice.load(str(model))

    def synth(self, text, out):
        p = Path(str(out) + self.ext)
        with wave.open(str(p), "wb") as w:
            self.voice.synthesize_wav(text, w)
        return p


class SystemEngine:
    name, ext = "system", ".wav"

    def __init__(self, voice=None):
        import pyttsx3
        self.voice_id = None
        if voice and voice not in ("default", "en_GB-cori-medium"):
            for v in pyttsx3.init().getProperty("voices"):
                if voice.lower() in (v.name or "").lower() or voice == v.id:
                    self.voice_id = v.id
                    break
            else:
                raise RuntimeError(f"No system voice matching {voice!r}")

    def _fresh(self):
        # pyttsx3 hangs on a second runAndWait() with the same engine (SAPI), so every line gets its own.
        import pyttsx3
        pyttsx3.engine.Engine  # noqa: B018
        e = pyttsx3.engine.Engine(None, False)
        if self.voice_id:
            e.setProperty("voice", self.voice_id)
        e.setProperty("rate", 170)
        return e

    def synth(self, text, out):
        p = Path(str(out) + self.ext)
        e = self._fresh()
        e.save_to_file(text, str(p.resolve()))
        e.runAndWait()
        e.stop()
        del e
        if not p.exists() or p.stat().st_size < 100:
            raise RuntimeError("system engine produced no audio")
        return p


class EdgeEngine:
    name, ext = "edge", ".mp3"

    def __init__(self, voice=None):
        import edge_tts  # noqa: F401
        self.voice = voice if voice and voice.startswith(("en-", "de-", "fr-", "es-")) else DEFAULT_EDGE_VOICE

    def synth(self, text, out):
        import edge_tts
        p = Path(str(out) + self.ext)
        asyncio.run(edge_tts.Communicate(text, self.voice).save(str(p)))
        return p


def piper_ready(voice, voices_dir):
    try:
        import piper  # noqa: F401
    except ImportError:
        return False
    return (Path(voices_dir) / f"{voice}.onnx").exists()


def make_engine(engine, voice, voices_dir):
    if engine == "piper":
        return PiperEngine(voice, voices_dir)
    if engine == "system":
        return SystemEngine(voice)
    if engine == "edge":
        return EdgeEngine(voice)
    raise RuntimeError(f"Unknown engine {engine!r}; choose one of {ENGINES}")
