# Loaded by every Python process in the convert job (PYTHONPATH): makes Pocket TTS's
# load_model use Jugnu's assembled config, whatever language the exporter asks for, so
# Kyutai's exporter turns the Jugnu model (not Kyutai's English one) into ONNX.
import os

_cfg = os.environ.get("JUGNU_CONFIG")
if _cfg:
    try:
        import pocket_tts

        _cls = pocket_tts.TTSModel
        _orig = _cls.load_model.__func__

        def _patched(cls, *args, **kwargs):
            for k in ("language", "lang", "variant", "model", "name"):
                kwargs.pop(k, None)
            kwargs["config"] = _cfg
            return _orig(cls, **kwargs)

        _cls.load_model = classmethod(_patched)
    except Exception as e:  # keep the exporter running; the log shows what happened
        print("sitecustomize: could not patch pocket_tts:", repr(e))
