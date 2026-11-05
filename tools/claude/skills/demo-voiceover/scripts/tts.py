"""Text-to-speech engines behind one small interface: engine.synth(text, out_path_without_ext) -> written path.

piper   offline, neural, default. Voice files live in <skill>/voices/.
system  offline: Windows SAPI5 (pyttsx3), macOS `say`, Linux espeak-ng.
edge    ONLINE (sends the text to Microsoft). Opt-in only; voiceover.py also needs --allow-online.
"""
import asyncio, re, shutil, subprocess, sys, wave
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
    """Offline system voice. Picks a backend per platform:
    macOS    the `say` command (AIFF), converted to wav with ffmpeg. No pyobjc needed.
    Linux    espeak-ng or espeak (writes wav itself); pyttsx3 only if neither is installed.
    Windows  pyttsx3 (SAPI5).
    """
    name, ext = "system", ".wav"

    def __init__(self, voice=None):
        self.voice_id = None
        self.voice_name = None
        want = voice and voice not in ("default", "en_GB-cori-medium")
        if sys.platform == "darwin":
            self.backend = "say"
            if not shutil.which("say"):
                raise RuntimeError("The macOS `say` command was not found.")
            if want:
                names = self._say_voices()
                hit = next((n for n in names if voice.lower() == n.lower()), None) or                     next((n for n in names if voice.lower() in n.lower()), None)
                if not hit:
                    raise RuntimeError(f"No system voice matching {voice!r}")
                self.voice_name = hit
        elif sys.platform.startswith("linux") and (shutil.which("espeak-ng") or shutil.which("espeak")):
            self.backend = "espeak"
            self.exe = shutil.which("espeak-ng") or shutil.which("espeak")
            if want:
                self.voice_name = voice
        else:
            self.backend = "pyttsx3"
            if want:
                import pyttsx3
                for v in pyttsx3.init().getProperty("voices"):
                    if voice.lower() in (v.name or "").lower() or voice == v.id:
                        self.voice_id = v.id
                        break
                else:
                    raise RuntimeError(f"No system voice matching {voice!r}")

    @staticmethod
    def _say_voices():
        r = subprocess.run(["say", "-v", "?"], capture_output=True, text=True)
        names = []
        for line in r.stdout.splitlines():
            m = re.match(r"(.+?)\s{2,}\S+\s*#", line)  # "Daniel      en_GB    # Hello..."
            if m:
                names.append(m.group(1).strip())
        return names

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
        if self.backend == "say":
            aiff = p.with_suffix(".aiff")
            cmd = ["say", "-o", str(aiff)] + (["-v", self.voice_name] if self.voice_name else []) + ["--", text]
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode != 0 or not aiff.exists():
                raise RuntimeError("say failed: " + (r.stderr or "").strip()[-300:])
            from common import find_ffmpeg
            c = subprocess.run([find_ffmpeg(), "-y", "-loglevel", "error", "-i", str(aiff), "-ar", "22050", "-ac", "1", str(p)],
                               capture_output=True, text=True)
            aiff.unlink(missing_ok=True)
            if c.returncode != 0:
                raise RuntimeError("ffmpeg could not convert the say output: " + c.stderr.strip()[-300:])
        elif self.backend == "espeak":
            cmd = [self.exe, "-w", str(p)] + (["-v", self.voice_name] if self.voice_name else ["-v", "en-gb"]) + ["-s", "165", "--", text]
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode != 0:
                raise RuntimeError("espeak failed: " + (r.stderr or "").strip()[-300:])
        else:
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
