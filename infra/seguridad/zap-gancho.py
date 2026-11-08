# Plan de seguridad: gancho de zap-baseline.py (--hook). Antes de cerrar ZAP guarda la petición y la respuesta completas
# (encabezados y cuerpos) de cada alerta que no está aceptada en reglas.tsv, en alertas-con-mensaje.json de la carpeta
# del reporte. Así una alerta que no se reproduce a mano se puede investigar con lo que ZAP vio (2026-11-07: 10096).
# Es solo diagnóstico: si algo falla, lo anota en el archivo y no interrumpe a ZAP (una excepción aquí lo haría salir
# con error aunque el escaneo hubiera terminado bien).
import json

SALIDA = '/zap/wrk/alertas-con-mensaje.json'
REGLAS = '/zap/wrk/reglas.tsv'


def _aceptadas():
    aceptadas = set()
    with open(REGLAS, encoding='utf-8') as reglas:
        for linea in reglas:
            partes = linea.split('\t')
            if len(partes) >= 2 and partes[1].strip() == 'IGNORE':
                aceptadas.add(partes[0].strip())
    return aceptadas


def zap_pre_shutdown(zap):
    try:
        aceptadas = _aceptadas()
        salida = []
        for alerta in zap.core.alerts():
            if alerta.get('pluginId') in aceptadas or alerta.get('risk') == 'Informational':
                continue
            mensaje = zap.core.message(alerta.get('messageId'))
            salida.append({
                'regla': alerta.get('pluginId'),
                'nombre': alerta.get('alert'),
                'url': alerta.get('url'),
                'evidencia': alerta.get('evidence'),
                'peticion_encabezados': mensaje.get('requestHeader'),
                'peticion_cuerpo': mensaje.get('requestBody'),
                'respuesta_encabezados': mensaje.get('responseHeader'),
                'respuesta_cuerpo': mensaje.get('responseBody'),
            })
        contenido = {'alertas': salida}
    except Exception as error:  # noqa: BLE001 (diagnóstico: nunca interrumpe a ZAP)
        contenido = {'error': '%s: %s' % (type(error).__name__, error)}
        print('Aviso: el gancho no pudo guardar los mensajes de las alertas (%s)' % contenido['error'])
    try:
        with open(SALIDA, 'w', encoding='utf-8') as archivo:
            json.dump(contenido, archivo, ensure_ascii=False, indent=1)
    except OSError as error:
        print('Aviso: el gancho no pudo escribir %s (%s)' % (SALIDA, error))
