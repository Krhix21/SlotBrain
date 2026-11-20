# Prueba de voz clonada en Modal con Qwen3-TTS (Botbarber2)
#
# Modo 1 (probar la voz):
#   py -m modal run voz_clonada.py
#   (genera salida_voz_1.ogg y salida_voz_2.ogg en esta misma carpeta)
#   Con una frase propia:
#   py -m modal run voz_clonada.py --texto "listo, te agendo a las 4" --out salida.ogg
#
# Modo 2 (endpoint para el bot, despues de que la voz te convenza):
#   py -m modal deploy voz_clonada.py
#   Te devuelve una URL https://...voz-clonada-api.modal.run donde se manda
#   {"texto": "...", "ref_audio_b64": "..."} y responde el ogg con tu voz.
#
# Costo: T4 = 0,59 USD/hora cobrada por segundo (solo mientras corre).
# El arranque frio descarga el modelo y tarda 1-2 minutos; cada frase tarda segundos.

import base64
import hashlib
import os
import subprocess
import tempfile

import modal

# ---------------------------------------------------------------- configuracion

MODEL = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"  # el aprobado en la Fase 0 del plan

# Transcripcion EXACTA del sample, palabra por palabra (la que dijo Crhistian).
REF_TEXT = (
    "¡Hola cliente cómo vas? sí, si claro, "
    "con mucho gusto te agendo la cita para esa hora"
)

# Ruta del sample en tu maquina (Grabacion de la app Grabadora de Voz).
SAMPLE_LOCAL = "C:/Users/USUARIO/Documents/Grabaciones de sonido/Grabación.m4a"

FRASES_PRUEBA = [
    "Listo, te agendé el corte a las 3.",
    "Hola, claro que sí. ¿Para cuándo te agendo la cita?",
]

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg")
    .pip_install("qwen-tts", "torch", "soundfile", "fastapi[standard]")
    # El sample viaja con el deploy: asi el endpoint no necesita que el bot
    # le mande el audio de referencia en cada llamada (solo el texto).
    .add_local_file(SAMPLE_LOCAL, "/root/sample.m4a")
)

app = modal.App("voz-clonada", image=image)

# ---------------------------------------------------------------- carga del modelo


def _cargar_modelo():
    import torch
    from qwen_tts import Qwen3TTSModel

    # OJO: float16 rompe la clonacion en GPUs sin bfloat16 (T4): produce NaN y
    # el error "probability tensor contains inf, nan". Confirmado por el equipo
    # de Qwen (issue #43): usar float32 en maquinas sin bfloat16.
    # sdpa en vez de flash_attention_2 para no compilar nada en el arranque.
    return Qwen3TTSModel.from_pretrained(
        MODEL,
        device_map="cuda:0",
        dtype=torch.float32,
        attn_implementation="sdpa",
    )


def _a_ogg_WhatsApp(wav_path: str) -> bytes:
    """Convierte el wav a ogg/opus mono, listo para WhatsApp (ideal < 512 KB)."""
    with tempfile.TemporaryDirectory() as d:
        ogg = os.path.join(d, "out.ogg")
        subprocess.run(
            ["ffmpeg", "-y", "-i", wav_path, "-c:a", "libopus", "-b:a", "24k", "-ac", "1", ogg],
            check=True, capture_output=True,
        )
        with open(ogg, "rb") as f:
            data = f.read()
    return data


def _sintetizar(model, ref_wav_path: str, ref_text: str, texto: str) -> bytes:
    import soundfile as sf

    # El prompt de clonacion se calcula una sola vez por sample y se reutiliza.
    prompt = model.create_voice_clone_prompt(ref_audio=ref_wav_path, ref_text=ref_text)
    wavs, sr = model.generate_voice_clone(
        text=texto,
        language="Spanish",
        voice_clone_prompt=prompt,
    )
    with tempfile.TemporaryDirectory() as d:
        wav = os.path.join(d, "out.wav")
        sf.write(wav, wavs[0], sr)
        return _a_ogg_WhatsApp(wav)


# ---------------------------------------------------------------- modo 1: probar

# El sample viaja de tu maquina al contenedor: se manda por parametro, no va
# dentro de la imagen, asi cambiar la grabacion no requiere recompilar nada.


@app.cls(gpu="T4", timeout=900, scaledown_window=300)
class VozClonada:
    @modal.enter()
    def cargar(self):
        self.model = _cargar_modelo()

    @modal.method()
    def generar(self, ref_audio_m4a: bytes, texto: str) -> bytes:
        # m4a no lo lee el modelo directo: ffmpeg lo pasa a wav mono 16 kHz.
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, "ref.m4a")
            wav = os.path.join(d, "ref.wav")
            with open(src, "wb") as f:
                f.write(ref_audio_m4a)
            subprocess.run(
                ["ffmpeg", "-y", "-i", src, "-ac", "1", "-ar", "16000", wav],
                check=True, capture_output=True,
            )
            return _sintetizar(self.model, wav, texto)


@app.local_entrypoint()
def main(
    ref: str = SAMPLE_LOCAL,
    texto: str = "",
    out: str = "salida_voz.ogg",
):
    with open(ref, "rb") as f:
        ref_bytes = f.read()

    voz = VozClonada()
    frases = [texto] if texto else FRASES_PRUEBA
    for i, frase in enumerate(frases):
        print(f"Generando frase {i + 1}/{len(frases)}: {frase}")
        ogg = voz.generar.remote(ref_bytes, frase)
        path = out if texto else f"salida_voz_{i + 1}.ogg"
        with open(path, "wb") as f:
            f.write(ogg)
        kb = len(ogg) / 1024
        print(f"  -> {path} ({kb:.0f} KB, {list(ogg[:4])})")


# ---------------------------------------------------------------- modo 2: endpoint

_modelo_endpoint = None  # cache por contenedor
_ref_wav = None          # sample convertido a wav, una sola vez por contenedor
_prompts = {}            # prompt de clonacion POR SAMPLE (clave = hash del audio)


def _preparar_sample():
    """Convierte el sample embebido a wav mono 16 kHz (se hace una vez)."""
    global _ref_wav
    if _ref_wav is None:
        subprocess.run(
            ["ffmpeg", "-y", "-i", "/root/sample.m4a", "-ac", "1", "-ar", "16000", "/root/sample.wav"],
            check=True, capture_output=True,
        )
        _ref_wav = "/root/sample.wav"
    return _ref_wav


def _prompt_para(model, ref_wav: str, ref_text: str, clave: str):
    """Prompt de clonacion cacheado por sample: recalcularlo en cada frase
    re-procesaria el audio cada vez y sumaria segundos a cada respuesta.
    La clave distingue samples distintos (varias empresas pueden pasar por
    el mismo contenedor caliente)."""
    prompt = _prompts.get(clave)
    if prompt is None:
        prompt = model.create_voice_clone_prompt(ref_audio=ref_wav, ref_text=ref_text)
        _prompts[clave] = prompt
    return prompt


# scaledown_window=600: el contenedor queda caliente 10 minutos tras la
# ultima frase. Si el cliente sigue conversando, no vuelve a pagar el
# arranque frio (1-2 min). Si nadie escribe, se apaga y no cuesta nada.
@app.function(gpu="T4", timeout=900, scaledown_window=600)
@modal.fastapi_endpoint(method="POST")
def api(body: dict):
    """POST {"texto": "...", "ref_audio_b64": "...", "ref_text": "..."} -> ogg.

    Sin ref_audio_b64 usa el sample quemado en la imagen (voz por defecto).
    Con ref_audio_b64 clona el sample que manda el bot: la voz ACTIVA de la
    empresa que esta conversando (tabla `voces`). ref_text debe ser la
    transcripcion EXACTA de ese audio (Qwen la exige para clonar bien).
    """
    global _modelo_endpoint
    if _modelo_endpoint is None:
        _modelo_endpoint = _cargar_modelo()

    texto = body["texto"]
    # "estilo" llega desde el panel (tabla voces) pero el modelo de
    # clonacion (Base) NO acepta instrucciones por llamada (solo los
    # CustomVoice/VoiceDesign). Se acepta y se ignora por ahora, para que
    # el dia que cambiemos de modelo no haya que tocar ni el bot ni el
    # panel: el campo ya viaja.
    # estilo = body.get("estilo")

    # Ruta normal: el sample vive en la imagen desde el deploy.
    if "ref_audio_b64" not in body:
        ref_wav = _preparar_sample()
        prompt = _prompt_para(_modelo_endpoint, ref_wav, REF_TEXT, "default")
        ogg = _generar_con_prompt(_modelo_endpoint, prompt, texto)
    else:
        ref_bytes = base64.b64decode(body["ref_audio_b64"])
        # Transcripcion EXACTA del sample de la empresa. Si el bot no la
        # manda (caller viejo), cae a la del sample quemado: peor clonacion
        # pero nunca un 400 que deje al cliente sin nota de voz.
        ref_text = str(body.get("ref_text") or "").strip() or REF_TEXT
        clave = hashlib.md5(ref_bytes).hexdigest()
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, "ref.m4a")
            wav = os.path.join(d, "ref.wav")
            with open(src, "wb") as f:
                f.write(ref_bytes)
            subprocess.run(
                ["ffmpeg", "-y", "-i", src, "-ac", "1", "-ar", "16000", wav],
                check=True, capture_output=True,
            )
            prompt = _prompt_para(_modelo_endpoint, wav, ref_text, clave)
            ogg = _generar_con_prompt(_modelo_endpoint, prompt, texto)

    from fastapi import Response

    return Response(content=ogg, media_type="audio/ogg")


def _generar_con_prompt(model, prompt, texto: str) -> bytes:
    import soundfile as sf

    wavs, sr = model.generate_voice_clone(
        text=texto,
        language="Spanish",
        voice_clone_prompt=prompt,
    )
    with tempfile.TemporaryDirectory() as d:
        wav = os.path.join(d, "out.wav")
        sf.write(wav, wavs[0], sr)
        return _a_ogg_WhatsApp(wav)
